import type {
  ApiConfigWithWebsocket,
  BaseEnvironment,
  BlogConfig,
  CommunicationConfig,
  LandingConfig,
} from '@forepath/shared/frontend/util-configuration';

export type ForepathBillingWebsocket = 'billing' | 'projects';

export interface ForepathBillingConsoleEnvironment extends BaseEnvironment {
  billing: ApiConfigWithWebsocket<ForepathBillingWebsocket>;
}

export interface ForepathLandingEnvironment extends BaseEnvironment {
  landing: LandingConfig;
  communication: CommunicationConfig;
  blog?: BlogConfig;
}

/** Default fileReplacement target type (landingpage). */
export type Environment = ForepathLandingEnvironment;
