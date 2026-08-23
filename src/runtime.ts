import { type AppConfig, type ConfigOptions, loadConfig } from "./config.ts";
import { type ClientDependencies, MyboxClient } from "./mybox/client.ts";
import { defaultRateLimitStatePath, SharedRateLimiter } from "./mybox/rate-limit.ts";
import { RemoteResolver } from "./remote/resolver.ts";

export type Runtime = {
  config: AppConfig;
  client: MyboxClient;
  resolver: RemoteResolver;
};

export type RuntimeOptions = {
  config?: AppConfig;
  configOptions?: ConfigOptions;
  clientDependencies?: Partial<ClientDependencies>;
};

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const config = options.config ?? (await loadConfig(options.configOptions));
  const rateLimiter =
    options.clientDependencies?.rateLimiter ??
    new SharedRateLimiter({ statePath: defaultRateLimitStatePath() });
  const client = new MyboxClient(config, { ...options.clientDependencies, rateLimiter });
  return {
    config,
    client,
    resolver: new RemoteResolver(client),
  };
}
