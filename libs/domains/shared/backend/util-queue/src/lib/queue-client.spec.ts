import { createValkeyGlideClient } from 'bullmq';

import { createBullMqConnection } from './queue-client';

const rawClientPromise = Promise.resolve({ raw: true });
const adapter = { quit: jest.fn().mockResolvedValue('OK') };
const createClient = jest.fn(() => rawClientPromise);

jest.mock('@valkey/valkey-glide', () => ({
  GlideClient: { createClient: (...args: unknown[]) => createClient(...(args as [])) },
}));

jest.mock('bullmq', () => ({
  createValkeyGlideClient: jest.fn(() => adapter),
}));

const config = { host: 'valkey', port: 6379, db: 1, keyPrefix: 'test', password: 'secret' };

describe('createBullMqConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('wraps a lazily connecting GLIDE client by default', async () => {
    const handle = createBullMqConnection(config, {});

    expect(handle.driver).toBe('glide');
    expect(createClient).toHaveBeenCalledWith({
      addresses: [{ host: 'valkey', port: 6379 }],
      databaseId: 1,
      credentials: { password: 'secret' },
      requestTimeout: 5000,
      lazyConnect: true,
    });
    expect(createValkeyGlideClient).toHaveBeenCalledWith(rawClientPromise);
    expect(handle.connection).toBe(adapter);

    await handle.close();
    expect(adapter.quit).toHaveBeenCalled();
  });

  it('returns plain ioredis options when CACHE_CLIENT=ioredis', async () => {
    const handle = createBullMqConnection(config, { CACHE_CLIENT: 'ioredis' });

    expect(handle.driver).toBe('ioredis');
    expect(handle.connection).toEqual({ host: 'valkey', port: 6379, db: 1, password: 'secret' });
    expect(createClient).not.toHaveBeenCalled();

    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('falls back to GLIDE for unknown CACHE_CLIENT values', () => {
    expect(createBullMqConnection(config, { CACHE_CLIENT: 'node-redis' }).driver).toBe('glide');
  });
});
