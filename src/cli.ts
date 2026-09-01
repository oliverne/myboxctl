#!/usr/bin/env bun

import { Command, CommanderError, Option } from "commander";

import { DomainError } from "./errors.ts";
import { runDelete } from "./features/delete.ts";
import { runDownloadCommand } from "./features/download-command.ts";
import { runInfo } from "./features/info.ts";
import { runList } from "./features/list.ts";
import { runMkdir } from "./features/mkdir.ts";
import { runUploadCommand } from "./features/upload-command.ts";
import { createEventPresentation, type EventPresentationOptions } from "./human-ui.ts";
import {
  type CommandAction,
  exitCodeForError,
  redactSecrets,
  writeFailure,
  writeSuccess,
} from "./output.ts";
import { createRuntime, type Runtime } from "./runtime.ts";
import { VERSION } from "./version.ts";

export type RuntimeFactory = (presentation?: EventPresentationOptions) => Promise<Runtime>;

const defaultRuntimeFactory: RuntimeFactory = (presentation) =>
  createRuntime(presentation === undefined ? {} : { presentation });

type OutputOptions = {
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
};

type UploadCommandOptions = OutputOptions & { force?: boolean; mkdir?: boolean };
type MkdirCommandOptions = OutputOptions & { parents?: boolean };
type DeleteCommandOptions = OutputOptions & { ignoreMissing?: boolean };
type DownloadCommandOptions = OutputOptions & { overwrite?: boolean };

function displayValue(value: unknown): string {
  return redactSecrets(String(value));
}

function formatBytes(value: number | null): string {
  if (value === null) return "-";
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_024 * 1_024 * 1_024) return `${(value / (1_024 * 1_024)).toFixed(1)} MiB`;
  return `${(value / (1_024 * 1_024 * 1_024)).toFixed(1)} GiB`;
}

