import { readKeyValueClientDriver, type KeyValueClientDriver } from '@forepath/shared/backend/util-redis-cache';
import { createValkeyGlideClient, type ConnectionOptions } from 'bullmq';

import { toBullMqConnection, type RedisConnectionConfig } from './queue-connection.config';

/** Per-request timeout for the queue GLIDE client; leaves headroom for BullMQ Lua scripts on large queues. */
const QUEUE_GLIDE_REQUEST_TIMEOUT_MS = 5000;

type GlideModule = typeof import('@valkey/valkey-glide');

export interface BullMqConnectionHandle {
  readonly driver: KeyValueClientDriver;
  /** Pass to BullMQ / `@nestjs/bullmq` as `connection`. */
  readonly connection: ConnectionOptions;
  /** Closes the shared GLIDE client (BullMQ never closes injected clients); no-op for ioredis options. */
  close(): Promise<void>;
}

/**
 * BullMQ connection for the client selected by `CACHE_CLIENT` (default `glide`).
 * - `ioredis`: plain options; BullMQ opens and closes its own ioredis connections per queue/worker.
 * - `glide`: one shared Valkey GLIDE client wrapped via `createValkeyGlideClient` (BullMQ ≥ 5.81). Workers
 *   duplicate it for blocking commands. `lazyConnect` makes creation network-free, so an unreachable Valkey at
 *   boot does not poison the client; GLIDE connects and reconnects on demand.
 */
export function createBullMqConnection(
  config: RedisConnectionConfig,
  env: NodeJS.ProcessEnv = process.env,
): BullMqConnectionHandle {
  if (readKeyValueClientDriver(env) === 'ioredis') {
    return { driver: 'ioredis', connection: toBullMqConnection(config), close: async () => undefined };
  }

  // Loaded lazily so ioredis deployments never load the native GLIDE binding.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const glide = require('@valkey/valkey-glide') as GlideModule;
  const client = createValkeyGlideClient(
    glide.GlideClient.createClient({
      addresses: [{ host: config.host, port: config.port }],
      databaseId: config.db,
      ...(config.password ? { credentials: { password: config.password } } : {}),
      requestTimeout: QUEUE_GLIDE_REQUEST_TIMEOUT_MS,
      lazyConnect: true,
    }),
  );

  return {
    driver: 'glide',
    connection: client,
    close: async () => {
      await client.quit();
    },
  };
}
