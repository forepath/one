import type { ForepathLlmMemoryProfileId } from '../constants/forepath-llm-memory.constants';
import type { ForepathLlmMemoryProfileService } from '../services/forepath-llm-memory-profile.service';
import { ProjectEstimatorActions } from '../state/project-estimator/project-estimator.actions';
import type { DeviceCapabilityResult } from './forepath-device-capability.utils';
import {
  readGpuAccessGranted,
  readSavedMemoryProfileId,
  writeGpuAccessGranted,
  writeSavedMemoryProfileId,
} from './forepath-estimator-persistence.utils';
import { getMemoryProfileById, resolveRestoredMemoryProfileId } from './forepath-memory-profile.utils';

export function buildCapabilityCheckSuccessAction(
  result: DeviceCapabilityResult,
  memoryProfileService: ForepathLlmMemoryProfileService,
  options: { persistGpuAccess: boolean; restoreSavedProfile: boolean },
): ReturnType<typeof ProjectEstimatorActions.checkDeviceCapabilitySuccess> {
  if (!result.supported || !result.memoryProfile) {
    return ProjectEstimatorActions.checkDeviceCapabilitySuccess({
      supported: false,
      reason: result.reason,
    });
  }

  if (options.persistGpuAccess) {
    writeGpuAccessGranted(true);
  }

  const deviceMaxMemoryProfileId = result.memoryProfile.profileId;
  const activeMemoryProfileId = options.restoreSavedProfile
    ? resolveRestoredMemoryProfileId(readSavedMemoryProfileId(), deviceMaxMemoryProfileId)
    : deviceMaxMemoryProfileId;

  memoryProfileService.setProfile(getMemoryProfileById(activeMemoryProfileId));

  return ProjectEstimatorActions.checkDeviceCapabilitySuccess({
    supported: true,
    reason: null,
    deviceMaxMemoryProfileId,
    activeMemoryProfileId,
  });
}

export function shouldAutoRequestGpuAccess(): boolean {
  return readGpuAccessGranted();
}

export function persistMemoryProfileSelection(profileId: ForepathLlmMemoryProfileId): void {
  writeSavedMemoryProfileId(profileId);
}
