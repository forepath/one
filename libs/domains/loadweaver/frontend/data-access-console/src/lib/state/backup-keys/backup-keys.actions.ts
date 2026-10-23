import { createAction, props } from '@ngrx/store';

import type { BackupKeyAction, BackupKeyGeneration, KitShare, KitSize } from '../../types/backups.types';

export const loadBackupKeys = createAction('[ConsoleBackupKeys] Load', props<{ silent?: boolean }>());
export const loadBackupKeysSuccess = createAction(
  '[ConsoleBackupKeys] Load Success',
  props<{ generations: BackupKeyGeneration[] }>(),
);
export const loadBackupKeysFailure = createAction('[ConsoleBackupKeys] Load Failure', props<{ error: string }>());

/** A new key generation with a new kit (without a size the cluster's default). */
export const rotateBackupKey = createAction('[ConsoleBackupKeys] Rotate', props<{ kit?: KitSize }>());
/** A new kit for a generation. */
export const reissueBackupKit = createAction(
  '[ConsoleBackupKeys] Reissue Kit',
  props<{ generation: number; kit: KitSize }>(),
);
/** Hands out one share (exactly once). */
export const downloadKitShare = createAction(
  '[ConsoleBackupKeys] Download Share',
  props<{ generation: number; index: number }>(),
);
export const confirmBackupKit = createAction(
  '[ConsoleBackupKeys] Confirm Kit',
  props<{ generation: number; shares: string[] }>(),
);
export const escrowBackupKey = createAction('[ConsoleBackupKeys] Escrow', props<{ generation: number }>());

export const backupKeyActionSuccess = createAction(
  '[ConsoleBackupKeys] Action Success',
  props<{ action: BackupKeyAction; generation: number | null; updated: BackupKeyGeneration | null }>(),
);
export const backupKeyActionFailure = createAction(
  '[ConsoleBackupKeys] Action Failure',
  props<{ action: BackupKeyAction; generation: number | null; error: string }>(),
);
export const clearBackupKeyActionError = createAction('[ConsoleBackupKeys] Clear Action Error');

export const kitShareReceived = createAction(
  '[ConsoleBackupKeys] Share Received',
  props<{ generation: number; index: number; share: KitShare }>(),
);
/** Forgets the share text once the dialog is closed (it can't be shown again). */
export const clearKitShare = createAction('[ConsoleBackupKeys] Clear Share');
