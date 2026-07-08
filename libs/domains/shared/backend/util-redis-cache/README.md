# util-redis-cache

Shared NestJS Redis JSON cache helper used for low-churn read-mostly API responses.

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

Connection settings reuse `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`, and `REDIS_KEY_PREFIX` (same as BullMQ).

## Configuration

| Variable                               | Default       | Description                                              |
| -------------------------------------- | ------------- | -------------------------------------------------------- |
| `REDIS_CACHE_ENABLED`                  | `true`        | Set to `false` to bypass Redis and always load live data |
| `PROVIDER_LOCATIONS_CACHE_TTL_SECONDS` | `86400` (24h) | TTL for provider location catalog cache entries          |

Cache failures are logged and treated as misses so endpoints keep working when Redis is unavailable.
