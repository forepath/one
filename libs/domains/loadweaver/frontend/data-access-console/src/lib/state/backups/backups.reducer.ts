import { createReducer, on } from '@ngrx/store';

import type {
  Backup,
  BackupDeletion,
  BackupDeletionAction,
  BackupDiff,
  BackupFileEntry,
  BackupRestore,
  BackupsStatus,
  RestoreTest,
} from '../../types/backups.types';
import {
  backupDeletionAction,
  backupDeletionActionFailure,
  backupDeletionActionSuccess,
  backupNow,
  backupNowFailure,
  backupNowSuccess,
  clearBackupActionError,
  clearBackupDeletionActionError,
  clearBackupDeletionRequest,
  clearRestorePlanError,
  loadBackup,
  loadBackupDiff,
  loadBackupDiffFailure,
  loadBackupDiffSuccess,
  loadBackupFailure,
  loadBackupFiles,
  loadBackupFilesFailure,
  loadBackupFilesSuccess,
  loadBackups,
  loadBackupsFailure,
  loadBackupsSuccess,
  loadBackupSuccess,
  loadDeletions,
  loadDeletionsFailure,
  loadDeletionsSuccess,
  loadRestores,
  loadRestoresFailure,
  loadRestoresSuccess,
  planRestore,
  planRestoreFailure,
  planRestoreSuccess,
  requestBackupDeletion,
  requestBackupDeletionFailure,
  requestBackupDeletionSuccess,
  startRestoreTest,
  startRestoreTestFailure,
  startRestoreTestSuccess,
} from './backups.actions';

export interface ConsoleBackupsState {
  /** The catalog's project filter (null = everything the caller may read). */
  project: string | null;
  status: BackupsStatus | null;
  backups: Backup[];
  /** `null` until loaded (or when they couldn't be read). */
  deletions: BackupDeletion[] | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Backup | null;
  /** The other backups of the selected backup's volume (newest first). */
  volumeBackups: Backup[];
  selectedLoading: boolean;
  selectedError: string | null;
  files: { id: string; path: string; entries: BackupFileEntry[]; loading: boolean; error: string | null } | null;
  diff: {
    from: string;
    to: string;
    result: { from: Backup; to: Backup; diff: BackupDiff } | null;
    loading: boolean;
    error: string | null;
  } | null;
  restores: BackupRestore[];
  restoreTests: RestoreTest[];
  restoresLoaded: boolean;
  restoresLoading: boolean;
  restoresError: string | null;
  deletionsLoading: boolean;
  deletionsError: string | null;
  /** Volumes whose "back up now" is in flight, backups whose restore test is being started. */
  backingUp: string[];
  testing: string[];
  actionError: string | null;
  requestingDeletion: boolean;
  deletionRequestError: string | null;
  /** The request just created (the dialog shows when it takes effect). */
  requestedDeletion: BackupDeletion | null;
  deletionActing: { id: string; action: BackupDeletionAction } | null;
  deletionActionError: string | null;
  planningRestore: boolean;
  restorePlanError: string | null;
}

export const initialConsoleBackupsState: ConsoleBackupsState = {
  project: null,
  status: null,
  backups: [],
  deletions: null,
  loaded: false,
  loading: false,
  error: null,
  selectedId: null,
  selected: null,
  volumeBackups: [],
  selectedLoading: false,
  selectedError: null,
  files: null,
  diff: null,
  restores: [],
  restoreTests: [],
  restoresLoaded: false,
  restoresLoading: false,
  restoresError: null,
  deletionsLoading: false,
  deletionsError: null,
  backingUp: [],
  testing: [],
  actionError: null,
  requestingDeletion: false,
  deletionRequestError: null,
  requestedDeletion: null,
  deletionActing: null,
  deletionActionError: null,
  planningRestore: false,
  restorePlanError: null,
};

function withDeletion(deletions: BackupDeletion[] | null, deletion: BackupDeletion): BackupDeletion[] {
  const list = deletions ?? [];

  return list.some((d) => d.id === deletion.id)
    ? list.map((d) => (d.id === deletion.id ? deletion : d))
    : [deletion, ...list];
}

function withBackup(backups: Backup[], backup: Backup): Backup[] {
  return backups.some((b) => b.id === backup.id)
    ? backups.map((b) => (b.id === backup.id ? backup : b))
    : [backup, ...backups];
}

