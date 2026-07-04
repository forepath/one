import { resolveForepathLlmMemoryProfile } from '../constants/forepath-llm-memory.constants';
import type { ForepathLlmMemoryProfile } from '../constants/forepath-llm-memory.constants';

export interface DeviceCapabilityResult {
  supported: boolean;
  reason: string | null;
  memoryProfile: ForepathLlmMemoryProfile | null;
}

export function resolveDeviceMemoryGb(navigatorLike: Navigator): number | undefined {
  return (navigatorLike as Navigator & { deviceMemory?: number }).deviceMemory;
}

export function evaluateDeviceCapability(navigatorLike: Navigator, hasWebGpuAdapter: boolean): DeviceCapabilityResult {
  if (!hasWebGpuAdapter) {
    return {
      supported: false,
      reason: 'We could not start the quote tool in this browser. Try refreshing the page or using another browser.',
      memoryProfile: null,
    };
  }

  const deviceMemoryGb = resolveDeviceMemoryGb(navigatorLike);
  const hardwareConcurrency = navigatorLike.hardwareConcurrency ?? 0;
  const memoryProfile = resolveForepathLlmMemoryProfile({ deviceMemoryGb, hardwareConcurrency });

  if (!memoryProfile) {
    return {
      supported: false,
      reason: 'This device does not have enough memory for the instant quote tool. Contact us for a tailored quote.',
      memoryProfile: null,
    };
  }

  return {
    supported: true,
    reason: null,
    memoryProfile,
  };
}