function formatModifiedAt(value: string | null): string {
  if (value === null) return "-";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`
    : "-";
}

function normalizeModifiedAt(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function renderResourceTable(resources: Array<Record<string, unknown>>): string {
  const lines = [`${`TYPE`.padEnd(7)} ${`SIZE`.padEnd(9)} ${`MODIFIED`.padEnd(20)} NAME`];
  for (const resource of resources) {
    lines.push(
      `${displayValue(resource.type).padEnd(7)} ${formatBytes((resource.sizeBytes as number | null) ?? null).padEnd(9)} ${formatModifiedAt((resource.modifiedAt as string | null) ?? null).padEnd(20)} ${displayValue(resource.name)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function writeCommandSuccess(
  command: "list" | "info" | "mkdir" | "upload" | "delete" | "download",
  result: { action: CommandAction; data: unknown },
  options: OutputOptions,
): void {
  const data = normalizeMachineData(command, result.data);
  if (options.json) {
    writeSuccess(command, result.action, data);
    return;
  }

  if (command === "list") {
    const listData = data as {
      path: string;
      resources: Array<Record<string, unknown>>;
    };
    if (listData.resources.length === 0) {
      process.stdout.write(`No items in ${displayValue(listData.path)}.\n`);
      return;
    }
    const itemLabel = listData.resources.length === 1 ? "item" : "items";
    process.stdout.write(
      `${renderResourceTable(listData.resources)}\n${listData.resources.length} ${itemLabel}\n`,
    );
    return;
  }

  if (command === "info") {
    const resource = (data as { resource: Record<string, unknown> }).resource;
    process.stdout.write(
      `Path:      ${displayValue(resource.path)}\nType:      ${displayValue(resource.type)}\nSize:      ${formatBytes((resource.sizeBytes as number | null) ?? null)}${resource.sizeBytes === null ? "" : ` (${resource.sizeBytes} bytes)`}\nModified:  ${formatModifiedAt((resource.modifiedAt as string | null) ?? null)}\n`,
    );
    return;
  }

  if (command === "mkdir") {
    const mkdirData = data as { path: string };
    process.stdout.write(
      result.action === "existing"
        ? `Directory already exists: ${displayValue(mkdirData.path)}\n`
        : `Created ${displayValue(mkdirData.path)}\n`,
    );
    return;
  }

  if (command === "upload") {
    const uploadData = data as { path: string; sizeBytes: number | null };
    const verb =
      result.action === "skipped"
        ? "Skipped"
        : result.action === "overwritten"
          ? "Updated"
          : "Uploaded";
    const suffix =
      result.action === "skipped"
        ? " (already current)"
        : ` (${formatBytes(uploadData.sizeBytes)})`;
    process.stdout.write(`${verb} ${displayValue(uploadData.path)}${suffix}\n`);
    return;
  }

  if (command === "download") {
    const downloadData = data as {
      remotePath: string;
      localPath: string;
      sizeBytes: number | null;
    };
    process.stdout.write(
      `Downloaded ${displayValue(downloadData.remotePath)} -> ${displayValue(downloadData.localPath)} (${formatBytes(downloadData.sizeBytes)})\n`,
    );
    return;
  }

  const deleteData = data as { path: string; type: "file" | "folder" | null };
  process.stdout.write(
    result.action === "already-absent"
      ? `Already absent: ${displayValue(deleteData.path)}\n`
      : deleteData.type === "folder"
        ? `Folder moved to trash: ${displayValue(deleteData.path)}\n`
        : `Deleted ${displayValue(deleteData.path)}\n`,
  );
}

function normalizeMachineData(command: string, value: unknown): unknown {
  if (command === "upload") {
    const data = value as {
      path: string;
      resourceId?: string | null;
      size?: number;
      sizeBytes?: number | null;
      modifiedAt?: string | null;
      reason?: string;
    };
    return {
      path: data.path,
      resourceId: data.resourceId ?? null,
      sizeBytes: data.sizeBytes ?? data.size ?? null,
      modifiedAt: normalizeModifiedAt(data.modifiedAt),
      ...(data.reason === undefined ? {} : { reason: data.reason }),
    };
  }
  if (command === "download") {
    const data = value as {
      remotePath: string;
      localPath: string;
      resourceId?: string | null;
      size?: number;
      sizeBytes?: number | null;
      modifiedAt?: string | null;
    };
    return {
      remotePath: data.remotePath,
      localPath: data.localPath,
      resourceId: data.resourceId ?? null,
      sizeBytes: data.sizeBytes ?? data.size ?? null,
      modifiedAt: normalizeModifiedAt(data.modifiedAt),
    };
  }
  if (command === "delete") {
    const data = value as { path: string; resourceId?: string | null; type?: string | null };
    return {
      path: data.path,
      resourceId: data.resourceId ?? null,
      type:
        data.type?.toLowerCase() === "folder"
          ? "folder"
          : data.type === undefined || data.type === null
            ? null
            : "file",
    };
  }
  return value;
}

function addPresentationOptions(command: Command): Command {
  return command
    .option("--json", "Print one machine-readable JSON envelope")
    .addOption(new Option("--verbose", "Print detailed progress events"))
    .addOption(new Option("--quiet", "Suppress progress events"));
}

function addContractHelp(command: Command, text: string): Command {
  return command.addHelpText("after", `\n${text.trim()}\n`);
}

function mergedOptions(program: Command, options: OutputOptions): OutputOptions {
  const root = program.opts<OutputOptions>();
  const merged = {
    ...(root.json === undefined && options.json === undefined
      ? {}
      : { json: options.json ?? root.json }),
    ...(root.verbose === undefined && options.verbose === undefined
      ? {}
      : { verbose: options.verbose ?? root.verbose }),
    ...(root.quiet === undefined && options.quiet === undefined
      ? {}
      : { quiet: options.quiet ?? root.quiet }),
  };
  if (merged.verbose && merged.quiet) {
    throw new DomainError(
      "invalid-arguments",
      "The --verbose and --quiet options cannot be combined.",
    );
  }
  return merged;
}

function runtimeForCommand(
  runtimeFactory: RuntimeFactory,
  command: string,
  options: OutputOptions,
): Promise<Runtime> {
  return runtimeFactory({ command, ...options });
}

function commandDependencies(runtime: Runtime) {
  return {
    client: runtime.client,
    resolver: runtime.resolver,
    uploader: runtime.uploader,
    downloader: runtime.downloader,
    timeoutMs: runtime.config.timeoutMs,
    eventSink: runtime.events.sink,
  };
}

export function createProgram(runtimeFactory: RuntimeFactory = defaultRuntimeFactory): Command {
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
    .name("myboxctl")
    .description("Agent-friendly CLI for NAVER MYBOX file operations")
    .version(VERSION);
  addPresentationOptions(program);
  addContractHelp(
    program,
    `Remote paths are absolute and start with /. Use --json for one versioned JSON result on stdout.\nExamples:\n  myboxctl list\n  myboxctl info /reports/report.pdf --json`,
  );

  addPresentationOptions(
    addContractHelp(
      program
        .command("list")
        .alias("ls")
        .description("List a file or directory (default: /)")
        .argument("[remote-path]", "Absolute remote path", "/")
        .action(async (remotePath: string, options: OutputOptions) => {
          const effective = mergedOptions(program, options);
          const runtime = await runtimeForCommand(runtimeFactory, "list", effective);
          try {
            const result = await runList(remotePath, runtime.resolver);
            runtime.events.finish();
            writeCommandSuccess("list", result, effective);
          } finally {
            runtime.events.finish();
          }
        }),
      "Lists direct children, or one row when the path is a file. Missing paths fail with exit 4.\nThe default path is /. Alias: ls.",
    ),
  );

  addPresentationOptions(
    addContractHelp(
      program
        .command("info")
        .description("Show file or folder information")
        .argument("<remote-path>", "Absolute remote path")
        .action(async (remotePath: string, options: OutputOptions) => {
          const effective = mergedOptions(program, options);
          const runtime = await runtimeForCommand(runtimeFactory, "info", effective);
          try {
            const result = await runInfo(remotePath, runtime.resolver);
            runtime.events.finish();
            writeCommandSuccess("info", result, effective);
          } finally {
            runtime.events.finish();
          }
        }),
      "Shows a file or folder. Missing paths fail with exit 4.\nRemote paths must start with /.",
    ),
  );

  addPresentationOptions(
    addContractHelp(
      program
        .command("mkdir")
        .description("Create a remote directory")
        .argument("<remote-directory>", "Absolute remote directory path")
        .option("-p, --parents", "Create missing parent directories and succeed if existing")
        .action(async (remotePath: string, options: MkdirCommandOptions) => {
          const effective = mergedOptions(program, options);
          const runtime = await runtimeForCommand(runtimeFactory, "mkdir", effective);
          try {
            const result = await runMkdir(
              remotePath,
              options.parents === undefined ? {} : { parents: options.parents },
              runtime.resolver,
            );
            runtime.events.finish();
            writeCommandSuccess("mkdir", result, effective);
          } finally {
            runtime.events.finish();
          }
        }),
      "Without -p, only one directory is created and its parent must exist.\nWith -p/--parents, missing parents are created and an existing target succeeds.",
    ),
  );

  addPresentationOptions(
    addContractHelp(
      program
        .command("upload")
        .description("Upload or update a file when needed")
        .argument("<local-file>", "Local regular file")
        .argument("[remote-destination]", "Remote file or directory destination (default: /)")
        .option("--force", "Overwrite regardless of file metadata")
        .option("--mkdir", "Create a missing remote directory destination or parent")
        .action(
          async (
            localPath: string,
            remoteDestination: string | undefined,
            options: UploadCommandOptions,
          ) => {
            const effective = mergedOptions(program, options);
            const runtime = await runtimeForCommand(runtimeFactory, "upload", effective);
            const interrupt = new AbortController();
            const onInterrupt = () => interrupt.abort();
            process.once("SIGINT", onInterrupt);
            try {
              const result = await runUploadCommand(
                localPath,
                remoteDestination,
                {
                  ...(options.force === undefined ? {} : { force: options.force }),
                  ...(options.mkdir === undefined ? {} : { mkdir: options.mkdir }),
                },
                { ...commandDependencies(runtime), signal: interrupt.signal },
              );
              runtime.events.finish();
              writeCommandSuccess("upload", result, effective);
            } finally {
              process.removeListener("SIGINT", onInterrupt);
              runtime.events.finish();
            }
          },
        ),
      "Destination defaults to / and uses the local basename. An existing directory also gets the basename.\nA trailing / means directory intent; a missing intended directory needs --mkdir.\nMetadata (size + modified time) is compared: matching files are skipped, newer remote files conflict, and --force overrides.\nUse --json for one result envelope or --json --verbose for JSON Lines progress on stderr.",
    ),
  );

  addPresentationOptions(
    addContractHelp(
      program
        .command("download")
        .description("Download a file (default destination: current directory)")
        .argument("<remote-file>", "Absolute remote file path")
        .argument("[local-destination]", "Local file or directory destination")
        .option("--overwrite", "Atomically replace an existing regular local file")
        .action(
          async (
            remotePath: string,
            localDestination: string | undefined,
            options: DownloadCommandOptions,
          ) => {
            const effective = mergedOptions(program, options);
            const runtime = await runtimeForCommand(runtimeFactory, "download", effective);
            const interrupt = new AbortController();
            const onInterrupt = () => interrupt.abort();
            process.once("SIGINT", onInterrupt);
            try {
              const result = await runDownloadCommand(
                remotePath,
                localDestination,
                options.overwrite === undefined ? {} : { overwrite: options.overwrite },
                { ...commandDependencies(runtime), signal: interrupt.signal },
              );
              runtime.events.finish();
              writeCommandSuccess("download", result, effective);
            } finally {
              process.removeListener("SIGINT", onInterrupt);
              runtime.events.finish();
            }
          },
        ),
      "Destination defaults to ./<remote-basename>. An existing local directory gets the basename.\nA missing destination with trailing / fails; local parent directories are not created.\nExisting regular files require --overwrite.",
    ),
  );

  addPresentationOptions(
    addContractHelp(
      program
        .command("delete")
        .description("Move a file or folder to MYBOX trash")
        .argument("<remote-path>", "Absolute remote path")
        .option("--ignore-missing", "Succeed when the remote path is already absent")
        .action(async (remotePath: string, options: DeleteCommandOptions) => {
          const effective = mergedOptions(program, options);
          const runtime = await runtimeForCommand(runtimeFactory, "delete", effective);
          try {
            const result = await runDelete(
              remotePath,
              options.ignoreMissing === undefined ? {} : { ignoreMissing: options.ignoreMissing },
              { client: runtime.client, resolver: runtime.resolver },
            );
            runtime.events.finish();
            writeCommandSuccess("delete", result, effective);
          } finally {
            runtime.events.finish();
          }
        }),
      "Folders and their contents move together to MYBOX trash. Missing paths fail with exit 4 unless --ignore-missing is used.\nThe root path / cannot be deleted.",
    ),
  );

  return program;
}

function commandFromArgv(argv: readonly string[]): string {
  const candidate = argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (candidate === "ls") return "list";
  return candidate ?? "myboxctl";
}

function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

export async function runCli(
  argv: readonly string[] = Bun.argv,
  runtimeFactory: RuntimeFactory = defaultRuntimeFactory,
): Promise<number> {
  try {
    await createProgram(runtimeFactory).parseAsync([...argv]);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return 0;
    }

    const command = commandFromArgv(argv);
    const cliError =
      error instanceof CommanderError
        ? new DomainError("invalid-arguments", error.message.replace(/^error:\s*/, ""))
        : error;
    if (wantsJson(argv)) {
      writeFailure(command, cliError);
    } else {
      createEventPresentation({
        command,
        json: wantsJson(argv),
        quiet: argv.includes("--quiet"),
        verbose: argv.includes("--verbose"),
      }).writeHumanFailure(cliError);
    }
    return exitCodeForError(cliError);
  }
}

if (import.meta.main) {
  process.exitCode = await runCli();
}
