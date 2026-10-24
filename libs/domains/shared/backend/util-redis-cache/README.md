# util-redis-cache

Shared NestJS JSON cache helper used for low-churn read-mostly API responses. It talks the Redis protocol (via `ioredis`), so it works against Valkey (the default in all bundled stacks) or Redis; the `Redis*` names are kept for API stability.

## Usage

Import `RedisCacheModule` and inject `RedisCacheService`:

```typescript
@Module({ imports: [RedisCacheModule] })
export class FeatureModule {}
```

```typescript
constructor(private readonly redisCache: RedisCacheService) {}

await this.redisCache.setJson('my:key', payload, 3600);
const cached = await this.redisCache.getJson<MyType>('my:key');
```

Connection settings reuse `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_PASSWORD`, `VALKEY_DB`, and `VALKEY_KEY_PREFIX` (same as BullMQ). Each also accepts its legacy `REDIS_*` name; when both are set, the family matching `CACHE_CLIENT` wins (`glide`: `VALKEY_*`, `ioredis`: `REDIS_*`).

## Client selection

Direct key/value access goes through the `KeyValueClient` port (`createKeyValueClient`), which covers exactly the
commands in use (`GET`, `GETDEL`, `SET [EX]`, `MGET`, `SCAN`, `PING`). `CACHE_CLIENT` picks the adapter:

- `glide` (default): [Valkey GLIDE](https://github.com/valkey-io/valkey-glide), the Valkey project's official client.
  The native module is loaded lazily on first connect.
- `ioredis`: the classic Node.js client, kept as a fallback.

`RedisCacheService` and the updates store (`feature-updates`) use this port. BullMQ follows the same setting through
`createBullMqConnection` in util-queue: with `glide` it receives one shared GLIDE client wrapped by BullMQ's
`createValkeyGlideClient` (BullMQ ≥ 5.81), with `ioredis` plain ioredis connection options.

## Configuration

| Variable                               | Default       | Description                                                           |
| -------------------------------------- | ------------- | --------------------------------------------------------------------- |
| `VALKEY_CACHE_ENABLED`                 | `true`        | Set to `false` to bypass Valkey and always load live data             |
| `CACHE_CLIENT`                         | `glide`       | Client library: `glide` (Valkey GLIDE, native Rust core) or `ioredis` |
| `PROVIDER_LOCATIONS_CACHE_TTL_SECONDS` | `86400` (24h) | TTL for provider location catalog cache entries                       |

Cache failures are logged and treated as misses so endpoints keep working when Valkey is unavailable.
