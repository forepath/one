import {
  FOREPATH_LLM_MEMORY_PROFILE_BALANCED,
  FOREPATH_LLM_MEMORY_PROFILE_LITE,
  FOREPATH_LLM_MEMORY_PROFILE_STANDARD,
  type ForepathLlmMemoryProfile,
  type ForepathLlmMemoryProfileId,
} from '../constants/forepath-llm-memory.constants';

const MEMORY_PROFILES: Record<ForepathLlmMemoryProfileId, ForepathLlmMemoryProfile> = {
  lite: FOREPATH_LLM_MEMORY_PROFILE_LITE,
  balanced: FOREPATH_LLM_MEMORY_PROFILE_BALANCED,
  standard: FOREPATH_LLM_MEMORY_PROFILE_STANDARD,
};

const MEMORY_PROFILE_RANK: Record<ForepathLlmMemoryProfileId, number> = {
  lite: 1,
  balanced: 2,
  standard: 3,
};

const PROFILE_ORDER: ForepathLlmMemoryProfileId[] = ['lite', 'balanced', 'standard'];

export interface MemoryProfileSwitcherOption {
  profileId: ForepathLlmMemoryProfileId;
  isActive: boolean;
  canSelect: boolean;
}

export function getMemoryProfileById(profileId: ForepathLlmMemoryProfileId): ForepathLlmMemoryProfile {
  return MEMORY_PROFILES[profileId];
}

export function getMemoryProfileRank(profileId: ForepathLlmMemoryProfileId): number {
  return MEMORY_PROFILE_RANK[profileId];
}

export function canSwitchToMemoryProfile(
  targetProfileId: ForepathLlmMemoryProfileId,
  activeProfileId: ForepathLlmMemoryProfileId,
  deviceMaxProfileId: ForepathLlmMemoryProfileId,
): boolean {
  if (targetProfileId === activeProfileId) {
    return false;
  }

  return getMemoryProfileRank(targetProfileId) <= getMemoryProfileRank(deviceMaxProfileId);
}

export function listLowerMemoryProfileIds(
  activeProfileId: ForepathLlmMemoryProfileId,
  deviceMaxProfileId: ForepathLlmMemoryProfileId,
): ForepathLlmMemoryProfileId[] {
  const activeRank = getMemoryProfileRank(activeProfileId);

  return (Object.keys(MEMORY_PROFILES) as ForepathLlmMemoryProfileId[])
    .filter((profileId) => {
      const rank = getMemoryProfileRank(profileId);

      return rank < activeRank && rank <= getMemoryProfileRank(deviceMaxProfileId);
    })
    .sort((left, right) => getMemoryProfileRank(right) - getMemoryProfileRank(left));
}

export function listMemoryProfileSwitcherOptions(
  activeProfileId: ForepathLlmMemoryProfileId,
  deviceMaxProfileId: ForepathLlmMemoryProfileId,
): MemoryProfileSwitcherOption[] {
  const deviceMaxRank = getMemoryProfileRank(deviceMaxProfileId);

  return PROFILE_ORDER.filter((profileId) => getMemoryProfileRank(profileId) <= deviceMaxRank).map((profileId) => ({
    profileId,
    isActive: profileId === activeProfileId,
    canSelect: profileId !== activeProfileId,
  }));
}

export function resolveRestoredMemoryProfileId(
  savedProfileId: ForepathLlmMemoryProfileId | null,
  deviceMaxProfileId: ForepathLlmMemoryProfileId,
): ForepathLlmMemoryProfileId {
  if (!savedProfileId) {
    return deviceMaxProfileId;
  }

  if (getMemoryProfileRank(savedProfileId) <= getMemoryProfileRank(deviceMaxProfileId)) {
    return savedProfileId;
  }

  return deviceMaxProfileId;
}
