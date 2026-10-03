import type {
  ApiConfigWithWebsocket,
  BaseEnvironment,
  CommunicationConfig,
  DocsConfig,
  LandingConfigWithRestApi,
} from '@forepath/shared/frontend/util-configuration';

export type DecabillBillingWebsocket = 'billing' | 'projects';

export interface DecabillBillingConsoleEnvironment extends BaseEnvironment {
  billing: ApiConfigWithWebsocket<DecabillBillingWebsocket>;
}

export interface DecabillLandingEnvironment extends BaseEnvironment {
  landing: LandingConfigWithRestApi;
  communication: CommunicationConfig;
}

export interface DecabillDocsEnvironment extends BaseEnvironment {
  docs: DocsConfig;
}

/** Default fileReplacement target type (billing-console). */
export type Environment = DecabillBillingConsoleEnvironment;
