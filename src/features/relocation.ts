import { DomainError, normalizeError } from "../errors.ts";
import type { MyboxClient } from "../mybox/client.ts";
import { canonicalRemoteName, hasControlCharacter } from "../remote/path.ts";
import type { FoundResolution, RemoteResolver } from "../remote/resolver.ts";
import { assertPortableName } from "./tree-manifest.ts";

export type RelocationDependencies = {
  client: MyboxClient;
  resolver: RemoteResolver;
};

export type RelocationData = {
  resourceId: string;
  type: "file" | "folder";
  path: string;
  newPath: string;
};

export function invalidArgument(message: string, code?: string): DomainError {
  return new DomainError("invalid-arguments", message, code === undefined ? {} : { code });
}

/**
 * `rename` takes a single path component, not a path. Structural problems and non-portable names are
 * rejected before any mutation. The name is sent exactly as given: the server preserves NFC and NFD
 * spellings (see API-13/API-15 in the API ledger), so the CLI does not silently normalize it.
 */
export function assertNewResourceName(name: string): void {
  if (name.length === 0) {
    throw invalidArgument("The new name must not be empty.");
  }
  if (name === "." || name === "..") {
    throw invalidArgument(`The new name must not be '.' or '..': ${name}.`);
  }
  if (/[/\\]/u.test(name)) {
    throw invalidArgument(`The new name must be a single path component: ${name}.`);
  }
  if (hasControlCharacter(name)) {
    throw invalidArgument("The new name must not contain control characters.");
  }

  try {
    assertPortableName(name);
  } catch (error) {
    throw invalidArgument(
      error instanceof Error ? error.message : `The new name is not portable: ${name}.`,
      "NON_PORTABLE_NAME",
    );
  }
}

export function childPath(parentPath: string, name: string): string {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

export function resourceType(resolution: FoundResolution): "file" | "folder" {
  return resolution.resource.type.toLowerCase() === "folder" ? "folder" : "file";
}

/**
 * Rejects a destination name that collides with a different sibling under the destination parent.
 * Comparison uses the NFC canonical key because the server keeps NFC and NFD spellings as separate
 * resources but a user-facing name collision must fail closed (see API-14/API-15).
 */
export async function assertSiblingNameAvailable(
  resolver: RemoteResolver,
  input: {
    parentPath: string;
    parentId: string;
    name: string;
    excludeResourceId: string;
  },
): Promise<void> {
  const siblings = await resolver.listChildren(input.parentPath, input.parentId);
  const key = canonicalRemoteName(input.name);
  const collision = siblings.find(
    (sibling) =>
      sibling.resourceId !== input.excludeResourceId && canonicalRemoteName(sibling.name) === key,
  );
  if (collision !== undefined) {
    throw new DomainError(
      "conflict",
      `A resource with the same name already exists: ${childPath(input.parentPath, input.name)}.`,
      { code: "NAME_CONFLICT" },
    );
  }
}

async function holdsOriginalResource(
  resolver: RemoteResolver,
  path: string,
  resourceId: string,
): Promise<boolean> {
  const resolution = await resolver.resolveExact(path);
  return resolution.kind === "found" && resolution.resource.resourceId === resourceId;
}

async function originalResourceIsGone(
  resolver: RemoteResolver,
  path: string,
  resourceId: string,
): Promise<boolean> {
  for (const waitMs of [0, 250, 1_000, 2_000]) {
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
    if (!(await holdsOriginalResource(resolver, path, resourceId))) {
      return true;
    }
  }
  return false;
}

type RelocationObservation = "relocated" | "original" | "unknown";

function unconfirmedRelocation(newPath: string): DomainError {
  return new DomainError(
    "api-unavailable",
    `The MYBOX relocation result could not be confirmed at ${newPath}.`,
    { code: "MUTATION_UNCONFIRMED" },
  );
}

/**
 * Observes a relocation by ID without repeating the request. `relocated` means the original
 * resource ID is now uniquely reachable at the new path and no longer at the old path; `original`
 * means the ID is still at the old path and absent from the new path; anything else is `unknown`.
 */
async function observeRelocation(
  resolver: RemoteResolver,
  input: { path: string; newPath: string; resourceId: string },
): Promise<RelocationObservation> {
  const relocated = await resolver.resolveExact(input.newPath, { poll: true });
  const newPathHoldsResource =
    relocated.kind === "found" && relocated.resource.resourceId === input.resourceId;
  if (!newPathHoldsResource) {
    if (await holdsOriginalResource(resolver, input.path, input.resourceId)) {
      return "original";
    }
    return "unknown";
  }

  return (await originalResourceIsGone(resolver, input.path, input.resourceId))
    ? "relocated"
    : "unknown";
}

/**
 * Confirms a mutation by ID instead of repeating the request: the original resource ID must be the
 * only match at the new path and must no longer be reachable at the previous path.
 */
export async function verifyRelocation(
  resolver: RemoteResolver,
  input: { path: string; newPath: string; resourceId: string },
): Promise<void> {
  if ((await observeRelocation(resolver, input)) !== "relocated") {
    throw unconfirmedRelocation(input.newPath);
  }
}

/**
 * A mutation whose outcome is uncertain (timeout, 5xx, 429 or a malformed success body) may still
 * have been applied by the server. `reconcileRelocation` observes the result by ID; it rethrows the
 * original failure when the resource provably stayed at the old path, and reports
 * `MUTATION_UNCONFIRMED` otherwise. It never repeats the mutation.
 */
export async function reconcileRelocation(
  resolver: RemoteResolver,
  input: { path: string; newPath: string; resourceId: string },
  failure: DomainError,
): Promise<void> {
  let observation: RelocationObservation;
  try {
    observation = await observeRelocation(resolver, input);
  } catch (error) {
    const observationFailure = normalizeError(error);
    throw observationFailure.code === "MUTATION_UNCONFIRMED"
      ? observationFailure
      : new DomainError(
          "api-unavailable",
          `The MYBOX relocation result could not be confirmed at ${input.newPath}.`,
          { code: "MUTATION_UNCONFIRMED", cause: observationFailure },
        );
  }

  if (observation === "relocated") {
    return;
  }
  if (observation === "original") {
    throw failure;
  }
  throw unconfirmedRelocation(input.newPath);
}

/**
 * True when a failed mutation request could still have been applied server-side. 409/400 and other
 * definite client errors are authoritative and must surface unchanged rather than be reconciled.
 */
export function isUncertainMutationFailure(error: DomainError): boolean {
  if (error.retryable) {
    return true;
  }
  if (error.status !== undefined && error.status >= 500) {
    return true;
  }
  return error.code === "API_RESPONSE_INVALID";
}
