import type {
  ApiConfigWithWebsocket,
  BaseEnvironment,
  CommunicationConfig,
  DocsConfig,
  LandingConfig,
} from '@forepath/shared/frontend/util-configuration';

export type LoadweaverBillingWebsocket = 'billing' | 'projects';

/** Billing portal (portal.loadweaver.com): the Decabill console in Loadweaver branding, tenant `loadweaver`. */
export interface LoadweaverBillingConsoleEnvironment extends BaseEnvironment {
  billing: ApiConfigWithWebsocket<LoadweaverBillingWebsocket>;
}

/** Socket.IO namespaces of the control plane the console uses. */
export type LoadweaverConsoleWebsocket = 'plans' | 'logs' | 'terminals' | 'tunnels' | 'topology';

/**
 * The cluster console: served next to each cluster's control plane, talks to its API (`console.urls.restApi`) and
 * Socket.IO namespaces (named endpoints, `default` = plans).
 */
export interface LoadweaverConsoleEnvironment extends BaseEnvironment {
  console: ApiConfigWithWebsocket<LoadweaverConsoleWebsocket>;
  /**
   * `fleet` (3.24): the console signs in at a fleet service and manages several clusters through it — the fleet
   * views plus every cluster view against the selected cluster through the fleet's relay. Default / `cluster`: one
   * cluster's control plane (`console.urls`).
   */
  mode?: 'cluster' | 'fleet';
  /** The fleet service (only read in `mode: 'fleet'`). */
  fleet?: LoadweaverFleetConfig;
}

/** Where the console reaches the fleet service in fleet mode. */
export interface LoadweaverFleetConfig {
  /** REST base of the fleet (`https://fleet.example.com/api`); sign-in, fleet views and the relay live here. */
  apiUrl: string;
  /** Socket.IO namespace of the fleet's socket relay (`https://fleet.example.com/socket/fleet`). */
  websocketUrl: string;
}

/** Whether the console runs in fleet mode (`mode: 'fleet'` with a fleet API URL). */
export function isFleetConsole(environment: Pick<LoadweaverConsoleEnvironment, 'mode' | 'fleet'>): boolean {
  return environment.mode === 'fleet' && !!environment.fleet?.apiUrl;
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

/** Documentation site (docs.loadweaver.com): the shared docs app rendering `docs/loadweaver/**`. */
export interface LoadweaverDocsEnvironment extends BaseEnvironment {
  docs: DocsConfig;
}

/** Default fileReplacement target type (landingpage). */
export type Environment = LoadweaverLandingEnvironment;
