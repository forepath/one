import { Test } from '@nestjs/testing';
import Redis from 'ioredis';

import { RedisCacheService } from './redis-cache.service';

const redisInstance = {
  connect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn(),
  set: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => redisInstance),
}));

const MockedRedis = Redis as unknown as jest.Mock;

describe('RedisCacheService', () => {
  let service: RedisCacheService;
  const originalCacheEnabled = process.env['REDIS_CACHE_ENABLED'];

  beforeEach(async () => {
    process.env['REDIS_CACHE_ENABLED'] = 'true';
    redisInstance.get.mockReset();
    redisInstance.set.mockReset();
    redisInstance.connect.mockClear().mockResolvedValue(undefined);
    redisInstance.quit.mockClear().mockResolvedValue('OK');
    MockedRedis.mockClear();

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
    redisInstance.get.mockResolvedValueOnce(JSON.stringify([{ id: 'fsn1', name: 'Falkenstein' }]));

    const result = await service.getJson<{ id: string; name: string }[]>('test:key');

    expect(result).toEqual([{ id: 'fsn1', name: 'Falkenstein' }]);
    expect(redisInstance.connect).toHaveBeenCalled();
  });

  it('returns null on cache miss', async () => {
    redisInstance.get.mockResolvedValueOnce(null);

    const result = await service.getJson('test:key');

    expect(result).toBeNull();
  });

  it('stores JSON with TTL', async () => {
    await service.setJson('test:key', [{ id: 'fra1' }], 3600);

    expect(redisInstance.set).toHaveBeenCalledWith('test:key', JSON.stringify([{ id: 'fra1' }]), 'EX', 3600);
  });

  it('skips Redis when cache is disabled', async () => {
    process.env['REDIS_CACHE_ENABLED'] = 'false';
    const disabledService = new RedisCacheService();

    await expect(disabledService.getJson('test:key')).resolves.toBeNull();
    expect(MockedRedis).not.toHaveBeenCalled();
  });

  it('returns null when Redis get fails', async () => {
    redisInstance.get.mockRejectedValueOnce(new Error('connection lost'));

    const result = await service.getJson('test:key');

    expect(result).toBeNull();
  });
});
