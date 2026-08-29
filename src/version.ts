declare const MYBOXCTL_VERSION: string | undefined;

export const VERSION =
  typeof MYBOXCTL_VERSION === "string" && MYBOXCTL_VERSION.length > 0 ? MYBOXCTL_VERSION : "0.0.0";
