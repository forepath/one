import { createReducer, on } from '@ngrx/store';

import type { BackupKeyAction, BackupKeyGeneration, KitShare } from '../../types/backups.types';
import {
  backupKeyActionFailure,
  backupKeyActionSuccess,
  clearBackupKeyActionError,
  clearKitShare,
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

export interface ConsoleBackupKeysState {
  /** Newest generation first. */
  generations: BackupKeyGeneration[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  acting: { action: BackupKeyAction; generation: number | null; index?: number } | null;
  actionError: string | null;
  /** The action that just succeeded (dialogs close on it). */
  lastSuccess: { action: BackupKeyAction; generation: number | null } | null;
  /** The share just handed out: shown once, then forgotten. */
  share: { generation: number; index: number; share: KitShare } | null;
}

export const initialConsoleBackupKeysState: ConsoleBackupKeysState = {
  generations: [],
  loaded: false,
  loading: false,
  error: null,
  acting: null,
  actionError: null,
  lastSuccess: null,
  share: null,
};

function sorted(generations: BackupKeyGeneration[]): BackupKeyGeneration[] {
  return [...generations].sort((a, b) => b.generation - a.generation);
}

function withGeneration(generations: BackupKeyGeneration[], updated: BackupKeyGeneration): BackupKeyGeneration[] {
  const others = generations.filter((g) => g.generation !== updated.generation);

  // A rotation retires the previously active generation (the reload brings its `retiredAt`).
  return sorted([...(updated.active ? others.map((g) => ({ ...g, active: false })) : others), updated]);
}

const starting =
  (action: BackupKeyAction, generation: number | null, index?: number) =>
  (state: ConsoleBackupKeysState): ConsoleBackupKeysState => ({
    ...state,
    acting: { action, generation, ...(index !== undefined ? { index } : {}) },
    actionError: null,
    lastSuccess: null,
  });

export const consoleBackupKeysReducer = createReducer(
  initialConsoleBackupKeysState,
  on(loadBackupKeys, (state, { silent }) => ({ ...state, loading: !silent, error: silent ? state.error : null })),
  on(loadBackupKeysSuccess, (state, { generations }) => ({
    ...state,
    generations: sorted(generations),
    loaded: true,
    loading: false,
    error: null,
  })),
  on(loadBackupKeysFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(rotateBackupKey, (state) => starting('rotate', null)(state)),
  on(reissueBackupKit, (state, { generation }) => starting('reissue', generation)(state)),
  on(downloadKitShare, (state, { generation, index }) => starting('share', generation, index)(state)),
  on(confirmBackupKit, (state, { generation }) => starting('confirm', generation)(state)),
  on(escrowBackupKey, (state, { generation }) => starting('escrow', generation)(state)),
  on(kitShareReceived, (state, { generation, index, share }) => ({
    ...state,
    share: { generation, index, share },
    // The share counts as handed out right away; the reload brings who and when.
    generations: state.generations.map((g) =>
      g.generation === generation
        ? {
            ...g,
            kit: {
              ...g.kit,
              downloaded: [
                ...g.kit.downloaded.filter((d) => d.index !== index),
                { index, downloadedAt: new Date().toISOString(), downloadedBy: null },
              ].sort((a, b) => a.index - b.index),
            },
          }
        : g,
    ),
  })),
  on(clearKitShare, (state) => ({ ...state, share: null })),
  on(backupKeyActionSuccess, (state, { action, generation, updated }) => ({
    ...state,
    acting: null,
    lastSuccess: { action, generation: updated?.generation ?? generation },
    generations: updated ? withGeneration(state.generations, updated) : state.generations,
  })),
  on(backupKeyActionFailure, (state, { error }) => ({ ...state, acting: null, actionError: error })),
  on(clearBackupKeyActionError, (state) => ({ ...state, actionError: null, lastSuccess: null })),
);
