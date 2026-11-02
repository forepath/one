import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ENVIRONMENT,
  isFleetConsole,
  resolveApiWebsocketUrl,
  type LoadweaverConsoleEnvironment,
  type LoadweaverConsoleWebsocket,
} from '@forepath/loadweaver/frontend/util-configuration';

/** The cluster the console works on in fleet mode (per browser tab). */
export const FLEET_ACTIVE_CLUSTER_STORAGE_KEY = 'loadweaver-fleet-active-cluster';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Whether a value is a fleet cluster id (the relay's path parameter is a UUID). */
export function isFleetClusterId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The fleet's REST relay for a cluster: `<fleet>/clusters/<id>/api` (the console appends the cluster's paths). */
export function fleetRelayApiUrl(fleetApiUrl: string, clusterId: string): string {
  return `${trimSlash(fleetApiUrl)}/clusters/${encodeURIComponent(clusterId)}/api`;
}

/**
 * The REST base every console service calls: the control plane's (`console.urls.restApi`) in single-cluster mode,
 * the fleet's relay for the active cluster in fleet mode (`null` while no cluster is selected).
 */
export function resolveConsoleRestApi(
  environment: LoadweaverConsoleEnvironment,
  activeClusterId: string | null,
): string | null {
  if (!isFleetConsole(environment)) return trimSlash(environment.console.urls.restApi);

  return activeClusterId ? fleetRelayApiUrl(environment.fleet?.apiUrl ?? '', activeClusterId) : null;
}

