import { describe, expect, test } from "bun:test";

import { createProgram } from "./cli.ts";

describe("createProgram", () => {
  test("creates the myboxctl CLI", () => {
    const program = createProgram();

    expect(program.name()).toBe("myboxctl");
    expect(program.version()).toBe("0.0.0");
  });
});
