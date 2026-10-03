import type {
  ApiConfigWithWebsocket,
  BaseEnvironment,
  ChatModelOptions,
  CommunicationConfig,
  DocsConfig,
  LandingConfigWithRestApi,
} from '@forepath/shared/frontend/util-configuration';

export type AgenstraAgentWebsocket = 'tickets' | 'status' | 'vnc' | 'pages';
export type AgenstraBillingWebsocket = 'billing' | 'projects';

export interface AgenstraAgentConsoleEnvironment extends BaseEnvironment {
  console: ApiConfigWithWebsocket<AgenstraAgentWebsocket>;
  chatModelOptions: ChatModelOptions;
}

export interface AgenstraBillingConsoleEnvironment extends BaseEnvironment {
  billing: ApiConfigWithWebsocket<AgenstraBillingWebsocket>;
}

export interface AgenstraLandingEnvironment extends BaseEnvironment {
  landing: LandingConfigWithRestApi;
  communication: CommunicationConfig;
}

export interface AgenstraDocsEnvironment extends BaseEnvironment {
  docs: DocsConfig;
}

/** Default fileReplacement target type (agent-console). */
export type Environment = AgenstraAgentConsoleEnvironment;
