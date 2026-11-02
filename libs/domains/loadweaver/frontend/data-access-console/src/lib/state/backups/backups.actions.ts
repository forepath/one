import { createAction, props } from '@ngrx/store';

import type {
  Backup,
  BackupDeletion,
  BackupDeletionAction,
  BackupDiff,
  BackupFileEntry,
  BackupRestore,
  BackupsStatus,
  RestoreRequest,
  RestoreTest,
} from '../../types/backups.types';
import type { Plan } from '../../types/plans.types';

/** Status, catalog (optionally of one project) and deletion requests; deletions may fail alone. */
export const loadBackups = createAction('[ConsoleBackups] Load', props<{ project: string | null; silent?: boolean }>());
export const loadBackupsSuccess = createAction(
  '[ConsoleBackups] Load Success',
  props<{ status: BackupsStatus; backups: Backup[]; deletions: BackupDeletion[] | null }>(),
);
export const loadBackupsFailure = createAction('[ConsoleBackups] Load Failure', props<{ error: string }>());

/** One backup and the other backups of its volume (for diff / restore). */
export const loadBackup = createAction('[ConsoleBackups] Load Backup', props<{ id: string; silent?: boolean }>());
export const loadBackupSuccess = createAction(
  '[ConsoleBackups] Load Backup Success',
  props<{ backup: Backup; volumeBackups: Backup[] }>(),
);
export const loadBackupFailure = createAction(
  '[ConsoleBackups] Load Backup Failure',
  props<{ id: string; error: string }>(),
);

export const loadBackupFiles = createAction('[ConsoleBackups] Load Files', props<{ id: string; path: string }>());
export const loadBackupFilesSuccess = createAction(
  '[ConsoleBackups] Load Files Success',
  props<{ id: string; path: string; entries: BackupFileEntry[] }>(),
);
export const loadBackupFilesFailure = createAction(
  '[ConsoleBackups] Load Files Failure',
  props<{ id: string; path: string; error: string }>(),
);

/** The diff and both backups (for the header). */
export const loadBackupDiff = createAction('[ConsoleBackups] Load Diff', props<{ from: string; to: string }>());
export const loadBackupDiffSuccess = createAction(
  '[ConsoleBackups] Load Diff Success',
  props<{ from: Backup; to: Backup; diff: BackupDiff }>(),
);
export const loadBackupDiffFailure = createAction(
  '[ConsoleBackups] Load Diff Failure',
  props<{ from: string; to: string; error: string }>(),
);

/** Restores and restore tests (optionally of one project); restore tests may fail alone. */
export const loadRestores = createAction(
  '[ConsoleBackups] Load Restores',
  props<{ project: string | null; silent?: boolean }>(),
);
export const loadRestoresSuccess = createAction(
  '[ConsoleBackups] Load Restores Success',
  props<{ restores: BackupRestore[]; tests: RestoreTest[] | null }>(),
);
export const loadRestoresFailure = createAction('[ConsoleBackups] Load Restores Failure', props<{ error: string }>());

export const loadDeletions = createAction('[ConsoleBackups] Load Deletions', props<{ silent?: boolean }>());
export const loadDeletionsSuccess = createAction(
  '[ConsoleBackups] Load Deletions Success',
  props<{ deletions: BackupDeletion[] }>(),
);
export const loadDeletionsFailure = createAction('[ConsoleBackups] Load Deletions Failure', props<{ error: string }>());

export const backupNow = createAction('[ConsoleBackups] Backup Now', props<{ volume: string }>());
export const backupNowSuccess = createAction('[ConsoleBackups] Backup Now Success', props<{ backup: Backup }>());
export const backupNowFailure = createAction(
  '[ConsoleBackups] Backup Now Failure',
  props<{ volume: string; error: string }>(),
);

export const startRestoreTest = createAction('[ConsoleBackups] Start Restore Test', props<{ id: string }>());
export const startRestoreTestSuccess = createAction(
  '[ConsoleBackups] Start Restore Test Success',
  props<{ test: RestoreTest }>(),
);
export const startRestoreTestFailure = createAction(
  '[ConsoleBackups] Start Restore Test Failure',
  props<{ id: string; error: string }>(),
);
export const clearBackupActionError = createAction('[ConsoleBackups] Clear Action Error');

export const requestBackupDeletion = createAction(
  '[ConsoleBackups] Request Deletion',
  props<{ backupIds: string[]; reason: string }>(),
);
export const requestBackupDeletionSuccess = createAction(
  '[ConsoleBackups] Request Deletion Success',
  props<{ deletion: BackupDeletion }>(),
);
export const requestBackupDeletionFailure = createAction(
  '[ConsoleBackups] Request Deletion Failure',
  props<{ error: string }>(),
);
export const clearBackupDeletionRequest = createAction('[ConsoleBackups] Clear Deletion Request');

export const backupDeletionAction = createAction(
  '[ConsoleBackups] Deletion Action',
  props<{ id: string; action: BackupDeletionAction }>(),
);
export const backupDeletionActionSuccess = createAction(
  '[ConsoleBackups] Deletion Action Success',
  props<{ action: BackupDeletionAction; deletion: BackupDeletion }>(),
);
export const backupDeletionActionFailure = createAction(
  '[ConsoleBackups] Deletion Action Failure',
  props<{ id: string; action: BackupDeletionAction; error: string }>(),
);
export const clearBackupDeletionActionError = createAction('[ConsoleBackups] Clear Deletion Action Error');

/** The restore wizard: plans a `Restore` resource; the plan is reviewed (approved / applied) on its page. */
export const planRestore = createAction('[ConsoleBackups] Plan Restore', props<{ request: RestoreRequest }>());
export const planRestoreSuccess = createAction('[ConsoleBackups] Plan Restore Success', props<{ plan: Plan }>());
export const planRestoreFailure = createAction('[ConsoleBackups] Plan Restore Failure', props<{ error: string }>());
export const clearRestorePlanError = createAction('[ConsoleBackups] Clear Restore Plan Error');
