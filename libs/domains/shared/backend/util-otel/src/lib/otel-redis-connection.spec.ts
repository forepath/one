import { createValkeyGlideClient } from 'bullmq';

import { createOtelBullMqConnection, readOtelRedisConnectionConfig } from './otel-redis-connection';

const adapter = { quit: jest.fn().mockResolvedValue('OK') };
const createClient = jest.fn(() => Promise.resolve({ raw: true }));

jest.mock('@valkey/valkey-glide', () => ({
  GlideClient: { createClient: (...args: unknown[]) => createClient(...(args as [])) },
}));

jest.mock('bullmq', () => ({
  createValkeyGlideClient: jest.fn(() => adapter),
}));

const config = { host: 'valkey', port: 6379, db: 0, keyPrefix: 'test' };

describe('otel-redis-connection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers REDIS_* over VALKEY_* names for the ioredis driver', () => {
    expect(
      readOtelRedisConnectionConfig({
        VALKEY_HOST: 'valkey',
        REDIS_HOST: 'redis',
        VALKEY_DB: '2',
        CACHE_CLIENT: 'ioredis',
      }),
    ).toEqual({ host: 'redis', port: 6379, db: 2, keyPrefix: 'agenstra' });
  });

  it('prefers VALKEY_* over legacy REDIS_* names for the default glide driver', () => {
    expect(readOtelRedisConnectionConfig({ VALKEY_HOST: 'valkey', REDIS_HOST: 'redis', REDIS_DB: '2' })).toEqual({
      host: 'valkey',
      port: 6379,
      db: 2,
      keyPrefix: 'agenstra',
    });
  });

  it('creates a shared lazily connecting GLIDE client by default', async () => {
    const handle = createOtelBullMqConnection(config, {});

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ lazyConnect: true, databaseId: 0 }));
    expect(createValkeyGlideClient).toHaveBeenCalled();
    expect(handle.connection).toBe(adapter);

    await handle.close();
    expect(adapter.quit).toHaveBeenCalled();
  });

  it('returns ioredis options when CACHE_CLIENT=ioredis', () => {
    const handle = createOtelBullMqConnection(config, { CACHE_CLIENT: 'ioredis' });

    expect(handle.connection).toEqual({ host: 'valkey', port: 6379, db: 0 });
    expect(createClient).not.toHaveBeenCalled();
  });
});
