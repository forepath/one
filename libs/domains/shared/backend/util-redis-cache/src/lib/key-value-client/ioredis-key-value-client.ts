import Redis from 'ioredis';

import type { KeyValueClient, KeyValueClientOptions } from './key-value-client';

/** ioredis adapter: lazy connect, no offline queue, one retry per request (fail fast for fail-open callers). */
export class IoRedisKeyValueClient implements KeyValueClient {
  readonly driver = 'ioredis' as const;
  private readonly client: Redis;

  constructor({ config, clientName }: KeyValueClientOptions) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      db: config.db,
      ...(config.password ? { password: config.password } : {}),
      ...(clientName ? { connectionName: clientName } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  getDel(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) {
      await this.client.set(key, value);
    } else {
      await this.client.set(key, value, 'EX', ttlSeconds);
    }
  }

  mget(keys: string[]): Promise<(string | null)[]> {
    return this.client.mget(...keys);
  }

  scan(cursor: string, match: string, count: number): Promise<[string, string[]]> {
    return this.client.scan(cursor, 'MATCH', match, 'COUNT', count);
  }

  async rpush(key: string, values: string[], ttlSeconds?: number): Promise<number> {
    const length = await this.client.rpush(key, ...values);

    if (ttlSeconds !== undefined) {
      await this.client.expire(key, ttlSeconds);
    }

    return length;
  }

  async lpop(key: string, count: number): Promise<string[]> {
    return (await this.client.lpop(key, count)) ?? [];
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
