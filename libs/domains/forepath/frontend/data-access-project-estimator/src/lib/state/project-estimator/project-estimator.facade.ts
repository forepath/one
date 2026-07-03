import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { ProjectEstimatorDebugPreset } from './project-estimator.debug';
import { ProjectEstimatorActions } from './project-estimator.actions';
import type { ForepathLlmMemoryProfileId } from '../../constants/forepath-llm-memory.constants';
import {
  selectCanSubmit,
  selectCurrentEstimate,
  selectActiveMemoryProfileId,
  selectDeviceCapability,
  selectDeviceMaxMemoryProfileId,
  selectDeviceSupported,
  selectEstimateError,
  selectGpuAccessStatus,
  selectHasEstimate,
  selectIsAwaitingGpuPermission,
  selectIsCheckingDevice,
  selectIsEstimating,
  selectIsModelLoading,
  selectIsModelReady,
  selectIsRequestingGpuAccess,
  selectMessages,
  selectModelLoadProgress,
  selectModelLoadText,
  selectModelStatus,
  selectUnsupportedReason,
} from './project-estimator.selectors';

@Injectable()
export class ProjectEstimatorFacade {
  private readonly store = inject(Store);

  readonly deviceCapability$ = this.store.select(selectDeviceCapability);
  readonly gpuAccessStatus$ = this.store.select(selectGpuAccessStatus);
  readonly deviceSupported$ = this.store.select(selectDeviceSupported);
  readonly unsupportedReason$ = this.store.select(selectUnsupportedReason);
  readonly isAwaitingGpuPermission$ = this.store.select(selectIsAwaitingGpuPermission);
  readonly isRequestingGpuAccess$ = this.store.select(selectIsRequestingGpuAccess);
  readonly isCheckingDevice$ = this.store.select(selectIsCheckingDevice);
  readonly modelStatus$ = this.store.select(selectModelStatus);
  readonly isModelLoading$ = this.store.select(selectIsModelLoading);
  readonly modelLoadProgress$ = this.store.select(selectModelLoadProgress);
  readonly modelLoadText$ = this.store.select(selectModelLoadText);
  readonly deviceMaxMemoryProfileId$ = this.store.select(selectDeviceMaxMemoryProfileId);
  readonly activeMemoryProfileId$ = this.store.select(selectActiveMemoryProfileId);
  readonly isModelReady$ = this.store.select(selectIsModelReady);
  readonly messages$ = this.store.select(selectMessages);
  readonly currentEstimate$ = this.store.select(selectCurrentEstimate);
  readonly isEstimating$ = this.store.select(selectIsEstimating);
  readonly error$ = this.store.select(selectEstimateError);
  readonly hasEstimate$ = this.store.select(selectHasEstimate);
  readonly canSubmit$ = this.store.select(selectCanSubmit);

  initialize(): void {
    this.store.dispatch(ProjectEstimatorActions.initializeEstimator());
  }

  requestGpuAccess(): void {
    this.store.dispatch(ProjectEstimatorActions.requestGpuAccess());
  }

  submitDescription(description: string): void {
    this.store.dispatch(ProjectEstimatorActions.submitProjectDescription({ description }));
  }

  clearError(): void {
    this.store.dispatch(ProjectEstimatorActions.clearEstimateError());
  }

  startOver(): void {
    this.store.dispatch(ProjectEstimatorActions.startOver());
  }

  changeMemoryProfile(profileId: ForepathLlmMemoryProfileId): void {
    this.store.dispatch(ProjectEstimatorActions.changeMemoryProfile({ profileId }));
  }

  setDebugState(preset: ProjectEstimatorDebugPreset): void {
    this.store.dispatch(ProjectEstimatorActions.setDebugState({ preset }));
  }
}
