import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, forkJoin, map, mergeMap, type Observable, of, switchMap } from 'rxjs';

import { DnsService } from '../../services/dns.service';
import type { DnsOverview } from '../../types/dns.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  confirmDnsFailback,
  confirmDnsFailbackFailure,
  confirmDnsFailbackSuccess,
  loadDns,
  loadDnsSuccess,
} from './dns.actions';

type Part<T> = { value: T | null; error: string | null };

function part<T>(source: Observable<T>, what: string): Observable<Part<T>> {
  return source.pipe(
    map((value) => ({ value, error: null })),
    catchError((error: unknown) => of({ value: null, error: apiErrorMessage(error, `Failed to load ${what}`) })),
  );
}

function skipped<T>(): Observable<Part<T>> {
  return of({ value: null, error: null });
}

/** Every part on its own: one failing (or forbidden) endpoint doesn't hide the others. */
export const loadDns$ = createEffect(
  (actions$ = inject(Actions), service = inject(DnsService)) =>
    actions$.pipe(
      ofType(loadDns),
      switchMap(({ infrastructure }) =>
        forkJoin({
          records: part(service.records(), 'DNS records'),
          zones: infrastructure ? part(service.zones(), 'the zone sync state') : skipped<never>(),
          dnssec: infrastructure ? part(service.dnssec(), 'DNSSEC') : skipped<never>(),
          failovers: infrastructure ? part(service.failovers(), 'DNS failovers') : skipped<never>(),
          zoneResources: infrastructure ? part(service.zoneResources(), 'DNS zones') : skipped<never>(),
          providers: infrastructure ? part(service.providers(), 'DNS providers') : skipped<never>(),
        }).pipe(
          map((parts) => {
            const overview = Object.fromEntries(
              Object.entries(parts).map(([key, p]) => [key, p.value]),
            ) as unknown as DnsOverview;
            const errors = Object.values(parts).flatMap((p) => (p.error ? [p.error] : []));

            return loadDnsSuccess({ overview, errors });
          }),
        ),
      ),
    ),
  { functional: true },
);

export const confirmDnsFailback$ = createEffect(
  (actions$ = inject(Actions), service = inject(DnsService)) =>
    actions$.pipe(
      ofType(confirmDnsFailback),
      mergeMap(({ name }) =>
        service.failback(name).pipe(
          map(() => confirmDnsFailbackSuccess({ name })),
          catchError((error: unknown) =>
            of(confirmDnsFailbackFailure({ name, error: apiErrorMessage(error, 'Failed to confirm the fail-back') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** A confirmed fail-back changes the failover's state: read everything again (cluster roles only get here). */
export const reloadDnsAfterFailback$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(confirmDnsFailbackSuccess),
      map(() => loadDns({ infrastructure: true, silent: true })),
    ),
  { functional: true },
);
