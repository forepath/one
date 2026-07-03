import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import { evaluateDeviceCapability, type DeviceCapabilityResult } from '../utils/forepath-device-capability.utils';

export type { DeviceCapabilityResult };

export interface EstimatorEnvironmentProbe {
  awaitingGpuPermission: boolean;
  unsupportedReason: string | null;
}

@Injectable({ providedIn: 'root' })
export class ForepathDeviceCapabilityService {
  private readonly platformId = inject(PLATFORM_ID);

  probeEnvironment(): EstimatorEnvironmentProbe {
    if (!isPlatformBrowser(this.platformId)) {
      return {
        awaitingGpuPermission: false,
        unsupportedReason: 'Local estimation is only available in the browser.',
      };
    }

    if (!('gpu' in navigator) || !navigator.gpu) {
      return {
        awaitingGpuPermission: false,
        unsupportedReason: 'WebGPU is required to run the local estimation model on this device.',
      };
    }

    return {
      awaitingGpuPermission: true,
      unsupportedReason: null,
    };
  }

  async requestGpuAccess(): Promise<DeviceCapabilityResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return {
        supported: false,
        reason: 'Local estimation is only available in the browser.',
        memoryProfile: null,
      };
    }

    if (!('gpu' in navigator) || !navigator.gpu) {
      return {
        supported: false,
        reason: 'WebGPU is required to run the local estimation model on this device.',
        memoryProfile: null,
      };
    }

    try {
      const gpu = navigator.gpu as { requestAdapter: () => Promise<unknown | null> };
      const adapter = await gpu.requestAdapter();

      return evaluateDeviceCapability(navigator, adapter !== null);
    } catch {
      return {
        supported: false,
        reason: 'WebGPU initialization failed on this device.',
        memoryProfile: null,
      };
    }
  }

  /** @deprecated Use probeEnvironment() and requestGpuAccess() */
  async checkCapability(): Promise<DeviceCapabilityResult> {
    const probe = this.probeEnvironment();

    if (!probe.awaitingGpuPermission) {
      return {
        supported: false,
        reason: probe.unsupportedReason,
        memoryProfile: null,
      };
    }

    return this.requestGpuAccess();
  }
}
