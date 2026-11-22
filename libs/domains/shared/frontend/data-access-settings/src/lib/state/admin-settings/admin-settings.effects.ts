import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { SettingsService } from '../../services/settings.service';

import {
  loadAdminSettings,
  loadAdminSettingsFailure,
  loadAdminSettingsSuccess,
  resetAdminSetting,
  resetAdminSettingFailure,
  resetAdminSettingSuccess,
  saveAdminSetting,
  saveAdminSettingFailure,
  saveAdminSettingSuccess,
} from './admin-settings.actions';
import { selectAdminSettingsTarget } from './admin-settings.selectors';

export function normalizeAdminSettingsError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;

    if (Array.isArray(message)) {
      return message.join(', ');
    }

    return message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'An unexpected error occurred';
}

export const loadAdminSettings$ = createEffect(
  (actions$ = inject(Actions), svc = inject(SettingsService)) => {
    return actions$.pipe(
      ofType(loadAdminSettings),
      switchMap(({ target }) =>
        svc.getOverview(target).pipe(
          map((overview) => loadAdminSettingsSuccess({ overview })),
          catchError((error) => of(loadAdminSettingsFailure({ error: normalizeAdminSettingsError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const saveAdminSetting$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), svc = inject(SettingsService)) => {
    return actions$.pipe(
      ofType(saveAdminSetting),
      withLatestFrom(store.select(selectAdminSettingsTarget)),
      mergeMap(([{ key, value }, target]) =>
        svc.upsert(key, value, target).pipe(
          map((setting) => saveAdminSettingSuccess({ setting })),
          catchError((error) => of(saveAdminSettingFailure({ key, error: normalizeAdminSettingsError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const resetAdminSetting$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), svc = inject(SettingsService)) => {
    return actions$.pipe(
      ofType(resetAdminSetting),
      withLatestFrom(store.select(selectAdminSettingsTarget)),
      mergeMap(([{ key }, target]) =>
        svc.reset(key, target).pipe(
          map((setting) => resetAdminSettingSuccess({ setting })),
          catchError((error) => of(resetAdminSettingFailure({ key, error: normalizeAdminSettingsError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
