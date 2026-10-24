import { Test } from '@nestjs/testing';

import { createKeyValueClient } from './key-value-client/create-key-value-client';
import { RedisCacheService } from './redis-cache.service';

const kvClient = {
  driver: 'glide' as const,
  connect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn(),
  get: jest.fn(),
  getDel: jest.fn(),
  set: jest.fn(),
  mget: jest.fn(),
  scan: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('./key-value-client/create-key-value-client', () => ({
  createKeyValueClient: jest.fn(() => kvClient),
}));

const mockedCreateKeyValueClient = createKeyValueClient as jest.Mock;

describe('RedisCacheService', () => {
  let service: RedisCacheService;
  const originalCacheEnabled = process.env['REDIS_CACHE_ENABLED'];

  beforeEach(async () => {
    process.env['REDIS_CACHE_ENABLED'] = 'true';
    kvClient.get.mockReset();
    kvClient.getDel.mockReset();
    kvClient.set.mockReset();
    kvClient.connect.mockReset().mockResolvedValue(undefined);
    kvClient.close.mockClear().mockResolvedValue(undefined);
    mockedCreateKeyValueClient.mockClear();

    const moduleRef = await Test.createTestingModule({
      providers: [RedisCacheService],
    }).compile();

    service = moduleRef.get(RedisCacheService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    process.env['REDIS_CACHE_ENABLED'] = originalCacheEnabled;
  });

  it('returns parsed JSON on cache hit', async () => {
    kvClient.get.mockResolvedValueOnce(JSON.stringify([{ id: 'fsn1', name: 'Falkenstein' }]));

    const result = await service.getJson<{ id: string; name: string }[]>('test:key');

    expect(result).toEqual([{ id: 'fsn1', name: 'Falkenstein' }]);
    expect(kvClient.connect).toHaveBeenCalled();
    expect(mockedCreateKeyValueClient).toHaveBeenCalledWith(expect.objectContaining({ clientName: 'forepath-cache' }));
  });

  it('returns null on cache miss', async () => {
    kvClient.get.mockResolvedValueOnce(null);

    const result = await service.getJson('test:key');

    expect(result).toBeNull();
  });

  it('stores JSON with TTL', async () => {
    await expect(service.setJson('test:key', [{ id: 'fra1' }], 3600)).resolves.toBe(true);

    expect(kvClient.set).toHaveBeenCalledWith('test:key', JSON.stringify([{ id: 'fra1' }]), 3600);
  });

  it('takes a value atomically via GETDEL', async () => {
    kvClient.getDel.mockResolvedValueOnce(JSON.stringify({ ticket: 't1' }));

    await expect(service.takeJson('ticket:t1')).resolves.toEqual({ ticket: 't1' });
    expect(kvClient.getDel).toHaveBeenCalledWith('ticket:t1');
  });

  it('skips the store when cache is disabled', async () => {
    process.env['REDIS_CACHE_ENABLED'] = 'false';
    const disabledService = new RedisCacheService();

    await expect(disabledService.getJson('test:key')).resolves.toBeNull();
    expect(mockedCreateKeyValueClient).not.toHaveBeenCalled();
  });

  it('returns null when get fails', async () => {
    kvClient.get.mockRejectedValueOnce(new Error('connection lost'));

    const result = await service.getJson('test:key');

    expect(result).toBeNull();
  });

  it('fails open and retries the connection when connect fails', async () => {
    kvClient.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.getJson('test:key')).resolves.toBeNull();

    kvClient.get.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    await expect(service.getJson('test:key')).resolves.toEqual({ ok: true });
    expect(kvClient.connect).toHaveBeenCalledTimes(2);
  });

  it('closes the client on module destroy', async () => {
    kvClient.get.mockResolvedValueOnce(null);
    await service.getJson('test:key');

    await service.onModuleDestroy();

    expect(kvClient.close).toHaveBeenCalled();
  });
});
