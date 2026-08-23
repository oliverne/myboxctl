import { DomainError } from "../errors.ts";

export type RootRemotePath = {
  readonly kind: "root";
  readonly normalized: "/";
  readonly components: readonly [];
  readonly parentPath: undefined;
  readonly basename: undefined;
};

export type ChildRemotePath = {
  readonly kind: "child";
  readonly normalized: string;
  readonly components: readonly [string, ...string[]];
  readonly parentPath: string;
  readonly basename: string;
};

export type RemotePath = RootRemotePath | ChildRemotePath;

function invalidPath(message: string): DomainError {
  return new DomainError("invalid-remote-path", message);
}

export function parseRemotePath(input: string): RemotePath {
  if (typeof input !== "string" || input.length === 0) {
    throw invalidPath("Remote path must not be empty.");
  }
  if (!input.startsWith("/")) {
    throw invalidPath("Remote path must be an absolute path starting with '/'.");
  }
  if (input.includes("\\")) {
    throw invalidPath("Remote path must use '/' separators only.");
  }
  if (input.includes("\u0000")) {
    throw invalidPath("Remote path must not contain NUL.");
  }

  const pathComponents = input.split("/").filter((component) => component.length > 0);
  if (pathComponents.some((component) => component === "." || component === "..")) {
    throw invalidPath("Remote path must not contain '.' or '..' components.");
  }

  if (pathComponents.length === 0) {
    return {
      kind: "root",
      normalized: "/",
      components: [],
      parentPath: undefined,
      basename: undefined,
    };
  }

  const normalized = `/${pathComponents.join("/")}`;
  const childComponents = pathComponents as [string, ...string[]];
  const lastComponent = childComponents.at(-1);
  if (lastComponent === undefined) {
    throw invalidPath("Remote path must contain a valid component.");
  }

  const parent = childComponents.slice(0, -1);
  return {
    kind: "child",
    normalized,
    components: childComponents,
    parentPath: parent.length === 0 ? "/" : `/${parent.join("/")}`,
    basename: lastComponent,
  };
}

export function normalizeRemotePath(input: string): string {
  return parseRemotePath(input).normalized;
}

function toRemotePath(input: RemotePath | string): RemotePath {
  return typeof input === "string" ? parseRemotePath(input) : input;
}

export function parentPath(input: RemotePath | string): string | undefined {
  return toRemotePath(input).parentPath;
}

export function basename(input: RemotePath | string): string | undefined {
  return toRemotePath(input).basename;
}

export function components(input: RemotePath | string): readonly string[] {
  return toRemotePath(input).components;
}
