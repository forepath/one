import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { BackupKeyGeneration } from '../../types/backups.types';
import type { ConsoleBackupKeysState } from './backup-keys.reducer';

export const selectConsoleBackupKeysState = createFeatureSelector<ConsoleBackupKeysState>('consoleBackupKeys');

export const selectBackupKeyGenerations = createSelector(selectConsoleBackupKeysState, (state) => state.generations);
export const selectBackupKeysLoaded = createSelector(selectConsoleBackupKeysState, (state) => state.loaded);
export const selectBackupKeysLoading = createSelector(selectConsoleBackupKeysState, (state) => state.loading);
export const selectBackupKeysError = createSelector(selectConsoleBackupKeysState, (state) => state.error);
export const selectBackupKeyActing = createSelector(selectConsoleBackupKeysState, (state) => state.acting);
export const selectBackupKeyActionError = createSelector(selectConsoleBackupKeysState, (state) => state.actionError);
export const selectBackupKeyLastSuccess = createSelector(selectConsoleBackupKeysState, (state) => state.lastSuccess);
export const selectKitShare = createSelector(selectConsoleBackupKeysState, (state) => state.share);

export const selectActiveBackupKey = createSelector(
  selectBackupKeyGenerations,
  (generations) => generations.find((g) => g.active) ?? null,
);

/** Backups of a generation can be recovered without the cluster: a confirmed kit or a KMS escrow. */
export function isRecoverable(generation: Pick<BackupKeyGeneration, 'kit' | 'escrow'>): boolean {
  return !!generation.kit.confirmedAt || !!generation.escrow;
}

/** Share indexes (1-based) of a generation's kit that haven't been handed out yet. */
export function pendingShares(generation: Pick<BackupKeyGeneration, 'kit'>): number[] {
  const handedOut = new Set(generation.kit.downloaded.filter((d) => !!d.downloadedAt).map((d) => d.index));

  return Array.from({ length: generation.kit.shares }, (_, i) => i + 1).filter((i) => !handedOut.has(i));
}
