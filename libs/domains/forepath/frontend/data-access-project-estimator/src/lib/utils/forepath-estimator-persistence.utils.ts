import {
  FOREPATH_ESTIMATOR_STORAGE_GPU_ACCESS_KEY,
  FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY,
} from '../constants/forepath-estimator-persistence.constants';
import type { ForepathLlmMemoryProfileId } from '../constants/forepath-llm-memory.constants';

const MEMORY_PROFILE_IDS: readonly ForepathLlmMemoryProfileId[] = ['lite', 'balanced', 'standard'];

function isMemoryProfileId(value: string): value is ForepathLlmMemoryProfileId {
  return (MEMORY_PROFILE_IDS as readonly string[]).includes(value);
}

export function getEstimatorPersistenceStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const probeKey = '__forepath_storage_probe__';
      storage.setItem(probeKey, '1');
      storage.removeItem(probeKey);

      return storage;
    } catch {
      continue;
    }
  }

  return null;
}

export function readGpuAccessGranted(): boolean {
  const storage = getEstimatorPersistenceStorage();

  if (!storage) {
    return false;
  }

  return storage.getItem(FOREPATH_ESTIMATOR_STORAGE_GPU_ACCESS_KEY) === 'true';
}

export function writeGpuAccessGranted(granted: boolean): void {
  const storage = getEstimatorPersistenceStorage();

  if (!storage) {
    return;
  }

  if (granted) {
    storage.setItem(FOREPATH_ESTIMATOR_STORAGE_GPU_ACCESS_KEY, 'true');
    return;
  }

  storage.removeItem(FOREPATH_ESTIMATOR_STORAGE_GPU_ACCESS_KEY);
}

export function readSavedMemoryProfileId(): ForepathLlmMemoryProfileId | null {
  const storage = getEstimatorPersistenceStorage();

  if (!storage) {
    return null;
  }

  const value = storage.getItem(FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY);

  if (!value || !isMemoryProfileId(value)) {
    return null;
  }

  return value;
}

export function writeSavedMemoryProfileId(profileId: ForepathLlmMemoryProfileId): void {
  const storage = getEstimatorPersistenceStorage();

  if (!storage) {
    return;
  }

  storage.setItem(FOREPATH_ESTIMATOR_STORAGE_MEMORY_PROFILE_KEY, profileId);
}
