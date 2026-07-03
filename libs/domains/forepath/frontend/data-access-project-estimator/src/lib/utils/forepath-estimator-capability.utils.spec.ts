import { FOREPATH_LLM_MEMORY_PROFILE_STANDARD } from '../constants/forepath-llm-memory.constants';
import type { ForepathLlmMemoryProfileService } from '../services/forepath-llm-memory-profile.service';
import { ProjectEstimatorActions } from '../state/project-estimator/project-estimator.actions';
import { FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY } from '../constants/forepath-estimator-persistence.constants';

import { buildCapabilityCheckSuccessAction } from './forepath-estimator-capability.utils';

describe('forepath estimator capability utils', () => {
  const memoryProfileService = {
    setProfile: jest.fn(),
  } as unknown as ForepathLlmMemoryProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('should restore a saved profile when device benchmark allows it', () => {
    window.sessionStorage.setItem(FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY, 'balanced');

    const action = buildCapabilityCheckSuccessAction(
      {
        supported: true,
        reason: null,
        memoryProfile: FOREPATH_LLM_MEMORY_PROFILE_STANDARD,
      },
      memoryProfileService,
      { persistGpuAccess: true, restoreSavedProfile: true },
    );

    expect(action).toEqual(
      ProjectEstimatorActions.checkDeviceCapabilitySuccess({
        supported: true,
        reason: null,
        deviceMaxMemoryProfileId: 'standard',
        activeMemoryProfileId: 'balanced',
      }),
    );
    expect(memoryProfileService.setProfile).toHaveBeenCalled();
  });
});
