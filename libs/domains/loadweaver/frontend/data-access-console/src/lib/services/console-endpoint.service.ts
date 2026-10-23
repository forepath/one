import { inject, Injectable, signal } from '@angular/core';
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

  /** REST base of the cluster views (see {@link resolveConsoleRestApi}); a placeholder relay path without a cluster. */
  restApi(): string {
    return (
      resolveConsoleRestApi(this.environment, this.active()) ??
      // No cluster chosen: the fleet refuses the id (400), and the views aren't routed there anyway.
      `${this.fleetApi()}/clusters/none/api`
    );
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

  /** Sets (or clears) the active cluster; only in fleet mode and only for cluster ids. */
  setActiveCluster(clusterId: string | null): void {
    if (!this.fleetMode) return;

    const id = isFleetClusterId(clusterId) ? clusterId : null;

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
