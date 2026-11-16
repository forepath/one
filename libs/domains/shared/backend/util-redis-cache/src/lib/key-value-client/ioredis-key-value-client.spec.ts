import Redis from 'ioredis';

import { IoRedisKeyValueClient } from './ioredis-key-value-client';

const redisInstance = {
  connect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue('PONG'),
  get: jest.fn(),
  getdel: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  mget: jest.fn(),
  scan: jest.fn(),
  rpush: jest.fn().mockResolvedValue(2),
  expire: jest.fn().mockResolvedValue(1),
  lpop: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue('OK'),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => redisInstance),
}));

const MockedRedis = Redis as unknown as jest.Mock;

describe('IoRedisKeyValueClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createClient(password?: string): IoRedisKeyValueClient {
    return new IoRedisKeyValueClient({
      config: { host: 'valkey', port: 6379, db: 2, keyPrefix: 'p', ...(password ? { password } : {}) },
      clientName: 'forepath-test',
    });
  }

  it('configures a lazy, fail-fast connection', () => {
    createClient('secret');

    expect(MockedRedis).toHaveBeenCalledWith({
      host: 'valkey',
      port: 6379,
      db: 2,
      password: 'secret',
      connectionName: 'forepath-test',
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  });

  it('maps list commands to ioredis', async () => {
    const client = createClient();

    await client.connect();
    await expect(client.rpush('l', ['a', 'b'], 30)).resolves.toBe(2);
    expect(redisInstance.rpush).toHaveBeenCalledWith('l', 'a', 'b');
    expect(redisInstance.expire).toHaveBeenCalledWith('l', 30);

    redisInstance.expire.mockClear();
    await client.rpush('l', ['c']);
    expect(redisInstance.expire).not.toHaveBeenCalled();

    redisInstance.lpop.mockResolvedValueOnce(['a', 'b']);
    await expect(client.lpop('l', 5)).resolves.toEqual(['a', 'b']);
    expect(redisInstance.lpop).toHaveBeenCalledWith('l', 5);
    redisInstance.lpop.mockResolvedValueOnce(null);
    await expect(client.lpop('missing', 5)).resolves.toEqual([]);

    await client.del('l');
    expect(redisInstance.del).toHaveBeenCalledWith('l');
  });

  it('maps commands to ioredis', async () => {
    const client = createClient();

    await client.connect();
    await expect(client.ping()).resolves.toBe(true);

    redisInstance.get.mockResolvedValueOnce('v');
    await expect(client.get('k')).resolves.toBe('v');

    redisInstance.getdel.mockResolvedValueOnce('v');
    await expect(client.getDel('k')).resolves.toBe('v');

    await client.set('k', 'v');
    expect(redisInstance.set).toHaveBeenLastCalledWith('k', 'v');
    await client.set('k', 'v', 60);
    expect(redisInstance.set).toHaveBeenLastCalledWith('k', 'v', 'EX', 60);

    redisInstance.mget.mockResolvedValueOnce(['a', null]);
    await expect(client.mget(['k1', 'k2'])).resolves.toEqual(['a', null]);
    expect(redisInstance.mget).toHaveBeenCalledWith('k1', 'k2');

    redisInstance.scan.mockResolvedValueOnce(['0', ['k1']]);
    await expect(client.scan('0', 'p:*', 100)).resolves.toEqual(['0', ['k1']]);
    expect(redisInstance.scan).toHaveBeenCalledWith('0', 'MATCH', 'p:*', 'COUNT', 100);

    await client.close();
    expect(redisInstance.quit).toHaveBeenCalled();
  });
});
