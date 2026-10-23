import { Test, TestingModule } from '@nestjs/testing';

import type { HostIsolationCapabilitiesDto } from '../dto/container-isolation.dto';
import { IsolationCapabilitiesService } from '../services/isolation-capabilities.service';

import { IsolationController } from './isolation.controller';

describe('IsolationController', () => {
  let controller: IsolationController;
  const capabilities: HostIsolationCapabilitiesDto = {
    revision: 'sha256:rev',
    probedAt: '2026-10-15T20:00:00.000Z',
    probing: false,
    levels: {
      standard: { rank: 1, runtime: 'runc', state: 'ready' },
      sandboxed: { rank: 2, runtime: 'runsc-systrap', state: 'ready' },
      'sandboxed-kvm': { rank: 3, runtime: 'runsc-kvm', state: 'unsupported', reasonCode: 'E_RUNTIME_NOT_REGISTERED' },
      microvm: { rank: 4, runtime: 'runc', state: 'unsupported', reasonCode: 'E_KVM_UNAVAILABLE' },
    },
    recommendedLevel: 'sandboxed',
    availableLevels: ['sandboxed', 'standard'],
  };
  const isolationCapabilities = {
    getCapabilities: jest.fn().mockReturnValue(capabilities),
    requestProbe: jest.fn().mockResolvedValue(capabilities),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IsolationController],
      providers: [{ provide: IsolationCapabilitiesService, useValue: isolationCapabilities }],
    }).compile();

    controller = module.get(IsolationController);
    jest.clearAllMocks();
  });

  it('returns the current capability record', () => {
    expect(controller.getCapabilities()).toBe(capabilities);
    expect(isolationCapabilities.getCapabilities).toHaveBeenCalled();
  });

  it('requests a (rate limited) re-probe', async () => {
    await expect(controller.probe()).resolves.toBe(capabilities);
    expect(isolationCapabilities.requestProbe).toHaveBeenCalled();
  });
});
