import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { isFleetConsole, type LoadweaverConsoleEnvironment } from './environment.interface';

/** Why the fleet refused a relayed request (not the cluster). */
export type FleetRelayRefusal = 'unavailable' | 'forbidden' | 'read-only' | 'credential';

/**
 * Classifies a relay error by the fleet's own refusal messages (`relay-rules.ts`): `<VERB> <path> is not relayed`
 * (404: the route is never relayed), `needs the <role> role` / `needs a cluster-wide grant` (403: the caller's
 * grant), `the cluster is in its read-only grace period` (403: Loadweaver Cloud teardown). Anything else came from
 * the cluster and is left alone.
 */
export function fleetRelayRefusal(status: number, body: unknown): FleetRelayRefusal | null {
  const message =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : typeof body === 'string'
        ? body
        : '';

  if (status === 404 && / is not relayed$/.test(message)) return 'unavailable';

  // The cluster answered 401 / 403 to the fleet's service credential (never the caller's): a connection problem.
  if (status === 502 && /^cluster (?:rejected|refused) the fleet credential/.test(message)) return 'credential';

  if (status === 403 && /read-only grace period/.test(message)) return 'read-only';

  if (status === 403 && /^needs (?:the [a-z]+ role|a cluster-wide grant)$/.test(message)) return 'forbidden';

  return null;
}

/** The message shown for a refusal (in place of the fleet's technical one). */
export function fleetRelayRefusalMessage(refusal: FleetRelayRefusal, detail: string): string {
  switch (refusal) {
    case 'unavailable':
      return $localize`:@@lwConsoleFleet-relayUnavailable:Not available through the fleet: this part of the cluster is only reachable in the cluster's own console.`;
    case 'credential':
      return `${$localize`:@@lwConsoleFleet-relayCredential:The cluster refused the fleet's service credential: the cluster connection needs a new credential (fleet admins: Clusters → edit).`} (${detail})`;
    case 'read-only':
      return $localize`:@@lwConsoleFleet-relayReadOnly:The cluster is in its read-only grace period: changes through the fleet are closed.`;
    default:
      return `${$localize`:@@lwConsoleFleet-relayForbidden:No permission through the fleet: your grant on this cluster does not allow it.`} (${detail})`;
  }
}

/**
 * Fleet mode: requests to the active cluster's relay that the **fleet** refuses get a clear message ("not available
 * through the fleet", "no permission", "read-only grace", "the cluster refused the fleet's credential" — a 502, so
 * the session interceptors never sign the user out over it) in the error body, so every view's error alert explains
 * it without knowing about the fleet. The body also carries `fleetRelay` with the reason. A no-op in single-cluster
 * mode and for every other request.
 */
export const fleetRelayErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const environment = inject<LoadweaverConsoleEnvironment | null>(ENVIRONMENT, { optional: true });

  if (!environment || !isFleetConsole(environment)) return next(req);

  const fleetApi = (environment.fleet?.apiUrl ?? '').replace(/\/+$/, '');

  if (!req.url.startsWith(`${fleetApi}/clusters/`) || !req.url.includes('/api/')) return next(req);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);

      const refusal = fleetRelayRefusal(error.status, error.error);

      if (!refusal) return throwError(() => error);

      const detail =
        typeof (error.error as { message?: unknown })?.message === 'string'
          ? (error.error as { message: string }).message
          : '';

      return throwError(
        () =>
          new HttpErrorResponse({
            error: {
              statusCode: error.status,
              message: fleetRelayRefusalMessage(refusal, detail),
              fleetRelay: refusal,
            },
            headers: error.headers,
            status: error.status,
            statusText: error.statusText,
            url: error.url ?? undefined,
          }),
      );
    }),
  );
};
