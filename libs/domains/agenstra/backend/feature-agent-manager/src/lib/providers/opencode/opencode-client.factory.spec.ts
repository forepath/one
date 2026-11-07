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

describe('OpenCodeClientFactory.ensureInstanceReady', () => {
  const connection = { baseUrl: 'http://worker:4096/', authorization: 'Basic x' };
  const response = (status: number, body: unknown = {}) =>
    ({ ok: status >= 200 && status < 300, status, body: { cancel: jest.fn() }, json: async () => body }) as never;
  let fetchMock: jest.SpyInstance;
  let factory: OpenCodeClientFactory;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    factory = new OpenCodeClientFactory({ findById: jest.fn() } as never, {} as never);
  });

  afterEach(() => fetchMock.mockRestore());

  it('bootstraps the directory instance with one request and caches the result', async () => {
    fetchMock.mockResolvedValue(response(200));

    await expect(factory.ensureInstanceReady('a1', 'c1', connection)).resolves.toBe(true);
    await expect(factory.ensureInstanceReady('a1', 'c1', connection)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://worker:4096/mcp',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Basic x' }) }),
    );
  });

  it('disposes an instance stuck after an interrupted bootstrap and verifies it again', async () => {
    fetchMock
      .mockResolvedValueOnce(response(499))
      .mockResolvedValueOnce(response(200, true))
      .mockResolvedValueOnce(response(200));

    await expect(factory.ensureInstanceReady('a1', 'c1', connection)).resolves.toBe(true);

    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
      'GET http://worker:4096/mcp',
      'POST http://worker:4096/instance/dispose',
      'GET http://worker:4096/mcp',
    ]);
  });

  it('shares one check between concurrent callers', async () => {
    let release: (value: unknown) => void = () => undefined;

    fetchMock.mockReturnValue(new Promise((resolve) => (release = () => resolve(response(200)))));

    const first = factory.ensureInstanceReady('a1', 'c1', connection);
    const second = factory.ensureInstanceReady('a1', 'c1', connection);

    release(undefined);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws and checks again after a failure or invalidation', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(factory.ensureInstanceReady('a1', 'c1', connection)).resolves.toBe(false);

    fetchMock.mockResolvedValueOnce(response(499)).mockResolvedValueOnce(response(500));
    await expect(factory.ensureInstanceReady('a1', 'c1', connection)).resolves.toBe(false);

    fetchMock.mockResolvedValue(response(200));
    await expect(factory.ensureInstanceReady('a1', 'c1', connection)).resolves.toBe(true);

    factory.invalidate('a1');
    await expect(factory.ensureInstanceReady('a1', 'c1', connection)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('warms the instance up as soon as the server is healthy', async () => {
    const docker = { resolveContainerHttpBaseUrl: jest.fn().mockResolvedValue('http://worker:4096') };
    const healthy = new OpenCodeClientFactory({ findById: jest.fn() } as never, docker as never);

    fetchMock.mockImplementation(async (url: string) =>
      response(200, url.endsWith('/global/health') ? { healthy: true } : {}),
    );

    await healthy.waitForHealthy('a1', 'c1', { password: 'pw', timeoutMs: 10_000 });
    await healthy.ensureInstanceReady('a1', 'c1');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://worker:4096/global/health',
      'http://worker:4096/mcp',
    ]);
  });
});
