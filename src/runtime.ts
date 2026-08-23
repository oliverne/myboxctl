import { type AppConfig, type ConfigOptions, loadConfig } from "./config.ts";
import { type ClientDependencies, MyboxClient } from "./mybox/client.ts";
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
  const client = new MyboxClient(config, options.clientDependencies);
  return {
    config,
    client,
    resolver: new RemoteResolver(client),
  };
}
