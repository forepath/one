import {
  FOREPATH_ESTIMATOR_STORAGE_GPU_ACCESS_KEY,
  FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY,
} from '../constants/forepath-estimator-persistence.constants';

import {
  getEstimatorPersistenceStorage,
  readGpuAccessGranted,
  readSavedMemoryProfileId,
  writeGpuAccessGranted,
  writeSavedMemoryProfileId,
} from './forepath-estimator-persistence.utils';

describe('forepath estimator persistence utils', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('should read and write gpu access and profile in session storage', () => {
    writeGpuAccessGranted(true);
    writeSavedMemoryProfileId('balanced');

    expect(getEstimatorPersistenceStorage()).toBe(window.sessionStorage);
    expect(readGpuAccessGranted()).toBe(true);
    expect(readSavedMemoryProfileId()).toBe('balanced');
    expect(window.sessionStorage.getItem(FOREPATH_ESTIMATOR_STORAGE_GPU_ACCESS_KEY)).toBe('true');
    expect(window.sessionStorage.getItem(FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY)).toBe('balanced');
  });

  it('should ignore invalid saved profile ids', () => {
    window.sessionStorage.setItem(FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY, 'invalid');

    expect(readSavedMemoryProfileId()).toBeNull();
  });
});
