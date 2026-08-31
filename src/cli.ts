#!/usr/bin/env bun

import { Command, CommanderError, Option } from "commander";

import { DomainError } from "./errors.ts";
import { runDelete } from "./features/delete.ts";
import { runDownload } from "./features/download.ts";
import { runEnsureDir } from "./features/ensure-dir.ts";
import { runLs } from "./features/ls.ts";
import { runPut } from "./features/put/command.ts";
import { runStat } from "./features/stat.ts";
import { runUpload } from "./features/upload.ts";
import { createEventPresentation, type EventPresentationOptions } from "./human-ui.ts";
import { exitCodeForError, redactSecrets, writeFailure, writeSuccess } from "./output.ts";
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

type UploadOutputOptions = OutputOptions & {
  overwrite?: boolean;
  mkdir?: boolean;
};

type PutOutputOptions = OutputOptions & {
  force?: boolean;
  mkdir?: boolean;
};

type DeleteOutputOptions = OutputOptions & {
  strict?: boolean;
};

type DownloadOutputOptions = OutputOptions & { overwrite?: boolean };

function displayValue(value: unknown): string {
  return redactSecrets(String(value));
}

function writeCommandSuccess(
  command: "stat" | "ls" | "ensure-dir" | "upload" | "put" | "delete" | "download",
  result: { action: string; data: unknown },
  options: OutputOptions,
): void {
  if (options.json) {
    writeSuccess(command, result.action, result.data);
    return;
  }

  if (command === "stat") {
    const resource = (result.data as { resource: Record<string, unknown> | null }).resource;
    if (resource === null) {
      process.stdout.write("absent\n");
      return;
    }
    process.stdout.write(
      `${displayValue(resource.path)}\t${displayValue(resource.type)}\t${displayValue(resource.size ?? "-")}\t${displayValue(resource.modifiedAt ?? "-")}\n`,
    );
    return;
  }

  if (command === "ls") {
    const resources = (result.data as { resources: Array<Record<string, unknown>> }).resources;
    for (const resource of resources) {
      process.stdout.write(
        `${displayValue(resource.type)}\t${displayValue(resource.path)}\t${displayValue(resource.size ?? "-")}\t${displayValue(resource.modifiedAt ?? "-")}\n`,
      );
    }
    return;
  }

  if (command === "upload" || command === "put") {
    const data = result.data as {
      path: string;
      resourceId: string;
      size: number;
      modifiedAt: string;
      reason?: string;
    };
    process.stdout.write(
      `${displayValue(result.action)}\t${displayValue(data.path)}\t${displayValue(data.resourceId)}\t${displayValue(data.size)}\t${displayValue(data.modifiedAt)}${data.reason === undefined ? "" : `\t${displayValue(data.reason)}`}\n`,
    );
    return;
  }

  if (command === "delete") {
    const data = result.data as { path: string; resourceId?: string; type?: string };
    process.stdout.write(
      `${displayValue(result.action)}\t${displayValue(data.path)}\t${displayValue(data.resourceId ?? "-")}\t${displayValue(data.type ?? "-")}\n`,
    );
    return;
  }

  if (command === "download") {
    const data = result.data as {
      remotePath: string;
      localPath: string;
      resourceId: string;
      size: number;
      modifiedAt: string;
    };
    process.stdout.write(
      `${displayValue(result.action)}\t${displayValue(data.remotePath)}\t${displayValue(data.localPath)}\t${displayValue(data.resourceId)}\t${displayValue(data.size)}\t${displayValue(data.modifiedAt)}\n`,
    );
    return;
  }

  const data = result.data as { path: string; resourceId: string | null; createdPaths: string[] };
  process.stdout.write(
    `${displayValue(result.action)}\t${displayValue(data.path)}\t${displayValue(data.resourceId ?? "-")}\t${displayValue(data.createdPaths.join(",") || "-")}\n`,
  );
}

function addOutputOptions(command: Command): Command {
  return command
    .option("--json", "Print one machine-readable JSON envelope")
    .addOption(new Option("--verbose", "Print detailed progress events").conflicts("quiet"))
    .addOption(new Option("--quiet", "Suppress progress events").conflicts("verbose"));
}

function runtimeForCommand(
  runtimeFactory: RuntimeFactory,
  command: string,
  options: OutputOptions,
): Promise<Runtime> {
  return runtimeFactory({
    command,
    ...(options.json === undefined ? {} : { json: options.json }),
    ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
    ...(options.quiet === undefined ? {} : { quiet: options.quiet }),
  });
}

