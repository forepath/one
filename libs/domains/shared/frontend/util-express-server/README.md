# shared-frontend-util-express-server

Shared Express helpers for frontend apps: security headers, `GET /config` registration, in-memory static serving, SSR app factory, and the locale delegating server.

## Static caching (origin → CDN/proxy)

Fingerprinted assets and prerendered HTML are served through [`static-memory-cache.ts`](src/lib/static-memory-cache.ts).

| Resource                                                            | `Cache-Control`                       | Why                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| HTML                                                                | `public, max-age=0, must-revalidate`  | Deploy updates `index.html` script URLs; proxies must revalidate. New body → new ETag → `200` instead of `304`.           |
| Non-fingerprinted assets (e.g. Monaco, `favicon.ico`, `app.js`)     | `public, max-age=0, must-revalidate`  | Same URL across deploys; content-hash ETag lets proxies learn changes via conditional GET without year-long stale copies. |
| Fingerprinted assets (`main-ABCDEFGH.js`, `styles-5INURABD.css`, …) | `public, max-age=31536000, immutable` | URL changes when bytes change (`outputHashing: all`), so edge entries are naturally busted.                               |

All of the above also send strong content `ETag` (`"sha256-…"`) and `Last-Modified`. Matching `If-None-Match` / fresh `If-Modified-Since` yields **`304`** with no body.

Disable the memory path with `STATIC_MEMORY_CACHE=false` (disk/`express.static` fallbacks still apply the same `Cache-Control` policy via `getStaticCacheControlHeader`).

### Deploy / update process

1. New build emits new hashed bundle filenames referenced from HTML.
2. HTML (and stable-URL assets) always revalidate → origin returns new ETag when content changed.
3. Proxies that honor validators refresh without a manual purge for those paths.
4. Old hashed URLs simply stop being requested; their long-lived cache entries age out unused.

### Cloudflare / reverse-proxy notes

Origin headers alone are not always enough for edge eligibility:

1. **Default CDN eligibility is often by URL file extension.** Hashed `.js` / `.css` / fonts are typically eligible. Paths **without** an extension are often marked `DYNAMIC` even with correct `Cache-Control`.
2. **Monaco (consoles):** ESM loads under `/assets/monaco/esm/vs/...` are frequently **extensionless**. A Cache Rule can make them eligible; they intentionally use **revalidate** (not `immutable`) so security/Monaco upgrades are visible after deploy.
3. **`GET /config`:** Success uses a short **public** TTL (`max-age=60, stale-while-revalidate=300`), but `/config` has no extension. Add a Cache Rule for `URI Path equals "/config"` → Eligible for cache, honor origin headers. Errors remain `no-store`.
4. After deploy, verify with `cf-cache-status` on a hashed bundle, HTML/`index`, `/config`, and an extensionless Monaco URL.

## Tests

```bash
nx test shared-frontend-util-express-server
```
