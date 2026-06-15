# shared-frontend-util-runtime-config-server

Shared utilities for Angular SSR **Express** servers that expose `GET /config`: fetch and validate remote JSON from `CONFIG`, plus cache headers for success and error responses.

Used by `agenstra-frontend-agent-console`, `agenstra-frontend-billing-console`, `agenstra-frontend-landingpage`, and `agenstra-frontend-docs` (`src/server.ts`).

## Public API

- **`fetchRuntimeConfigFromEnv`** – Validates URL, allowlist, HTTPS in production, timeouts, size, JSON shape; DNS rebinding guard unless `CONFIG_ALLOW_INTERNAL_HOST=true` (or test/dev self-host exceptions). See `FetchRuntimeConfigEnv` in `runtime-config-proxy.ts`.
- **`applyRuntimeConfigResponseCacheHeaders`** – Sets `Cache-Control` on `/config` responses.
- **`parseAllowedHosts`** – Re-exported from **`@forepath/shared/shared/util-network-address`**; **`assertConfigHostnameResolvesToPublicIps`** – exposed for tests and advanced callers.

Environment variables are documented in **[Environment configuration](../../../../../docs/agenstra/deployment/environment-configuration.md)** (Frontend section).

## Tests

```bash
nx test shared-frontend-util-runtime-config-server
```