export function createProgram(runtimeFactory: RuntimeFactory = defaultRuntimeFactory): Command {
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
    .name("myboxctl")
    .description("Agent-friendly CLI for NAVER MYBOX file operations")
    .version(VERSION);

  addOutputOptions(
    program
      .command("stat")
      .description("Show metadata for an exact remote path")
      .argument("<remote-path>")
      .action(async (remotePath: string, options: OutputOptions) => {
        const runtime = await runtimeForCommand(runtimeFactory, "stat", options);
        try {
          const result = await runStat(remotePath, runtime.resolver);
          runtime.events.finish();
          writeCommandSuccess("stat", result, options);
        } finally {
          runtime.events.finish();
        }
      }),
  );

  addOutputOptions(
    program
      .command("ls")
      .description("List direct children of a remote directory")
      .argument("<remote-directory>")
      .action(async (remotePath: string, options: OutputOptions) => {
        const runtime = await runtimeForCommand(runtimeFactory, "ls", options);
        try {
          const result = await runLs(remotePath, runtime.resolver);
          runtime.events.finish();
          writeCommandSuccess("ls", result, options);
        } finally {
          runtime.events.finish();
        }
      }),
  );

  addOutputOptions(
    program
      .command("ensure-dir")
      .description("Create a remote directory hierarchy if it is missing")
      .argument("<remote-directory>")
      .action(async (remotePath: string, options: OutputOptions) => {
        const runtime = await runtimeForCommand(runtimeFactory, "ensure-dir", options);
        try {
          const result = await runEnsureDir(remotePath, runtime.resolver);
          runtime.events.finish();
          writeCommandSuccess("ensure-dir", result, options);
        } finally {
          runtime.events.finish();
        }
      }),
  );

  addOutputOptions(
    program
      .command("upload")
      .description("Upload a local file to an exact remote path")
      .argument("<local-path>")
      .argument("<remote-path>")
      .option("--overwrite", "Overwrite an existing remote file")
      .option("--mkdir", "Create missing remote parent directories")
      .action(async (localPath: string, remotePath: string, options: UploadOutputOptions) => {
        const runtime = await runtimeForCommand(runtimeFactory, "upload", options);
        const interrupt = new AbortController();
        const onInterrupt = () => interrupt.abort();
        process.once("SIGINT", onInterrupt);
        try {
          const result = await runUpload(
            localPath,
            remotePath,
            {
              ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
              ...(options.mkdir === undefined ? {} : { mkdir: options.mkdir }),
            },
            {
              client: runtime.client,
              resolver: runtime.resolver,
              uploader: runtime.uploader,
              timeoutMs: runtime.config.timeoutMs,
              eventSink: runtime.events.sink,
              signal: interrupt.signal,
            },
          );
          runtime.events.finish();
          writeCommandSuccess("upload", result, options);
        } finally {
          process.removeListener("SIGINT", onInterrupt);
          runtime.events.finish();
        }
      }),
  );

  addOutputOptions(
    program
      .command("put")
      .description("Upload a local file when metadata requires it")
      .argument("<local-path>")
      .argument("<remote-path>")
      .option("--force", "Overwrite regardless of file metadata")
      .option("--mkdir", "Create missing remote parent directories")
      .action(async (localPath: string, remotePath: string, options: PutOutputOptions) => {
        const runtime = await runtimeForCommand(runtimeFactory, "put", options);
        const interrupt = new AbortController();
        const onInterrupt = () => interrupt.abort();
        process.once("SIGINT", onInterrupt);
        try {
          const result = await runPut(
            localPath,
            remotePath,
            {
              ...(options.force === undefined ? {} : { force: options.force }),
              ...(options.mkdir === undefined ? {} : { mkdir: options.mkdir }),
            },
            {
              client: runtime.client,
              resolver: runtime.resolver,
              uploader: runtime.uploader,
              timeoutMs: runtime.config.timeoutMs,
              eventSink: runtime.events.sink,
              signal: interrupt.signal,
            },
          );
          runtime.events.finish();
          writeCommandSuccess("put", result, options);
        } finally {
          process.removeListener("SIGINT", onInterrupt);
          runtime.events.finish();
        }
      }),
  );

  addOutputOptions(
    program
      .command("download")
      .description("Download an exact remote file to a local path")
      .argument("<remote-file>")
      .argument("<local-path>")
      .option("--overwrite", "Atomically replace an existing regular local file")
      .action(async (remotePath: string, localPath: string, options: DownloadOutputOptions) => {
        const runtime = await runtimeForCommand(runtimeFactory, "download", options);
        const interrupt = new AbortController();
        const onInterrupt = () => interrupt.abort();
        process.once("SIGINT", onInterrupt);
        try {
          const result = await runDownload(
            remotePath,
            localPath,
            { ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }) },
            {
              client: runtime.client,
              resolver: runtime.resolver,
              downloader: runtime.downloader,
              timeoutMs: runtime.config.timeoutMs,
              signal: interrupt.signal,
            },
          );
          runtime.events.finish();
          writeCommandSuccess("download", result, options);
        } finally {
          process.removeListener("SIGINT", onInterrupt);
          runtime.events.finish();
        }
      }),
  );

  addOutputOptions(
    program
      .command("delete")
      .description("Move an exact remote resource to MYBOX trash")
      .argument("<remote-path>")
      .option("--strict", "Return not-found when the resource is absent")
      .action(async (remotePath: string, options: DeleteOutputOptions) => {
        const runtime = await runtimeForCommand(runtimeFactory, "delete", options);
        try {
          const result = await runDelete(
            remotePath,
            { ...(options.strict === undefined ? {} : { strict: options.strict }) },
            { client: runtime.client, resolver: runtime.resolver },
          );
          runtime.events.finish();
          writeCommandSuccess("delete", result, options);
        } finally {
          runtime.events.finish();
        }
      }),
  );

  return program;
}

function commandFromArgv(argv: readonly string[]): string {
  return argv[2] ?? "myboxctl";
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
