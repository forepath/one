import { Logger } from '@nestjs/common';

import { GlideKeyValueClient } from './glide-key-value-client';
import { IoRedisKeyValueClient } from './ioredis-key-value-client';
import {
  DEFAULT_KEY_VALUE_CLIENT_DRIVER,
  readKeyValueClientDriver,
  type KeyValueClient,
  type KeyValueClientOptions,
} from './key-value-client';

const logger = new Logger('KeyValueClient');

/** Builds the key/value client selected by `CACHE_CLIENT` (default `glide`, the Valkey project's client). */
export function createKeyValueClient(
  options: KeyValueClientOptions,
  env: NodeJS.ProcessEnv = process.env,
): KeyValueClient {
  let driver = readKeyValueClientDriver(env);

  if (driver === null) {
    driver = DEFAULT_KEY_VALUE_CLIENT_DRIVER;
    logger.warn(`Unknown CACHE_CLIENT "${env['CACHE_CLIENT']}"; falling back to ${driver} (supported: glide, ioredis)`);
  }

  return driver === 'ioredis' ? new IoRedisKeyValueClient(options) : new GlideKeyValueClient(options);
}
