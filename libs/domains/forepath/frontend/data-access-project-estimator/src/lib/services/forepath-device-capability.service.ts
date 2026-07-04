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
        unsupportedReason: 'Please open this page in a supported browser to get an instant quote.',
      };
    }

    if (!('gpu' in navigator) || !navigator.gpu) {
      return {
        awaitingGpuPermission: false,
        unsupportedReason:
          'This browser cannot run the instant quote tool. Try a recent version of Chrome, Edge, or Firefox.',
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
        reason: 'Please open this page in a supported browser to get an instant quote.',
        memoryProfile: null,
      };
    }

    if (!('gpu' in navigator) || !navigator.gpu) {
      return {
        supported: false,
        reason: 'This browser cannot run the instant quote tool. Try a recent version of Chrome, Edge, or Firefox.',
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
        reason: 'We could not start the quote tool in this browser. Try refreshing the page or using another browser.',
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
