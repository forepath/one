import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { BackupDeletionAction, RestoreRequest } from '../../types/backups.types';
import {
  backupDeletionAction,
  backupNow,
  clearBackupActionError,
  clearBackupDeletionActionError,
  clearBackupDeletionRequest,
  clearRestorePlanError,
  loadBackup,
  loadBackupDiff,
  loadBackupFiles,
  loadBackups,
  loadDeletions,
  loadRestores,
  planRestore,
  requestBackupDeletion,
  startRestoreTest,
} from './backups.actions';
import {
  selectBackupActionError,
  selectBackupDeletions,
  selectBackupDiff,
  selectBackupFiles,
  selectBackingUp,
  selectBackupRestores,
  selectBackups,
  selectBackupsBusy,
  selectBackupsError,
  selectBackupsLoaded,
  selectBackupsLoading,
  selectBackupsProject,
  selectBackupsStatus,
  selectBackupVolumes,
  selectDeletionActing,
  selectDeletionActionError,
  selectDeletionRequestError,
  selectDeletionsError,
  selectDeletionsLoading,
  selectOpenDeletions,
  selectPlanningRestore,
  selectRequestedDeletion,
  selectRequestingDeletion,
  selectRestorePlanError,
  selectRestoresBusy,
  selectRestoresError,
  selectRestoresLoaded,
  selectRestoresLoading,
  selectRestoreTests,
  selectSelectedBackup,
  selectSelectedBackupError,
  selectSelectedBackupLoading,
  selectSelectedVolumeBackups,
  selectTestingBackups,
} from './backups.selectors';

/** Backups (3.20): catalog and timeline, file browser, diff, restores, restore tests and deletion requests. */
@Injectable()
export class ConsoleBackupsFacade {
  private readonly store = inject(Store);

  readonly project$ = this.store.select(selectBackupsProject);
  readonly status$ = this.store.select(selectBackupsStatus);
  readonly backups$ = this.store.select(selectBackups);
  readonly volumes$ = this.store.select(selectBackupVolumes);
  readonly loaded$ = this.store.select(selectBackupsLoaded);
  readonly loading$ = this.store.select(selectBackupsLoading);
  readonly error$ = this.store.select(selectBackupsError);
  readonly busy$ = this.store.select(selectBackupsBusy);
  readonly selected$ = this.store.select(selectSelectedBackup);
  readonly volumeBackups$ = this.store.select(selectSelectedVolumeBackups);
  readonly selectedLoading$ = this.store.select(selectSelectedBackupLoading);
  readonly selectedError$ = this.store.select(selectSelectedBackupError);
  readonly files$ = this.store.select(selectBackupFiles);
  readonly diff$ = this.store.select(selectBackupDiff);
  readonly restores$ = this.store.select(selectBackupRestores);
  readonly restoreTests$ = this.store.select(selectRestoreTests);
  readonly restoresLoaded$ = this.store.select(selectRestoresLoaded);
  readonly restoresLoading$ = this.store.select(selectRestoresLoading);
  readonly restoresError$ = this.store.select(selectRestoresError);
  readonly restoresBusy$ = this.store.select(selectRestoresBusy);
  readonly deletions$ = this.store.select(selectBackupDeletions);
  readonly openDeletions$ = this.store.select(selectOpenDeletions);
  readonly deletionsLoading$ = this.store.select(selectDeletionsLoading);
  readonly deletionsError$ = this.store.select(selectDeletionsError);
  readonly backingUp$ = this.store.select(selectBackingUp);
  readonly testing$ = this.store.select(selectTestingBackups);
  readonly actionError$ = this.store.select(selectBackupActionError);
  readonly requestingDeletion$ = this.store.select(selectRequestingDeletion);
  readonly deletionRequestError$ = this.store.select(selectDeletionRequestError);
  readonly requestedDeletion$ = this.store.select(selectRequestedDeletion);
  readonly deletionActing$ = this.store.select(selectDeletionActing);
  readonly deletionActionError$ = this.store.select(selectDeletionActionError);
  readonly planningRestore$ = this.store.select(selectPlanningRestore);
  readonly restorePlanError$ = this.store.select(selectRestorePlanError);

  /** `silent`: refresh without the loading state (polling). */
  load(project: string | null = null, silent = false): void {
    this.store.dispatch(loadBackups({ project, silent }));
  }

  open(id: string, silent = false): void {
    this.store.dispatch(loadBackup({ id, silent }));
  }

  browse(id: string, path = ''): void {
    this.store.dispatch(loadBackupFiles({ id, path }));
  }

  compare(from: string, to: string): void {
    this.store.dispatch(loadBackupDiff({ from, to }));
  }

  loadRestores(project: string | null = null, silent = false): void {
    this.store.dispatch(loadRestores({ project, silent }));
  }

  loadDeletions(silent = false): void {
    this.store.dispatch(loadDeletions({ silent }));
  }

  backupNow(volume: string): void {
    this.store.dispatch(backupNow({ volume }));
  }

  testNow(id: string): void {
    this.store.dispatch(startRestoreTest({ id }));
  }

  clearActionError(): void {
    this.store.dispatch(clearBackupActionError());
  }

  requestDeletion(backupIds: string[], reason: string): void {
    this.store.dispatch(requestBackupDeletion({ backupIds, reason }));
  }

  clearDeletionRequest(): void {
    this.store.dispatch(clearBackupDeletionRequest());
  }

  actOnDeletion(id: string, action: BackupDeletionAction): void {
    this.store.dispatch(backupDeletionAction({ id, action }));
  }

  clearDeletionActionError(): void {
    this.store.dispatch(clearBackupDeletionActionError());
  }

  planRestore(request: RestoreRequest): void {
    this.store.dispatch(planRestore({ request }));
  }

  clearRestorePlanError(): void {
    this.store.dispatch(clearRestorePlanError());
  }
}
