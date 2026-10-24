import type { GlideClient, GlideString } from '@valkey/valkey-glide';

import type { KeyValueClient, KeyValueClientOptions } from './key-value-client';

/** Upper bound per command once connected; keeps fail-open callers responsive. */
const GLIDE_REQUEST_TIMEOUT_MS = 2000;

type GlideModule = typeof import('@valkey/valkey-glide');

/**
 * Valkey GLIDE adapter (default driver). The native GLIDE module is loaded on {@link connect} only, so
 * processes running the ioredis driver never load the Rust binding.
 * GLIDE reconnects automatically; commands issued while disconnected fail with a timeout/connection error.
 */
export class GlideKeyValueClient implements KeyValueClient {
  readonly driver = 'glide' as const;
  private client: GlideClient | null = null;
  private glide: GlideModule | null = null;

  constructor(private readonly options: KeyValueClientOptions) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const glide = await import('@valkey/valkey-glide');
    const { config, clientName } = this.options;

    this.client = await glide.GlideClient.createClient({
      addresses: [{ host: config.host, port: config.port }],
      databaseId: config.db,
      ...(config.password ? { credentials: { password: config.password } } : {}),
      ...(clientName ? { clientName } : {}),
      defaultDecoder: glide.Decoder.String,
      requestTimeout: GLIDE_REQUEST_TIMEOUT_MS,
    });
    this.glide = glide;
  }

  async ping(): Promise<boolean> {
    return (await this.requireClient().ping()) === 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return asString(await this.requireClient().get(key));
  }

  async getDel(key: string): Promise<string | null> {
    return asString(await this.requireClient().getdel(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = this.requireClient();

    if (ttlSeconds === undefined) {
      await client.set(key, value);
    } else {
      await client.set(key, value, { expiry: { type: this.requireGlide().TimeUnit.Seconds, count: ttlSeconds } });
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return (await this.requireClient().mget(keys)).map(asString);
  }

  async scan(cursor: string, match: string, count: number): Promise<[string, string[]]> {
    const [nextCursor, keys] = await this.requireClient().scan(cursor, { match, count });

    return [String(nextCursor), keys.map((key) => String(key))];
  }

  async close(): Promise<void> {
    this.client?.close();
    this.client = null;
  }

  private requireClient(): GlideClient {
    if (!this.client) {
      throw new Error('Valkey GLIDE client is not connected');
    }

    return this.client;
  }

  private requireGlide(): GlideModule {
    if (!this.glide) {
      throw new Error('Valkey GLIDE client is not connected');
    }

    return this.glide;
  }
}

/** Results are decoded as strings via `defaultDecoder`; binary values are only a type-level possibility. */
function asString(value: GlideString | null): string | null {
  return value === null ? null : String(value);
}
