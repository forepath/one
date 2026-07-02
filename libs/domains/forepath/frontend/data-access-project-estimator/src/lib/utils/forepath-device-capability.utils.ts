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
      reason: 'WebGPU adapter could not be initialized on this device.',
      memoryProfile: null,
    };
  }

  const deviceMemoryGb = resolveDeviceMemoryGb(navigatorLike);
  const hardwareConcurrency = navigatorLike.hardwareConcurrency ?? 0;
  const memoryProfile = resolveForepathLlmMemoryProfile({ deviceMemoryGb, hardwareConcurrency });

  if (!memoryProfile) {
    return {
      supported: false,
      reason: 'At least 4 GB of device memory is required for local estimation.',
      memoryProfile: null,
    };
  }

  return {
    supported: true,
    reason: null,
    memoryProfile,
  };
}