export const consoleBackupsReducer = createReducer(
  initialConsoleBackupsState,
  on(loadBackups, (state, { project, silent }) => ({
    ...state,
    project,
    // Another project's catalog isn't shown while the new one loads.
    backups: project === state.project ? state.backups : [],
    loading: !silent,
    error: silent ? state.error : null,
  })),
  on(loadBackupsSuccess, (state, { status, backups, deletions }) => ({
    ...state,
    status,
    backups,
    deletions: deletions ?? state.deletions,
    loaded: true,
    loading: false,
    error: null,
  })),
  on(loadBackupsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadBackup, (state, { id, silent }) => ({
    ...state,
    selectedId: id,
    selected: state.selected?.id === id ? state.selected : (state.backups.find((b) => b.id === id) ?? null),
    volumeBackups: state.selectedId === id ? state.volumeBackups : [],
    selectedLoading: !silent,
    selectedError: null,
  })),
  on(loadBackupSuccess, (state, { backup, volumeBackups }) =>
    state.selectedId === backup.id
      ? {
          ...state,
          selected: backup,
          volumeBackups,
          selectedLoading: false,
          backups: state.backups.map((b) => (b.id === backup.id ? backup : b)),
        }
      : state,
  ),
  on(loadBackupFailure, (state, { id, error }) =>
    state.selectedId === id ? { ...state, selectedLoading: false, selectedError: error } : state,
  ),
  on(loadBackupFiles, (state, { id, path }) => ({
    ...state,
    files: {
      id,
      path,
      // The previous listing stays while the same directory reloads.
      entries: state.files?.id === id && state.files.path === path ? state.files.entries : [],
      loading: true,
      error: null,
    },
  })),
  on(loadBackupFilesSuccess, (state, { id, path, entries }) =>
    state.files?.id === id && state.files.path === path
      ? { ...state, files: { id, path, entries, loading: false, error: null } }
      : state,
  ),
  on(loadBackupFilesFailure, (state, { id, path, error }) =>
    state.files?.id === id && state.files.path === path
      ? { ...state, files: { ...state.files, loading: false, error } }
      : state,
  ),
  on(loadBackupDiff, (state, { from, to }) => ({
    ...state,
    diff: { from, to, result: null, loading: true, error: null },
  })),
  on(loadBackupDiffSuccess, (state, { from, to, diff }) =>
    state.diff?.from === from.id && state.diff.to === to.id
      ? { ...state, diff: { ...state.diff, result: { from, to, diff }, loading: false } }
      : state,
  ),
  on(loadBackupDiffFailure, (state, { from, to, error }) =>
    state.diff?.from === from && state.diff.to === to
      ? { ...state, diff: { ...state.diff, loading: false, error } }
      : state,
  ),
  on(loadRestores, (state, { silent }) => ({
    ...state,
    restoresLoading: !silent,
    restoresError: silent ? state.restoresError : null,
  })),
  on(loadRestoresSuccess, (state, { restores, tests }) => ({
    ...state,
    restores,
    restoreTests: tests ?? state.restoreTests,
    restoresLoaded: true,
    restoresLoading: false,
    restoresError: null,
  })),
  on(loadRestoresFailure, (state, { error }) => ({ ...state, restoresLoading: false, restoresError: error })),
  on(loadDeletions, (state, { silent }) => ({
    ...state,
    deletionsLoading: !silent,
    deletionsError: silent ? state.deletionsError : null,
  })),
  on(loadDeletionsSuccess, (state, { deletions }) => ({
    ...state,
    deletions,
    deletionsLoading: false,
    deletionsError: null,
  })),
  on(loadDeletionsFailure, (state, { error }) => ({ ...state, deletionsLoading: false, deletionsError: error })),
  on(backupNow, (state, { volume }) => ({
    ...state,
    backingUp: [...state.backingUp.filter((v) => v !== volume), volume],
    actionError: null,
  })),
  on(backupNowSuccess, (state, { backup }) => ({
    ...state,
    backingUp: state.backingUp.filter((v) => v !== backup.resource),
    backups: withBackup(state.backups, backup),
  })),
  on(backupNowFailure, (state, { volume, error }) => ({
    ...state,
    backingUp: state.backingUp.filter((v) => v !== volume),
    actionError: error,
  })),
  on(startRestoreTest, (state, { id }) => ({
    ...state,
    testing: [...state.testing.filter((t) => t !== id), id],
    actionError: null,
  })),
  on(startRestoreTestSuccess, (state, { test }) => {
    const mark = (b: Backup): Backup =>
      b.id === test.backupId
        ? { ...b, restoreTest: { id: test.id, status: test.status, finishedAt: test.finishedAt } }
        : b;

    return {
      ...state,
      testing: state.testing.filter((t) => t !== test.backupId),
      backups: state.backups.map(mark),
      volumeBackups: state.volumeBackups.map(mark),
      selected: state.selected ? mark(state.selected) : null,
      restoreTests: [test, ...state.restoreTests.filter((t) => t.id !== test.id)],
    };
  }),
  on(startRestoreTestFailure, (state, { id, error }) => ({
    ...state,
    testing: state.testing.filter((t) => t !== id),
    actionError: error,
  })),
  on(clearBackupActionError, (state) => ({ ...state, actionError: null })),
  on(requestBackupDeletion, (state) => ({
    ...state,
    requestingDeletion: true,
    deletionRequestError: null,
    requestedDeletion: null,
  })),
  on(requestBackupDeletionSuccess, (state, { deletion }) => ({
    ...state,
    requestingDeletion: false,
    requestedDeletion: deletion,
    deletions: withDeletion(state.deletions, deletion),
  })),
  on(requestBackupDeletionFailure, (state, { error }) => ({
    ...state,
    requestingDeletion: false,
    deletionRequestError: error,
  })),
  on(clearBackupDeletionRequest, (state) => ({ ...state, deletionRequestError: null, requestedDeletion: null })),
  on(backupDeletionAction, (state, { id, action }) => ({
    ...state,
    deletionActing: { id, action },
    deletionActionError: null,
  })),
  on(backupDeletionActionSuccess, (state, { deletion }) => ({
    ...state,
    deletionActing: null,
    deletions: withDeletion(state.deletions, deletion),
  })),
  on(backupDeletionActionFailure, (state, { error }) => ({
    ...state,
    deletionActing: null,
    deletionActionError: error,
  })),
  on(clearBackupDeletionActionError, (state) => ({ ...state, deletionActionError: null })),
  on(planRestore, (state) => ({ ...state, planningRestore: true, restorePlanError: null })),
  on(planRestoreSuccess, (state) => ({ ...state, planningRestore: false })),
  on(planRestoreFailure, (state, { error }) => ({ ...state, planningRestore: false, restorePlanError: error })),
  on(clearRestorePlanError, (state) => ({ ...state, restorePlanError: null })),
);
