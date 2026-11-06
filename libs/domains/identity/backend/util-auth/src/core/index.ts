/**
 * Lightweight util-auth surface for apps without database or IdP runtime.
 * Import from `@forepath/identity/backend/util-auth/core` instead of the full util-auth barrel
 * to avoid pulling TypeORM entities, migrations, and IdP (OIDC) modules into the bundle.
 */
export * from '../lib/bull-board-request-path';
export * from '../lib/otel-metrics-request-path';
export * from '../lib/bull-board-throttler.guard';
export * from '../lib/decorators/public.decorator';
export * from '../lib/http-request-path.util';
export * from '../lib/origin-allowlist.middleware';
export * from '../lib/rate-limit.config';
