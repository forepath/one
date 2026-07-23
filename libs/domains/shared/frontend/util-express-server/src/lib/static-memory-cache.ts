import { promises as fs } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface CachedStaticFile {
  body: Buffer;
  contentType: string;
  mtimeMs: number;
  absolutePath: string;
}

export interface StaticMemoryCacheStats {
  files: number;
  bytes: number;
  skippedMaps: number;
  roots: string[];
  enabled: boolean;
}

export type StaticMemoryCacheIndex = 'index.html' | false;

export interface MemoryStaticMiddlewareOptions {
  /** Absolute filesystem root to serve from (like express.static root). */
  root: string;
  /** When a directory is requested, try this index file. Default: 'index.html'. */
  index?: StaticMemoryCacheIndex;
  /** Long-cache assets vs revalidate HTML. Default: true (1y for non-HTML). */
  immutableAssets?: boolean;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
};

/** Process-wide absolute-path → buffer cache populated by {@link warmStaticMemoryCache}. */
const staticMemoryCache = new Map<string, CachedStaticFile>();

export function isStaticMemoryCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['STATIC_MEMORY_CACHE']?.trim().toLowerCase();

  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') {
    return false;
  }

  return true;
}

export function clearStaticMemoryCache(): void {
  staticMemoryCache.clear();
}

export function getContentTypeForStaticPath(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function isSourceMapPath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.map';
}

export function getCachedStaticFile(absolutePath: string): CachedStaticFile | null {
  return staticMemoryCache.get(resolve(absolutePath)) ?? null;
}

export function sendCachedStaticFile(res: Response, cached: CachedStaticFile): void {
  const isHtml = extname(cached.absolutePath).toLowerCase() === '.html';

  res.status(200);
  res.setHeader('Content-Type', cached.contentType);
  res.setHeader('Content-Length', cached.body.byteLength);
  res.setHeader('Cache-Control', isHtml ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000');
  res.end(cached.body);
}

/**
 * Sends a Node `http.ServerResponse` from a cached file (delegating server).
 */
export function writeCachedStaticFileToNodeResponse(
  res: { writeHead: (code: number, headers: Record<string, string | number>) => void; end: (body?: Buffer) => void },
  cached: CachedStaticFile,
): void {
  const isHtml = extname(cached.absolutePath).toLowerCase() === '.html';

  res.writeHead(200, {
    'Content-Type': cached.contentType,
    'Content-Length': cached.body.byteLength,
    'Cache-Control': isHtml ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000',
  });
  res.end(cached.body);
}

async function walkAndWarm(dir: string, stats: { files: number; bytes: number; skippedMaps: number }): Promise<void> {
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`Static memory cache: unable to read directory ${dir}: ${message}`);

    return;
  }

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkAndWarm(absolutePath, stats);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (isSourceMapPath(absolutePath)) {
      stats.skippedMaps += 1;
      continue;
    }

    try {
      const [body, fileStat] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)]);
      const resolved = resolve(absolutePath);

      staticMemoryCache.set(resolved, {
        body,
        contentType: getContentTypeForStaticPath(resolved),
        mtimeMs: fileStat.mtimeMs,
        absolutePath: resolved,
      });
      stats.files += 1;
      stats.bytes += body.byteLength;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.warn(`Static memory cache: failed to load ${absolutePath}: ${message}`);
    }
  }
}

/**
 * Loads all non-`.map` files under the given roots into the process memory cache.
 * Safe to call multiple times; entries are overwritten for the same absolute path.
 */
