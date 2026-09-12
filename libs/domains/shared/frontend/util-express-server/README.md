# shared-frontend-util-express-server

Shared Express helpers for frontend apps: security headers, `GET /config` registration, in-memory static serving, SSR app factory, and the locale delegating server.

## Static caching (origin → CDN/proxy)

Fingerprinted assets and prerendered HTML are served through [`static-memory-cache.ts`](src/lib/static-memory-cache.ts):

| Resource                          | `Cache-Control`                       | Validators                                             |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Non-HTML (JS/CSS/fonts/images, …) | `public, max-age=31536000, immutable` | Strong content `ETag` (`"sha256-…"`) + `Last-Modified` |
| HTML                              | `public, max-age=0, must-revalidate`  | Same validators; conditional requests may return `304` |

Disable the memory path with `STATIC_MEMORY_CACHE=false` (disk/`express.static` fallbacks still apply long-lived headers where configured).

### Cloudflare / reverse-proxy notes

Origin headers alone are not always enough:

1. **Default CDN eligibility is often by URL file extension.** Hashed `.js` / `.css` / fonts are typically eligible. Paths **without** an extension are often marked `DYNAMIC` even with a long `Cache-Control`.
2. **Monaco (consoles):** ESM loads under `/assets/monaco/esm/vs/...` are frequently **extensionless**. Add a Cache Rule matching `http.request.uri.path contains "/assets/monaco/"` → Eligible for cache, honor origin `Cache-Control`.
3. **`GET /config`:** Success responses use a short **public** TTL (`max-age=60, stale-while-revalidate=300`), but `/config` has no extension. Add a Cache Rule for `URI Path equals "/config"` → Eligible for cache, honor origin headers. Errors remain `no-store`.
4. After deploy, verify with response header `cf-cache-status` on a hashed bundle, `/config`, and an extensionless Monaco URL.

## Tests

```bash
nx test shared-frontend-util-express-server
```
