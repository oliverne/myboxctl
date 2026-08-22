import { type AppConfig, type ConfigOptions, loadConfig } from "./config.ts";
import { type ClientDependencies, MyboxClient } from "./mybox/client.ts";

export type Runtime = {
  config: AppConfig;
  client: MyboxClient;
};

export type RuntimeOptions = {
  config?: AppConfig;
  configOptions?: ConfigOptions;
  clientDependencies?: Partial<ClientDependencies>;
};

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const config = options.config ?? (await loadConfig(options.configOptions));
  return {
    config,
    client: new MyboxClient(config, options.clientDependencies),
  };
}
