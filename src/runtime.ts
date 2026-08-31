import { type AppConfig, type ConfigOptions, loadConfig } from "./config.ts";
import {
  createEventPresentation,
  type EventPresentation,
  type EventPresentationOptions,
} from "./human-ui.ts";
import { type ClientDependencies, MyboxClient } from "./mybox/client.ts";
import { type DownloaderDependencies, MyboxDownloader } from "./mybox/download.ts";
import { defaultRateLimitStatePath, SharedRateLimiter } from "./mybox/rate-limit.ts";
import { MyboxUploader, type UploaderDependencies } from "./mybox/upload.ts";
import { RemoteResolver } from "./remote/resolver.ts";

export type Runtime = {
  config: AppConfig;
  client: MyboxClient;
  resolver: RemoteResolver;
  uploader: MyboxUploader;
  downloader: MyboxDownloader;
  events: EventPresentation;
};

export type RuntimeOptions = {
  config?: AppConfig;
  configOptions?: ConfigOptions;
  clientDependencies?: Partial<ClientDependencies>;
  uploaderDependencies?: Partial<UploaderDependencies>;
  downloaderDependencies?: Partial<DownloaderDependencies>;
  presentation?: EventPresentationOptions;
};

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const config = options.config ?? (await loadConfig(options.configOptions));
  const events = createEventPresentation(options.presentation ?? { command: "myboxctl" });
  const rateLimiter =
    options.clientDependencies?.rateLimiter ??
    new SharedRateLimiter({ statePath: defaultRateLimitStatePath() }, { eventSink: events.sink });
  const client = new MyboxClient(config, {
    ...options.clientDependencies,
    rateLimiter,
    eventSink: options.clientDependencies?.eventSink ?? events.sink,
  });
  return {
    config,
    client,
    resolver: new RemoteResolver(client),
    uploader: new MyboxUploader({
      ...options.uploaderDependencies,
      eventSink: options.uploaderDependencies?.eventSink ?? events.sink,
    }),
    downloader: new MyboxDownloader(options.downloaderDependencies),
    events,
  };
}
