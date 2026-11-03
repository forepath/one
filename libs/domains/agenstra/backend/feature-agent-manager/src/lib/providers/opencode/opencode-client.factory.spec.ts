import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import {
  OpenCodeClientFactory,
  OPENCODE_HEALTH_TIMEOUT_MS_DEFAULT,
  OPENCODE_HEALTH_TIMEOUT_MS_ENV,
  OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_DEFAULT,
  OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_ENV,
  resolveOpencodeHealthTimeoutMs,
} from './opencode-client.factory';

describe('resolveOpencodeHealthTimeoutMs', () => {
  afterEach(() => {
    delete process.env[OPENCODE_HEALTH_TIMEOUT_MS_ENV];
    delete process.env[OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_ENV];
  });

  it('gives microVM workers (guest boot) a longer limit than container workers', () => {
    expect(resolveOpencodeHealthTimeoutMs('microvm')).toBe(OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_DEFAULT);
    expect(OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_DEFAULT).toBeGreaterThan(OPENCODE_HEALTH_TIMEOUT_MS_DEFAULT);

    for (const level of ['standard', 'sandboxed', 'sandboxed-kvm', null, undefined, 'unknown']) {
      expect(resolveOpencodeHealthTimeoutMs(level)).toBe(OPENCODE_HEALTH_TIMEOUT_MS_DEFAULT);
    }
  });

  it('takes valid overrides from the environment and ignores invalid ones', () => {
    process.env[OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_ENV] = '300000';
    process.env[OPENCODE_HEALTH_TIMEOUT_MS_ENV] = '90000';
    expect(resolveOpencodeHealthTimeoutMs('microvm')).toBe(300_000);
    expect(resolveOpencodeHealthTimeoutMs('standard')).toBe(90_000);

    for (const invalid of ['abc', '-1', '100', '']) {
      process.env[OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_ENV] = invalid;
      expect(resolveOpencodeHealthTimeoutMs('microvm')).toBe(OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_DEFAULT);
    }
  });
});

describe('OpenCodeClientFactory.waitForHealthy', () => {
  it('stops waiting as soon as the container is gone (agent deleted / recreated meanwhile)', async () => {
    const docker = {
      resolveContainerHttpBaseUrl: jest
        .fn()
        .mockRejectedValue(new NotFoundException("Container with ID 'c1' not found")),
    };
    const factory = new OpenCodeClientFactory({ findById: jest.fn() } as never, docker as never);
    const startedAt = Date.now();

    await expect(factory.waitForHealthy('agent-1', 'c1', { password: 'pw', timeoutMs: 60_000 })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(docker.resolveContainerHttpBaseUrl).toHaveBeenCalledTimes(1);
  });
});
