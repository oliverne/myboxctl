import { parseRemotePath, type RemotePath } from "./path.ts";

export type RemoteDestination = {
  readonly path: RemotePath;
  readonly directoryIntent: boolean;
};

/** Parse a remote destination while retaining a trailing-slash directory intent. */
export function parseRemoteDestination(input: string): RemoteDestination {
  const directoryIntent = input === "/" || input.endsWith("/");
  return { path: parseRemotePath(input), directoryIntent };
}