export async function warmStaticMemoryCache(
  roots: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Console, 'log' | 'warn'> = console,
): Promise<StaticMemoryCacheStats> {
  const enabled = isStaticMemoryCacheEnabled(env);
  const uniqueRoots = [...new Set(roots.map((root) => resolve(root)))];

  if (!enabled) {
    logger.log('Static memory cache disabled (STATIC_MEMORY_CACHE=false)');

    return { files: 0, bytes: 0, skippedMaps: 0, roots: uniqueRoots, enabled: false };
  }

  const stats = { files: 0, bytes: 0, skippedMaps: 0 };

  for (const root of uniqueRoots) {
    try {
      const rootStat = await fs.stat(root);

      if (!rootStat.isDirectory()) {
        logger.warn(`Static memory cache: root is not a directory: ${root}`);
        continue;
      }
    } catch {
      logger.warn(`Static memory cache: root not found: ${root}`);
      continue;
    }

    await walkAndWarm(root, stats);
  }

  const megabytes = (stats.bytes / (1024 * 1024)).toFixed(2);

  logger.log(
    `Static memory cache warmed: ${stats.files} files, ${megabytes} MiB` +
      (stats.skippedMaps > 0 ? ` (skipped ${stats.skippedMaps} .map files)` : ''),
  );

  return {
    files: stats.files,
    bytes: stats.bytes,
    skippedMaps: stats.skippedMaps,
    roots: uniqueRoots,
    enabled: true,
  };
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Resolves a request pathname against a static root using cache and/or index rules.
 * Returns null when the path should fall through (`next()`).
 * Returns `'forbidden-map'` when the client requested a source map.
 */
export function resolveStaticPathAgainstRoot(
  root: string,
  requestPath: string,
  index: StaticMemoryCacheIndex = 'index.html',
): string | null | 'forbidden-map' {
  const decoded = decodePathname(requestPath);
  const relativeUrlPath = decoded.replace(/^\/+/, '');

  if (relativeUrlPath.split(/[/\\]/).includes('..')) {
    return null;
  }

  const candidate = resolve(root, relativeUrlPath || '.');
  const rootResolved = resolve(root);
  const relativeToRoot = relative(rootResolved, candidate);

  /* istanbul ignore next -- defensive: resolve()+leading-slash strip normally keeps candidates under root */
  if (relativeToRoot.startsWith('..') || relativeToRoot.includes(`..${sep}`)) {
    return null;
  }

  if (isSourceMapPath(candidate)) {
    return 'forbidden-map';
  }

  const normalizedRelative = relativeToRoot === '' ? '' : relativeToRoot.split(sep).join('/');

  // Prefer exact file in cache
  const exact = getCachedStaticFile(candidate);

  if (exact) {
    return exact.absolutePath;
  }

  // Directory → index.html (cache or path)
  if (index) {
    const indexCandidate = normalizedRelative === '' ? join(rootResolved, index) : join(candidate, index);
    const indexed = getCachedStaticFile(indexCandidate);

    if (indexed) {
      return indexed.absolutePath;
    }
  }

  return null;
}

/**
 * Express middleware that serves files from the start-time memory cache.
 * Source maps always 404. Cache misses call `next()` for SSR/disk fallbacks.
 */
export function createMemoryStaticMiddleware(options: MemoryStaticMiddlewareOptions): RequestHandler {
  const root = resolve(options.root);
  const index: StaticMemoryCacheIndex = options.index === false ? false : (options.index ?? 'index.html');

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    if (!isStaticMemoryCacheEnabled()) {
      if (req.path.toLowerCase().endsWith('.map')) {
        return res.status(404).end();
      }

      return next();
    }

    const resolved = resolveStaticPathAgainstRoot(root, req.path, index);

    if (resolved === 'forbidden-map') {
      return res.status(404).end();
    }

    if (!resolved) {
      return next();
    }

    const cached = getCachedStaticFile(resolved);

    /* istanbul ignore next -- resolve only returns paths already present in the cache */
    if (!cached) {
      return next();
    }

    if (req.method === 'HEAD') {
      const isHtml = extname(cached.absolutePath).toLowerCase() === '.html';

      res.status(200);
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Content-Length', cached.body.byteLength);
      res.setHeader('Cache-Control', isHtml ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000');

      return res.end();
    }

    sendCachedStaticFile(res, cached);
  };
}

/** @internal test helper */
export function __getStaticMemoryCacheSizeForTests(): number {
  return staticMemoryCache.size;
}
