import type {
  ApiConfigWithWebsocket,
  BaseEnvironment,
  CommunicationConfig,
  LandingConfig,
} from '@forepath/shared/frontend/util-configuration';

export type LoadweaverBillingWebsocket = 'billing' | 'projects';

/** Billing portal (portal.loadweaver.com): the Decabill console in Loadweaver branding, tenant `loadweaver`. */
export interface LoadweaverBillingConsoleEnvironment extends BaseEnvironment {
  billing: ApiConfigWithWebsocket<LoadweaverBillingWebsocket>;
}

/**
 * Landing page (loadweaver.com). Pre-launch: there is no public plan API yet. `landing.urls.portal` is the
 * Loadweaver billing portal, which serves the statutory withdrawal page (footer link) like on the other landing
 * pages;
 * `communication` feeds the shared contact form.
 */
export interface LoadweaverLandingEnvironment extends BaseEnvironment {
  landing: LandingConfig;
  communication: CommunicationConfig;
}

/** Default fileReplacement target type (landingpage). */
export type Environment = LoadweaverLandingEnvironment;
