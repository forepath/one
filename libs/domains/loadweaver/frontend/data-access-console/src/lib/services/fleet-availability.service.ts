import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { fleetRelayRefusalMessage } from '@forepath/loadweaver/frontend/util-configuration';
import { catchError, EMPTY, interval, map, of, switchMap, throwError, type Observable, type Subscription } from 'rxjs';

import type { FleetAvailability, FleetCluster } from '../types/fleet.types';
import { ConsoleEndpointService, fleetRelayApiUrl } from './console-endpoint.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** How often the open cluster's availability is re-read (the fleet polls its clusters every minute). */
export const FLEET_AVAILABILITY_REFRESH_MS = 30_000;

/** POSTs that only read (the fleet relay's `RELAY_READ_POSTS`): allowed on a read-only cluster, too. */
const READ_POSTS: readonly RegExp[] = [/^dashboards\/query$/, /^topology\/preview$/];

/**
 * A cluster's availability (3.43, 2026-10-31): the fleet's `availability`, else derived from `health` (older fleets:
 * only `unreachable` is known then).
 */
export function fleetAvailabilityOf(
  cluster: (Pick<FleetCluster, 'health'> & { availability?: FleetAvailability }) | null | undefined,
): FleetAvailability {
  if (cluster?.availability) return cluster.availability;

  const health = cluster?.health;
  const database = health?.database;

  if (health?.state === 'unreachable')
    return { state: 'unreachable', reason: health.error, freeze: null, takenOverAt: null, checkedAt: health.checkedAt };

  return {
    state: database?.readOnly ? 'read-only' : 'reachable',
    reason: database?.readOnly ? database.reason : null,
    freeze: database?.freeze ?? null,
    takenOverAt: database?.takenOverAt ?? null,
    checkedAt: health?.checkedAt ?? null,
  };
}

/** Whether changes to the cluster are paused (unreachable or read-only). */
export function fleetWritesPaused(availability: FleetAvailability | null | undefined): boolean {
  return !!availability && availability.state !== 'reachable';
}

/** Whether a request to a cluster's relay changes something (`path` relative to the relay's `/api`). */
export function isFleetRelayWrite(method: string, path: string): boolean {
  const upper = method.toUpperCase();

  if (READ_METHODS.has(upper)) return false;

  const clean = path.replace(/^\/+|\/+$/g, '');

  return !(upper === 'POST' && READ_POSTS.some((p) => p.test(clean)));
}

/**
 * The active cluster's availability in fleet mode (3.43, 2026-10-31): recorded from the fleet's cluster DTO (every
 * access load) and refreshed periodically by the console shell. Drives the banner on the cluster's pages, the capped
 * access (mutating buttons disabled) and {@link fleetWriteGuardInterceptor}.
 */
@Injectable({ providedIn: 'root' })
export class FleetClusterAvailabilityService {
  private readonly endpoints = inject(ConsoleEndpointService);
  private readonly http = inject(HttpClient);

  private readonly entry = signal<{ clusterId: string; availability: FleetAvailability } | null>(null);
  private readonly activeCluster$ = toObservable(this.endpoints.activeClusterId);
  private poll: Subscription | null = null;

  /** The active cluster's availability (null: single-cluster mode, no cluster open, or not known yet). */
  readonly availability = computed(() => {
    const entry = this.entry();

    return entry && entry.clusterId === this.endpoints.activeClusterId() ? entry.availability : null;
  });

  /** The availability while changes are paused (unreachable / read-only), else null. */
  readonly paused = computed(() => {
    const availability = this.availability();

    return fleetWritesPaused(availability) ? availability : null;
  });

  /** Records what the fleet said about a cluster (only kept for the active one). */
  record(clusterId: string, cluster: Pick<FleetCluster, 'health'> & { availability?: FleetAvailability }): void {
    if (!this.endpoints.fleetMode || clusterId !== this.endpoints.activeClusterId()) return;

    this.entry.set({ clusterId, availability: fleetAvailabilityOf(cluster) });
  }

  /** Re-reads the active cluster from the fleet (`GET <fleet>/clusters/<id>`); errors keep the last state. */
  refresh(): Observable<FleetAvailability | null> {
    const clusterId = this.endpoints.activeClusterId();

    if (!this.endpoints.fleetMode || !clusterId) return of(null);

    return this.http.get<FleetCluster>(`${this.endpoints.fleetApi()}/clusters/${encodeURIComponent(clusterId)}`).pipe(
      map((cluster) => {
        this.record(clusterId, cluster);

        return this.availability();
      }),
      catchError(() => of(this.availability())),
    );
  }

  /** Re-reads the open cluster periodically (fleet mode, signed in; idempotent). */
  start(periodMs = FLEET_AVAILABILITY_REFRESH_MS): void {
    if (!this.endpoints.fleetMode || this.poll) return;

    this.poll = this.activeCluster$
      .pipe(switchMap((clusterId) => (clusterId ? interval(periodMs).pipe(switchMap(() => this.refresh())) : EMPTY)))
      .subscribe();
  }

  stop(): void {
    this.poll?.unsubscribe();
    this.poll = null;
  }

  /**
   * The refusal for a request (null: let it through): a change to the active cluster's relay while that cluster is
   * unreachable / read-only.
   */
  writeRefusal(method: string, url: string): 'cluster-unreachable' | 'cluster-read-only' | null {
    const clusterId = this.endpoints.activeClusterId();
    const paused = this.paused();

    if (!this.endpoints.fleetMode || !clusterId || !paused) return null;

    const base = fleetRelayApiUrl(this.endpoints.fleetApi(), clusterId);
    const path = url.split('?')[0];

    if (path !== base && !path.startsWith(`${base}/`)) return null;

    if (!isFleetRelayWrite(method, path.slice(base.length))) return null;

    return paused.state === 'unreachable' ? 'cluster-unreachable' : 'cluster-read-only';
  }
}

/**
 * Fleet mode backstop (3.43, 2026-10-31): changes to the active cluster's relay are answered right here with a clear
 * 503 while the cluster is unreachable / read-only (views that still offer a button explain it in their error alert);
 * the fleet's relay refuses them as well. Reads, other clusters and single-cluster mode are left alone.
 */
export const fleetWriteGuardInterceptor: HttpInterceptorFn = (req, next) => {
  const refusal = inject(FleetClusterAvailabilityService).writeRefusal(req.method, req.url);

  if (!refusal) return next(req);

  return throwError(
    () =>
      new HttpErrorResponse({
        error: { statusCode: 503, message: fleetRelayRefusalMessage(refusal, ''), fleetRelay: refusal },
        status: 503,
        statusText: 'Service Unavailable',
        url: req.url,
      }),
  );
};
