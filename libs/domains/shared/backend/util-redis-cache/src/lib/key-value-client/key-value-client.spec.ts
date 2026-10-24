import { createKeyValueClient } from './create-key-value-client';
import { GlideKeyValueClient } from './glide-key-value-client';
import { IoRedisKeyValueClient } from './ioredis-key-value-client';
import { readKeyValueClientDriver } from './key-value-client';

const options = { config: { host: 'localhost', port: 6379, db: 0, keyPrefix: 'test' } };

describe('readKeyValueClientDriver', () => {
  it('defaults to glide', () => {
    expect(readKeyValueClientDriver({})).toBe('glide');
    expect(readKeyValueClientDriver({ CACHE_CLIENT: '  ' })).toBe('glide');
  });

  it('accepts supported drivers case-insensitively', () => {
    expect(readKeyValueClientDriver({ CACHE_CLIENT: 'ioredis' })).toBe('ioredis');
    expect(readKeyValueClientDriver({ CACHE_CLIENT: ' GLIDE ' })).toBe('glide');
  });

  it('returns null for unknown drivers', () => {
    expect(readKeyValueClientDriver({ CACHE_CLIENT: 'node-redis' })).toBeNull();
  });
});

describe('createKeyValueClient', () => {
  it('creates a GLIDE client by default', () => {
    expect(createKeyValueClient(options, {})).toBeInstanceOf(GlideKeyValueClient);
  });

  it('creates an ioredis client when selected', () => {
    expect(createKeyValueClient(options, { CACHE_CLIENT: 'ioredis' })).toBeInstanceOf(IoRedisKeyValueClient);
  });

  it('falls back to GLIDE for unknown drivers', () => {
    expect(createKeyValueClient(options, { CACHE_CLIENT: 'unknown' })).toBeInstanceOf(GlideKeyValueClient);
  });
});
