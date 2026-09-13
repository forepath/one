import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface CachedStaticFile {
  body: Buffer;
  contentType: string;
  mtimeMs: number;
  absolutePath: string;
  /** Strong content-based ETag, including surrounding quotes (e.g. `"sha256-…"`). */
  etag: string;
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
  /**
   * When true (default), fingerprinted non-HTML assets get `immutable`.
   * Stable URLs (Monaco, favicons, …) never get `immutable` so deploys revalidate.
   */
  immutableAssets?: boolean;
}

export interface StaticCacheHeaderOptions {
  /**
   * When true (default), fingerprinted non-HTML responses include `immutable`.
   * Non-fingerprinted assets always revalidate regardless of this flag.
   */
  immutableAssets?: boolean;
}

/** Minimal request surface for conditional GET / HEAD. */
export type StaticCacheRequestHeaders = {
  headers?: {
    'if-none-match'?: string | string[];
    'if-modified-since'?: string | string[];
  };
};

export type StaticCacheHeaderMap = Record<string, string | number>;

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

const ONE_YEAR_SECONDS = 31536000;

/**
 * Detect Angular/webpack content hashes in filenames so long-lived `immutable`
 * caching is only applied when a deploy changes the URL (safe cache bust).
 * Examples: `main-ABCDEFGH.js`, `styles-5INURABD.css`, `logo.a1b2c3d4.png`.
 */
const FINGERPRINT_DASH_HASH = /-[A-Za-z0-9]{8,}\.[^.]+$/;
const FINGERPRINT_DOT_HASH = /\.[a-f0-9]{8,}\.[^.]+$/i;

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

export function isHtmlStaticPath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.html';
}

export function isFingerprintedAssetPath(filePath: string): boolean {
  const name = basename(filePath);

  return FINGERPRINT_DASH_HASH.test(name) || FINGERPRINT_DOT_HASH.test(name);
}

/**
 * Strong ETag from file bytes so validators stay stable across pods/replicas
 * (unlike inode/mtime weak ETags from express.static defaults).
 */
export function computeStrongContentEtag(body: Buffer): string {
  const digest = createHash('sha256').update(body).digest('base64url');

  return `"sha256-${digest}"`;
}

export function formatHttpDate(mtimeMs: number): string {
  return new Date(mtimeMs).toUTCString();
}

/**
 * Cache-Control policy for CDN/proxy + browser:
 * - HTML / non-fingerprinted assets: always revalidate (ETag/Last-Modified → cheap 304).
 *   Same URL after a deploy gets a new ETag so proxies learn content changed.
 * - Fingerprinted assets: long-lived + optional `immutable` (URL changes on rebuild).
 */
export function getStaticCacheControlHeader(absolutePath: string, options: StaticCacheHeaderOptions = {}): string {
  if (isHtmlStaticPath(absolutePath) || !isFingerprintedAssetPath(absolutePath)) {
    return 'public, max-age=0, must-revalidate';
  }

  const immutable = options.immutableAssets !== false;

  return immutable ? `public, max-age=${ONE_YEAR_SECONDS}, immutable` : `public, max-age=${ONE_YEAR_SECONDS}`;
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }

  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Returns true when the client already has a fresh representation
 * (`If-None-Match` / `If-Modified-Since`).
 */
export function isNotModified(req: StaticCacheRequestHeaders, etag: string, mtimeMs: number): boolean {
  const ifNoneMatch = headerValue(req.headers?.['if-none-match']);

  if (ifNoneMatch) {
    if (ifNoneMatch.trim() === '*') {
      return true;
    }

    const candidates = ifNoneMatch.split(',').map((value) => value.trim());

    return candidates.some((candidate) => {
      const normalized = candidate.startsWith('W/') ? candidate.slice(2).trim() : candidate;

      return normalized === etag;
    });
  }

  const ifModifiedSince = headerValue(req.headers?.['if-modified-since']);

  if (!ifModifiedSince) {
    return false;
  }

  const sinceMs = Date.parse(ifModifiedSince);

  if (Number.isNaN(sinceMs)) {
    return false;
  }

  // HTTP dates have 1s resolution; truncate mtime the same way.
  return Math.floor(mtimeMs / 1000) <= Math.floor(sinceMs / 1000);
}

