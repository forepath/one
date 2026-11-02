import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap } from 'rxjs';

import { RemoteAccessService } from '../../services/remote-access.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadDevices,
  loadDevicesFailure,
  loadDevicesSuccess,
  revokeDevice,
  revokeDeviceFailure,
  revokeDeviceSuccess,
} from './remote-access.actions';

export const loadDevices$ = createEffect(
  (actions$ = inject(Actions), service = inject(RemoteAccessService)) =>
    actions$.pipe(
      ofType(loadDevices),
      switchMap(({ all }) =>
        service.devices(all).pipe(
          map((devices) => loadDevicesSuccess({ all, devices })),
          catchError((error: unknown) =>
            of(loadDevicesFailure({ error: apiErrorMessage(error, 'Failed to load devices') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const revokeDevice$ = createEffect(
  (actions$ = inject(Actions), service = inject(RemoteAccessService)) =>
    actions$.pipe(
      ofType(revokeDevice),
      mergeMap(({ id }) =>
        service.revoke(id).pipe(
          map(() => revokeDeviceSuccess({ id, revokedAt: new Date().toISOString() })),
          catchError((error: unknown) =>
            of(revokeDeviceFailure({ id, error: apiErrorMessage(error, 'Failed to revoke the device') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