/** A cluster's own endpoint as a link base: `http(s)` only, without trailing slashes or a trailing `/api`. */
export function nativeEndpoint(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null;

  try {
    const url = new URL(endpoint);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    return trimSlash(`${url.origin}${url.pathname}`).replace(/\/api$/, '');
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Where the console's requests go (3.24). Single-cluster mode: the control plane from the environment, unchanged.
 * Fleet mode (`mode: 'fleet'`): the fleet's API for the fleet views, and for every cluster view the fleet's relay of
 * the **active cluster** (`/clusters/<id>/api/*`, sockets through `socket/fleet`). The active cluster is kept per
 * tab (session storage), so a reload stays on it; switching goes through `ConsoleFleetFacade.openCluster`, which
 * also clears the cluster-scoped state.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleEndpointService {
  // Optional: views that only ask for the mode (and their tests) work without a console environment.
  private readonly environment =
    inject<LoadweaverConsoleEnvironment | null>(ENVIRONMENT, { optional: true }) ??
    ({ console: { urls: { restApi: '', websocket: { default: '' } } } } as unknown as LoadweaverConsoleEnvironment);

  readonly fleetMode = isFleetConsole(this.environment);

  private readonly active = signal<string | null>(this.fleetMode ? this.restore() : null);

  /** The cluster the cluster views work on (fleet mode), `null` in single-cluster mode or before one is chosen. */
  readonly activeClusterId = this.active.asReadonly();

  /**
   * The active cluster's own endpoint (fleet mode, from the fleet's cluster DTO, e.g. `https://cp.example.com`):
   * what stays native — the installer, the recovery kit, approvals — is reached there. `null` until known.
   */
  private readonly nativeEndpoint = signal<string | null>(null);
  readonly activeClusterEndpoint = this.nativeEndpoint.asReadonly();
  /**
   * The active cluster's own public API / console URLs (fleet mode, from its `GET /cluster`, 2026-10-29): what its
   * installer embeds and where its console lives. Preferred over the fleet's connection endpoint, which may be an
   * address only the fleet can reach (e.g. `host.docker.internal`).
   */
  private readonly publicUrls = signal<{ api: string | null; console: string | null } | null>(null);
  /** The active cluster's public API base (fleet mode): its public URL, else the fleet's connection endpoint. */
  readonly activeClusterPublicApi = computed(() => this.publicUrls()?.api ?? this.nativeEndpoint());

  /** REST base of the cluster views (see {@link resolveConsoleRestApi}); a placeholder relay path without a cluster. */
  restApi(): string {
    return (
      resolveConsoleRestApi(this.environment, this.active()) ??
      // No cluster chosen: the fleet refuses the id (400), and the views aren't routed there anyway.
      `${this.fleetApi()}/clusters/none/api`
    );
  }

  /**
   * Whether the cluster API is reachable at all: always in single-cluster mode, in fleet mode only with an active
   * cluster (the fleet views have none; calls there would go to the placeholder relay path and answer 400).
   */
  hasClusterApi(): boolean {
    return !this.fleetMode || this.active() !== null;
  }

  /** REST base of the fleet service (fleet mode). */
  fleetApi(): string {
    return trimSlash(this.environment.fleet?.apiUrl ?? '');
  }

  /** The fleet's socket relay namespace (fleet mode). */
  fleetSocketUrl(): string | null {
    return this.environment.fleet?.websocketUrl || null;
  }

  /** Single-cluster mode: the control plane's namespace URL. */
  clusterSocketUrl(endpoint: LoadweaverConsoleWebsocket): string | null {
    return resolveApiWebsocketUrl(this.environment.console.urls.websocket, endpoint) || null;
  }

  /**
   * Records the native endpoint of a cluster (fleet mode), only while that cluster is active and only for `http(s)`
   * URLs (it ends up in links and in the installer line).
   */
  setClusterEndpoint(clusterId: string, endpoint: string | null | undefined): void {
    if (!this.fleetMode || clusterId !== this.active()) return;

    this.nativeEndpoint.set(nativeEndpoint(endpoint));
  }

  /** Records the active cluster's public API / console URLs (fleet mode; only `http(s)` URLs, only while active). */
  setClusterPublicUrls(clusterId: string, api: string | null | undefined, console: string | null | undefined): void {
    if (!this.fleetMode || clusterId !== this.active()) return;

    this.publicUrls.set({ api: nativeEndpoint(api), console: nativeEndpoint(console) });
  }

  /**
   * `<console><path>` in the active cluster's own console (fleet mode): its console URL, else its public URL, else the
   * fleet's connection endpoint; `null` while none is known.
   */
  nativeConsoleUrl(path: string): string | null {
    const urls = this.publicUrls();
    const endpoint = urls?.console ?? urls?.api ?? this.nativeEndpoint();

    return endpoint ? `${endpoint}${path.startsWith('/') ? path : `/${path}`}` : null;
  }

  /** Sets (or clears) the active cluster; only in fleet mode and only for cluster ids. */
  setActiveCluster(clusterId: string | null): void {
    if (!this.fleetMode) return;

    const id = isFleetClusterId(clusterId) ? clusterId : null;

    if (id !== this.active()) {
      this.nativeEndpoint.set(null);
      this.publicUrls.set(null);
    }

    this.active.set(id);

    const store = sessionStore();

    if (id) store?.setItem(FLEET_ACTIVE_CLUSTER_STORAGE_KEY, id);
    else store?.removeItem(FLEET_ACTIVE_CLUSTER_STORAGE_KEY);
  }

  private restore(): string | null {
    const stored = sessionStore()?.getItem(FLEET_ACTIVE_CLUSTER_STORAGE_KEY) ?? null;

    return isFleetClusterId(stored) ? stored : null;
  }
}

/**
 * An environment for a shared feature (webhooks, release announcements) whose `apiUrl` follows the console's REST base:
 * the control plane natively, the active cluster's relay in fleet mode — read on every request, so switching clusters
 * switches it too (fleet cluster view = full parity, 2026-10-27).
 */
export function clusterScopedApiEnvironment<T extends object>(
  endpoints: Pick<ConsoleEndpointService, 'restApi'>,
  rest: T,
): T & { readonly apiUrl: string } {
  return Object.defineProperty({ ...rest }, 'apiUrl', {
    enumerable: true,
    get: () => endpoints.restApi().replace(/\/+$/, ''),
  }) as T & { readonly apiUrl: string };
}
