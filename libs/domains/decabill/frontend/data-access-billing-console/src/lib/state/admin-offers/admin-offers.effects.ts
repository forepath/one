import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';
import { AdminOffersService } from '../../services/admin-offers.service';

import {
  archiveAdminOffer,
  archiveAdminOfferFailure,
  archiveAdminOfferSuccess,
  createAdminOffer,
  createAdminOfferFailure,
  createAdminOfferSuccess,
  deleteAdminOffer,
  deleteAdminOfferFailure,
  deleteAdminOfferSuccess,
  loadAdminOfferAuditLogs,
  loadAdminOfferAuditLogsFailure,
  loadAdminOfferAuditLogsSuccess,
  loadAdminOfferStatistics,
  loadAdminOfferStatisticsFailure,
  loadAdminOfferStatisticsSuccess,
  loadAdminOffers,
  loadAdminOffersFailure,
  loadAdminOffersSuccess,
  revokeAdminOffer,
  revokeAdminOfferFailure,
  revokeAdminOfferSuccess,
  updateAdminOffer,
  updateAdminOfferFailure,
  updateAdminOfferSuccess,
} from './admin-offers.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadAdminOffers$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(loadAdminOffers),
      switchMap(({ search, userId, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.list({ limit, offset, search, userId }).pipe(
          map((response) => loadAdminOffersSuccess({ offers: response.items, total: response.total })),
          catchError((error) => of(loadAdminOffersFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadAdminOfferStatistics$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(loadAdminOfferStatistics),
      switchMap(({ params }) =>
        service.getStatistics(params).pipe(
          map((statistics) => loadAdminOfferStatisticsSuccess({ statistics })),
          catchError((error) => of(loadAdminOfferStatisticsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createAdminOffer$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(createAdminOffer),
      switchMap(({ dto }) =>
        service.create(dto).pipe(
          map((offer) => createAdminOfferSuccess({ offer })),
          catchError((error) => of(createAdminOfferFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateAdminOffer$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(updateAdminOffer),
      switchMap(({ id, dto }) =>
        service.update(id, dto).pipe(
          map((offer) => updateAdminOfferSuccess({ offer })),
          catchError((error) => of(updateAdminOfferFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteAdminOffer$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(deleteAdminOffer),
      switchMap(({ id }) =>
        service.delete(id).pipe(
          map(() => deleteAdminOfferSuccess({ id })),
          catchError((error) => of(deleteAdminOfferFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const archiveAdminOffer$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(archiveAdminOffer),
      switchMap(({ id }) =>
        service.archive(id).pipe(
          map((offer) => archiveAdminOfferSuccess({ offer })),
          catchError((error) => of(archiveAdminOfferFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const revokeAdminOffer$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(revokeAdminOffer),
      switchMap(({ id }) =>
        service.revoke(id).pipe(
          map((offer) => revokeAdminOfferSuccess({ offer })),
          catchError((error) => of(revokeAdminOfferFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const reloadAdminOfferStatisticsAfterMutation$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(
        createAdminOfferSuccess,
        updateAdminOfferSuccess,
        deleteAdminOfferSuccess,
        archiveAdminOfferSuccess,
        revokeAdminOfferSuccess,
      ),
      map(() => loadAdminOfferStatistics({ params: {} })),
    ),
  { functional: true },
);

export const loadAdminOfferAuditLogs$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminOffersService)) =>
    actions$.pipe(
      ofType(loadAdminOfferAuditLogs),
      switchMap(({ offerId, limit, offset }) =>
        service.listAuditLogs(offerId, { limit: limit ?? BILLING_LIST_PAGE_SIZE, offset: offset ?? 0 }).pipe(
          map((response) =>
            loadAdminOfferAuditLogsSuccess({
              offerId,
              items: response.items,
              total: response.total,
              offset: offset ?? 0,
            }),
          ),
          catchError((error) => of(loadAdminOfferAuditLogsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
