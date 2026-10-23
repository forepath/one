import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateRolloutRequest, RolloutAction } from '../../types/updates.types';
import {
  cancelBundleUpload,
  clearBundleUpload,
  clearCreateRolloutError,
  clearRolloutActionError,
  createRollout,
  downloadRelease,
  loadRollout,
  loadUpdates,
  rolloutAction,
  uploadBundle,
} from './updates.actions';
import {
  selectBundleUpload,
  selectBundleUploadError,
  selectClusterResourceName,
  selectCreateRolloutError,
  selectCreatingRollout,
  selectDownloadError,
  selectDownloadingReleases,
  selectMaintenanceWindows,
  selectPlannableReleases,
  selectReleasesByChannel,
  selectRolloutActing,
  selectRolloutActionError,
  selectRollouts,
  selectSelectedRollout,
  selectSelectedRolloutError,
  selectSelectedRolloutLoading,
  selectSelectedRolloutWaves,
  selectUpdateReleases,
  selectUpdatesBusy,
  selectUpdatesError,
  selectUpdatesLoaded,
  selectUpdatesLoading,
  selectUpdatesStatus,
  selectUploadedRelease,
} from './updates.selectors';

/** Updates (3.26): versions, releases and bundles, update plans and their rollout. */
@Injectable()
export class ConsoleUpdatesFacade {
  private readonly store = inject(Store);

  readonly status$ = this.store.select(selectUpdatesStatus);
  readonly releases$ = this.store.select(selectUpdateReleases);
  readonly releasesByChannel$ = this.store.select(selectReleasesByChannel);
  readonly plannableReleases$ = this.store.select(selectPlannableReleases);
  readonly rollouts$ = this.store.select(selectRollouts);
  readonly windows$ = this.store.select(selectMaintenanceWindows);
  readonly clusterResource$ = this.store.select(selectClusterResourceName);
  readonly loaded$ = this.store.select(selectUpdatesLoaded);
  readonly loading$ = this.store.select(selectUpdatesLoading);
  readonly error$ = this.store.select(selectUpdatesError);
  readonly busy$ = this.store.select(selectUpdatesBusy);
  readonly selected$ = this.store.select(selectSelectedRollout);
  readonly selectedWaves$ = this.store.select(selectSelectedRolloutWaves);
  readonly selectedLoading$ = this.store.select(selectSelectedRolloutLoading);
  readonly selectedError$ = this.store.select(selectSelectedRolloutError);
  readonly downloading$ = this.store.select(selectDownloadingReleases);
  readonly downloadError$ = this.store.select(selectDownloadError);
  readonly upload$ = this.store.select(selectBundleUpload);
  readonly uploadError$ = this.store.select(selectBundleUploadError);
  readonly uploaded$ = this.store.select(selectUploadedRelease);
  readonly creating$ = this.store.select(selectCreatingRollout);
  readonly createError$ = this.store.select(selectCreateRolloutError);
  readonly acting$ = this.store.select(selectRolloutActing);
  readonly actionError$ = this.store.select(selectRolloutActionError);

  /** `silent`: refresh without the loading state (polling). */
  load(silent = false): void {
    this.store.dispatch(loadUpdates({ silent }));
  }

  open(id: string, silent = false): void {
    this.store.dispatch(loadRollout({ id, silent }));
  }

  download(version: string): void {
    this.store.dispatch(downloadRelease({ version }));
  }

  upload(file: File): void {
    this.store.dispatch(uploadBundle({ file }));
  }

  cancelUpload(): void {
    this.store.dispatch(cancelBundleUpload());
  }

  clearUpload(): void {
    this.store.dispatch(clearBundleUpload());
  }

  create(request: CreateRolloutRequest): void {
    this.store.dispatch(createRollout({ request }));
  }

  clearCreateError(): void {
    this.store.dispatch(clearCreateRolloutError());
  }

  act(id: string, action: RolloutAction, emergency = false): void {
    this.store.dispatch(rolloutAction({ id, action, ...(emergency ? { emergency } : {}) }));
  }

  clearActionError(): void {
    this.store.dispatch(clearRolloutActionError());
  }
}
