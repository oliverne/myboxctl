#!/usr/bin/env bun

import { Command, CommanderError } from "commander";

import { DomainError, normalizeError } from "./errors.ts";
import { runLs } from "./features/ls.ts";
import { runStat } from "./features/stat.ts";
import { exitCodeForError, redactSecrets, writeFailure, writeSuccess } from "./output.ts";
import { createRuntime, type Runtime } from "./runtime.ts";

export type RuntimeFactory = () => Promise<Runtime>;

type OutputOptions = {
  json?: boolean;
};

function displayValue(value: unknown): string {
  return redactSecrets(String(value));
}

function writeCommandSuccess(
  command: "stat" | "ls",
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

  const resources = (result.data as { resources: Array<Record<string, unknown>> }).resources;
  for (const resource of resources) {
    process.stdout.write(
      `${displayValue(resource.type)}\t${displayValue(resource.path)}\t${displayValue(resource.size ?? "-")}\t${displayValue(resource.modifiedAt ?? "-")}\n`,
    );
  }
}

function addJsonOption(command: Command): Command {
  return command.option("--json", "Print one machine-readable JSON envelope");
}

export function createProgram(runtimeFactory: RuntimeFactory = createRuntime): Command {
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
    .name("myboxctl")
    .description("Agent-friendly CLI for NAVER MYBOX uploads")
    .version("0.0.0");

  addJsonOption(
    program
      .command("stat")
      .description("Show metadata for an exact remote path")
      .argument("<remote-path>")
      .action(async (remotePath: string, options: OutputOptions) => {
        const runtime = await runtimeFactory();
        const result = await runStat(remotePath, runtime.resolver);
        writeCommandSuccess("stat", result, options);
      }),
  );

  addJsonOption(
    program
      .command("ls")
      .description("List direct children of a remote directory")
      .argument("<remote-directory>")
      .action(async (remotePath: string, options: OutputOptions) => {
        const runtime = await runtimeFactory();
        const result = await runLs(remotePath, runtime.resolver);
        writeCommandSuccess("ls", result, options);
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
  runtimeFactory: RuntimeFactory = createRuntime,
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
      const normalized = normalizeError(cliError);
      process.stderr.write(`${normalized.message}\n`);
    }
    return exitCodeForError(cliError);
  }
}

if (import.meta.main) {
  process.exitCode = await runCli();
}
