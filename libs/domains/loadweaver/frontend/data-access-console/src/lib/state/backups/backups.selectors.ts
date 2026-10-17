import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { Backup, BackupDeletion } from '../../types/backups.types';
import { parseVolumeId } from '../../utils/backup-restore';
import type { ConsoleBackupsState } from './backups.reducer';

export const selectConsoleBackupsState = createFeatureSelector<ConsoleBackupsState>('consoleBackups');

export const selectBackupsProject = createSelector(selectConsoleBackupsState, (state) => state.project);
export const selectBackupsStatus = createSelector(selectConsoleBackupsState, (state) => state.status);
export const selectBackups = createSelector(selectConsoleBackupsState, (state) => state.backups);
export const selectBackupDeletions = createSelector(selectConsoleBackupsState, (state) => state.deletions);
export const selectBackupsLoaded = createSelector(selectConsoleBackupsState, (state) => state.loaded);
export const selectBackupsLoading = createSelector(selectConsoleBackupsState, (state) => state.loading);
export const selectBackupsError = createSelector(selectConsoleBackupsState, (state) => state.error);
export const selectSelectedBackup = createSelector(selectConsoleBackupsState, (state) => state.selected);
export const selectSelectedVolumeBackups = createSelector(selectConsoleBackupsState, (state) => state.volumeBackups);
export const selectSelectedBackupLoading = createSelector(selectConsoleBackupsState, (state) => state.selectedLoading);
export const selectSelectedBackupError = createSelector(selectConsoleBackupsState, (state) => state.selectedError);
export const selectBackupFiles = createSelector(selectConsoleBackupsState, (state) => state.files);
export const selectBackupDiff = createSelector(selectConsoleBackupsState, (state) => state.diff);
export const selectBackupRestores = createSelector(selectConsoleBackupsState, (state) => state.restores);
export const selectRestoreTests = createSelector(selectConsoleBackupsState, (state) => state.restoreTests);
export const selectRestoresLoaded = createSelector(selectConsoleBackupsState, (state) => state.restoresLoaded);
export const selectRestoresLoading = createSelector(selectConsoleBackupsState, (state) => state.restoresLoading);
export const selectRestoresError = createSelector(selectConsoleBackupsState, (state) => state.restoresError);
export const selectDeletionsLoading = createSelector(selectConsoleBackupsState, (state) => state.deletionsLoading);
export const selectDeletionsError = createSelector(selectConsoleBackupsState, (state) => state.deletionsError);
export const selectBackingUp = createSelector(selectConsoleBackupsState, (state) => state.backingUp);
export const selectTestingBackups = createSelector(selectConsoleBackupsState, (state) => state.testing);
export const selectBackupActionError = createSelector(selectConsoleBackupsState, (state) => state.actionError);
export const selectRequestingDeletion = createSelector(selectConsoleBackupsState, (state) => state.requestingDeletion);
export const selectDeletionRequestError = createSelector(
  selectConsoleBackupsState,
  (state) => state.deletionRequestError,
);
export const selectRequestedDeletion = createSelector(selectConsoleBackupsState, (state) => state.requestedDeletion);
export const selectDeletionActing = createSelector(selectConsoleBackupsState, (state) => state.deletionActing);
export const selectDeletionActionError = createSelector(
  selectConsoleBackupsState,
  (state) => state.deletionActionError,
);
export const selectPlanningRestore = createSelector(selectConsoleBackupsState, (state) => state.planningRestore);
export const selectRestorePlanError = createSelector(selectConsoleBackupsState, (state) => state.restorePlanError);

export function isOpenDeletion(deletion: Pick<BackupDeletion, 'state'>): boolean {
  return deletion.state === 'pending' || deletion.state === 'approved';
}

/** Requests that haven't taken effect yet (pending approval or waiting for the delay). */
export const selectOpenDeletions = createSelector(selectBackupDeletions, (deletions) =>
  (deletions ?? []).filter(isOpenDeletion),
);

/** Backups of one volume, with what the catalog shows per volume. */
export interface BackupVolume {
  /** `<project>/<deployment>/<volume>`. */
  resource: string;
  project: string | null;
  deployment: string;
  volume: string;
  /** Newest first. */
  backups: Backup[];
  latest: Backup | null;
  /** The newest successful backup (what a restore usually starts from). */
  lastSucceeded: Backup | null;
  running: boolean;
  /** Repository bytes the volume's live backups added (after deduplication). */
  storedBytes: number;
}

/** Groups backups by volume (sorted by volume id), each newest first. */
export function backupVolumes(backups: Backup[]): BackupVolume[] {
  const groups = new Map<string, Backup[]>();

  for (const backup of backups) groups.set(backup.resource, [...(groups.get(backup.resource) ?? []), backup]);

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, list]) => {
      const sorted = [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const parsed = parseVolumeId(resource);

      return {
        resource,
        project: sorted[0]?.project ?? parsed?.project ?? null,
        deployment: parsed?.deployment ?? '',
        volume: parsed?.volume ?? resource,
        backups: sorted,
        latest: sorted[0] ?? null,
        lastSucceeded: sorted.find((b) => b.status === 'succeeded' && !b.deletedAt) ?? null,
        running: sorted.some((b) => b.status === 'running'),
        storedBytes: sorted.filter((b) => !b.deletedAt).reduce((sum, b) => sum + b.uploadedBytes, 0),
      };
    });
}

export const selectBackupVolumes = createSelector(selectBackups, backupVolumes);

/** A point of a volume's timeline: oldest left, the bar's height relative to the largest backup. */
export interface BackupTimelinePoint {
  backup: Backup;
  /** 0–100. */
  height: number;
}

export function backupTimeline(backups: Backup[]): BackupTimelinePoint[] {
  const max = Math.max(0, ...backups.map((b) => b.bytes));

  return [...backups]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((backup) => ({
      backup,
      height: max > 0 ? Math.max(8, Math.round((backup.bytes / max) * 100)) : 8,
    }));
}

/** Something changes on its own: a backup or restore test runs, or "back up now" is in flight (the console polls). */
export const selectBackupsBusy = createSelector(
  selectBackups,
  selectBackingUp,
  selectTestingBackups,
  (backups, backingUp, testing) =>
    backingUp.length > 0 ||
    testing.length > 0 ||
    backups.some((b) => b.status === 'running' || b.restoreTest?.status === 'running'),
);

export const selectRestoresBusy = createSelector(
  selectBackupRestores,
  selectRestoreTests,
  (restores, tests) =>
    restores.some((r) => r.status === 'pending' || r.status === 'running') || tests.some((t) => t.status === 'running'),
);
