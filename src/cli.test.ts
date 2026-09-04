import { describe, expect, test } from "bun:test";

import { createProgram } from "./cli.ts";
import { VERSION } from "./version.ts";

describe("createProgram", () => {
  test("importing the CLI does not change the host process exit code", () => {
    expect(process.exitCode).toBeUndefined();
  });

  test("creates the myboxctl CLI", () => {
    const program = createProgram();

    expect(program.name()).toBe("myboxctl");
    expect(program.version()).toBe(VERSION);
  });
});
