#!/usr/bin/env bun

import { Command } from "commander";

export function createProgram(): Command {
  return new Command()
    .name("myboxctl")
    .description("Agent-friendly CLI for NAVER MYBOX uploads")
    .version("0.0.0");
}

if (import.meta.main) {
  await createProgram().parseAsync(Bun.argv);
}
