// identity domain backend exports
export const NAME = 'identity-backend';

export * from './util-auth/src';
export * from './feature-auth/src';

// Lightweight / bundler-friendly entry points (prefer these in apps without DB or auth):
// - @forepath/identity/backend/util-auth/core
// - @forepath/identity/backend/feature-auth
