import type { IncomingMessage, ServerResponse } from 'node:http';

/** Node's default for receiving a whole request (`server.requestTimeout`), kept for every other route. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/**
 * How long a release bundle upload (`POST /api/updates/bundles`) may take to arrive, natively and through a fleet
 * (2026-10-27; the fleet's `FLEET_RELAY_STREAM_TIMEOUT_MS` defaults to the same 2 h). 1 min – 24 h.
 */
export function bundleUploadTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['LOADWEAVER_BUNDLE_UPLOAD_TIMEOUT_MS']);

  return Number.isFinite(raw) && raw >= 60_000 && raw <= 24 * 3_600_000 ? Math.floor(raw) : 2 * 3_600_000;
}

export interface RequestTimeoutRoute {
  method: string;
  path: string;
  ms: number;
}

/**
 * Per-route request receive timeout. Node only knows one server-wide `requestTimeout`, so the server's is switched
 * off (`server.requestTimeout = 0`; the header timeout stays) and this middleware enforces the default for every
 * request — except the listed routes, which get their own limit. A request that hasn't fully arrived in time gets 408
 * and its connection is closed, like Node's own timeout.
 */
export function createRequestTimeoutMiddleware(
  routes: readonly RequestTimeoutRoute[],
  defaultMs = DEFAULT_REQUEST_TIMEOUT_MS,
) {
  return (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse, next: () => void): void => {
    if (req.complete) return next();

    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const method = (req.method ?? '').toUpperCase();
    const ms = routes.find((r) => r.method === method && r.path === path)?.ms ?? defaultMs;
    const timer = setTimeout(() => {
      if (req.complete) return;

      if (!res.headersSent) {
        res.statusCode = 408;
        res.setHeader('connection', 'close');
        res.end();
      }

      req.socket?.destroy();
    }, ms);
    const clear = () => clearTimeout(timer);

    timer.unref?.();
    req.once('end', clear);
    req.once('close', clear);
    next();
  };
}
