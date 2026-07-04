import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ForepathDeviceCapabilityService } from './forepath-device-capability.service';

describe('ForepathDeviceCapabilityService', () => {
  const originalNavigator = globalThis.navigator;

  const setup = (platformId: object) => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: platformId }],
    });

    return TestBed.inject(ForepathDeviceCapabilityService);
  };

  const mockNavigator = (overrides: Record<string, unknown>): void => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...originalNavigator,
        ...overrides,
      },
    });
  };

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  it('should reject non-browser platforms during probe', () => {
    const service = setup('server');

    expect(service.probeEnvironment()).toEqual({
      awaitingGpuPermission: false,
      unsupportedReason: 'Please open this page in a supported browser to get an instant quote.',
    });
  });

  it('should require gpu permission when webgpu api is available', () => {
    mockNavigator({
      gpu: {
        requestAdapter: jest.fn(),
      },
    });
    const service = setup('browser');

    expect(service.probeEnvironment()).toEqual({
      awaitingGpuPermission: true,
      unsupportedReason: null,
    });
  });

  it('should reject non-browser platforms', async () => {
    const service = setup('server');

    await expect(service.checkCapability()).resolves.toEqual({
      supported: false,
      reason: 'Please open this page in a supported browser to get an instant quote.',
      memoryProfile: null,
    });
  });

  it('should reject devices without WebGPU', async () => {
    mockNavigator({ gpu: undefined });
    const service = setup('browser');

    await expect(service.checkCapability()).resolves.toMatchObject({
      supported: false,
      reason: expect.stringContaining('instant quote tool'),
    });
  });

  it('should accept capable browser devices', async () => {
    mockNavigator({
      gpu: {
        requestAdapter: jest.fn().mockResolvedValue({}),
      },
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    const service = setup('browser');

    await expect(service.checkCapability()).resolves.toEqual({
      supported: true,
      reason: null,
      memoryProfile: expect.objectContaining({
        profileId: 'standard',
      }),
    });
  });

  it('should reject low-memory devices', async () => {
    mockNavigator({
      gpu: {
        requestAdapter: jest.fn().mockResolvedValue({}),
      },
      hardwareConcurrency: 8,
      deviceMemory: 2,
    });
    const service = setup('browser');

    await expect(service.checkCapability()).resolves.toMatchObject({
      supported: false,
      reason: expect.stringContaining('memory'),
    });
  });
});
