import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of, switchMap, type Observable } from 'rxjs';

import { BackupsService } from '../../services/backups.service';
import type { BackupKeyAction } from '../../types/backups.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  backupKeyActionFailure,
  backupKeyActionSuccess,
  confirmBackupKit,
  downloadKitShare,
  escrowBackupKey,
  kitShareReceived,
  loadBackupKeys,
  loadBackupKeysFailure,
  loadBackupKeysSuccess,
  reissueBackupKit,
  rotateBackupKey,
} from './backup-keys.actions';

export const loadBackupKeys$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(loadBackupKeys),
      switchMap(() =>
        service.keys().pipe(
          map((generations) => loadBackupKeysSuccess({ generations })),
          catchError((error: unknown) =>
            of(loadBackupKeysFailure({ error: apiErrorMessage(error, 'Failed to load the backup keys') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

const FAILURE: Record<BackupKeyAction, string> = {
  rotate: 'Failed to rotate the backup key',
  reissue: 'Failed to re-issue the recovery kit',
  share: 'Failed to hand out the share',
  confirm: 'Failed to confirm the recovery kit',
  escrow: 'Failed to escrow the key in the KMS',
};

/** Runs one key action and maps its answer; the API's messages (wrong / too few shares, no KMS) are shown as they are. */
function run<T>(
  action: BackupKeyAction,
  generation: number | null,
  request: Observable<T>,
  done: (result: T) => ReturnType<typeof backupKeyActionSuccess | typeof kitShareReceived>[],
) {
  return request.pipe(
    switchMap((result) => of(...done(result))),
    catchError((error: unknown) =>
      of(backupKeyActionFailure({ action, generation, error: apiErrorMessage(error, FAILURE[action]) })),
    ),
  );
}

export const backupKeyActions$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(rotateBackupKey, reissueBackupKit, downloadKitShare, confirmBackupKit, escrowBackupKey),
      exhaustMap((action) => {
        switch (action.type) {
          case rotateBackupKey.type:
            return run('rotate', null, service.rotateKey(action.kit), (updated) => [
              backupKeyActionSuccess({ action: 'rotate', generation: updated.generation, updated }),
            ]);
          case reissueBackupKit.type:
            return run('reissue', action.generation, service.reissueKit(action.generation, action.kit), (updated) => [
              backupKeyActionSuccess({ action: 'reissue', generation: action.generation, updated }),
            ]);
          case downloadKitShare.type:
            return run('share', action.generation, service.downloadShare(action.generation, action.index), (share) => [
              kitShareReceived({ generation: action.generation, index: action.index, share }),
              backupKeyActionSuccess({ action: 'share', generation: action.generation, updated: null }),
            ]);
          case confirmBackupKit.type:
            return run('confirm', action.generation, service.confirmKit(action.generation, action.shares), () => [
              backupKeyActionSuccess({ action: 'confirm', generation: action.generation, updated: null }),
            ]);
          default:
            return run('escrow', action.generation, service.escrow(action.generation), (updated) => [
              backupKeyActionSuccess({ action: 'escrow', generation: action.generation, updated }),
            ]);
        }
      }),
    ),
  { functional: true },
);

/** Generations change with every action (retired generations, who downloaded / confirmed). */
export const reloadBackupKeysAfterAction$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(backupKeyActionSuccess),
      map(() => loadBackupKeys({ silent: true })),
    ),
  { functional: true },
);