export function buildStaticCacheHeaders(
  cached: Pick<CachedStaticFile, 'absolutePath' | 'contentType' | 'body' | 'etag' | 'mtimeMs'>,
  options: StaticCacheHeaderOptions = {},
): StaticCacheHeaderMap {
  return {
    'Content-Type': cached.contentType,
    'Content-Length': cached.body.byteLength,
    'Cache-Control': getStaticCacheControlHeader(cached.absolutePath, options),
    ETag: cached.etag,
    'Last-Modified': formatHttpDate(cached.mtimeMs),
  };
}

export function buildStaticCacheHeadersFor304(
  cached: Pick<CachedStaticFile, 'absolutePath' | 'etag' | 'mtimeMs'>,
  options: StaticCacheHeaderOptions = {},
): StaticCacheHeaderMap {
  return {
    'Cache-Control': getStaticCacheControlHeader(cached.absolutePath, options),
    ETag: cached.etag,
    'Last-Modified': formatHttpDate(cached.mtimeMs),
  };
}

export function getCachedStaticFile(absolutePath: string): CachedStaticFile | null {
  return staticMemoryCache.get(resolve(absolutePath)) ?? null;
}

export function createCachedStaticFile(absolutePath: string, body: Buffer, mtimeMs: number): CachedStaticFile {
  const resolved = resolve(absolutePath);

  return {
    body,
    contentType: getContentTypeForStaticPath(resolved),
    mtimeMs,
    absolutePath: resolved,
    etag: computeStrongContentEtag(body),
  };
}

export function sendCachedStaticFile(
  res: Response,
  cached: CachedStaticFile,
  req?: StaticCacheRequestHeaders,
  options: StaticCacheHeaderOptions = {},
): void {
  if (req && isNotModified(req, cached.etag, cached.mtimeMs)) {
    res.status(304);
    const headers = buildStaticCacheHeadersFor304(cached, options);

    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }

    res.end();

    return;
  }

  res.status(200);
  const headers = buildStaticCacheHeaders(cached, options);

  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }

  res.end(cached.body);
}

/**
 * Sends a Node `http.ServerResponse` from a cached file (delegating server).
 */
export function writeCachedStaticFileToNodeResponse(
  res: { writeHead: (code: number, headers: StaticCacheHeaderMap) => void; end: (body?: Buffer) => void },
  cached: CachedStaticFile,
  req?: StaticCacheRequestHeaders,
  options: StaticCacheHeaderOptions = {},
): void {
  if (req && isNotModified(req, cached.etag, cached.mtimeMs)) {
    res.writeHead(304, buildStaticCacheHeadersFor304(cached, options));
    res.end();

    return;
  }

  res.writeHead(200, buildStaticCacheHeaders(cached, options));
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
      const cached = createCachedStaticFile(resolved, body, fileStat.mtimeMs);

      staticMemoryCache.set(resolved, cached);
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
  const headerOptions: StaticCacheHeaderOptions = {
    immutableAssets: options.immutableAssets,
  };

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
      if (isNotModified(req, cached.etag, cached.mtimeMs)) {
        res.status(304);
        const headers = buildStaticCacheHeadersFor304(cached, headerOptions);

        for (const [name, value] of Object.entries(headers)) {
          res.setHeader(name, value);
        }

        return res.end();
      }

      res.status(200);
      const headers = buildStaticCacheHeaders(cached, headerOptions);

      for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value);
      }

      return res.end();
    }

    sendCachedStaticFile(res, cached, req, headerOptions);
  };
}

/** @internal test helper */
export function __getStaticMemoryCacheSizeForTests(): number {
  return staticMemoryCache.size;
}
