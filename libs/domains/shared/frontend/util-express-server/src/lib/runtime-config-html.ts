import { readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import type { Response } from 'express';

import {
  type FetchRuntimeConfigEnv,
  fetchRuntimeConfigFromEnv,
} from '@forepath/shared/frontend/util-runtime-config-server';

import {
  type CachedStaticFile,
  createCachedStaticFile,
  getCachedStaticFile,
  isHtmlStaticPath,
  sendCachedStaticFile,
  type StaticCacheRequestHeaders,
  writeCachedStaticFileToNodeResponse,
} from './static-memory-cache';

/** Must match the client reader in `@forepath/shared/frontend/util-configuration`. */
export const RUNTIME_CONFIG_ELEMENT_ID = 'runtime-config';

export type RuntimeConfigHtmlLogger = Pick<Console, 'error' | 'warn'>;

/**
 * Escapes JSON for safe embedding in a non-executable `<script type="application/json">` tag.
 * Prevents `</script>` breakout via `<` in string values.
 */
export function escapeJsonForHtmlScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

/**
 * Injects runtime config JSON into HTML before `</head>` (or `</body>` / end of document).
 * No-ops when the shared element id is already present.
 */
export function injectRuntimeConfigIntoHtml(html: string, configValue: unknown): string {
  if (html.includes(`id="${RUNTIME_CONFIG_ELEMENT_ID}"`)) {
    return html;
  }

  const json = escapeJsonForHtmlScript(JSON.stringify(configValue ?? {}));
  const tag = `<script type="application/json" id="${RUNTIME_CONFIG_ELEMENT_ID}">${json}</script>`;

  const headClose = html.match(/<\/head>/i);

  if (headClose && headClose.index !== undefined) {
    return `${html.slice(0, headClose.index)}${tag}\n${html.slice(headClose.index)}`;
  }

  const bodyClose = html.match(/<\/body>/i);

  if (bodyClose && bodyClose.index !== undefined) {
    return `${html.slice(0, bodyClose.index)}${tag}\n${html.slice(bodyClose.index)}`;
  }

  return `${html}\n${tag}\n`;
}

/**
 * Builds a content-hashed cached HTML file with warm CONFIG inlined.
 */
export async function buildHtmlCachedFileWithRuntimeConfig(
  absolutePath: string,
  baseHtml: string | Buffer,
  mtimeMs: number,
  env: FetchRuntimeConfigEnv = process.env as unknown as FetchRuntimeConfigEnv,
  logger: RuntimeConfigHtmlLogger = console,
): Promise<CachedStaticFile> {
  const configJson = await resolveRuntimeConfigJsonForHtml(env, logger);
  const injectedHtml = injectRuntimeConfigIntoHtml(
    typeof baseHtml === 'string' ? baseHtml : baseHtml.toString('utf8'),
    configJson,
  );

  return createCachedStaticFile(absolutePath, Buffer.from(injectedHtml, 'utf8'), mtimeMs);
}

/**
 * Memory-static transform: inline CONFIG into HTML responses; pass other files through.
 */
export async function transformCachedFileWithRuntimeConfig(
  cached: CachedStaticFile,
  env: FetchRuntimeConfigEnv = process.env as unknown as FetchRuntimeConfigEnv,
  logger: RuntimeConfigHtmlLogger = console,
): Promise<CachedStaticFile> {
  if (!isHtmlStaticPath(cached.absolutePath)) {
    return cached;
  }

  return buildHtmlCachedFileWithRuntimeConfig(cached.absolutePath, cached.body, cached.mtimeMs, env, logger);
}

/**
 * Resolves JSON to embed in HTML. Never throws: errors and missing CONFIG become `{}`
 * so SPA shells still load.
 */
export async function resolveRuntimeConfigJsonForHtml(
  env: FetchRuntimeConfigEnv = process.env as unknown as FetchRuntimeConfigEnv,
  logger: RuntimeConfigHtmlLogger = console,
): Promise<Record<string, unknown>> {
  try {
    const result = await fetchRuntimeConfigFromEnv(env);

    if (result.kind === 'ok') {
      return result.value;
    }

    if (result.kind === 'error') {
      logger.error(result.log);
    }

    return {};
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error(`Failed to resolve runtime config for HTML inject: ${message}`);

    return {};
  }
}

/**
 * Warms the in-process CONFIG success cache at process start (best-effort).
 */
export async function warmRuntimeConfigCache(
  env: FetchRuntimeConfigEnv = process.env as unknown as FetchRuntimeConfigEnv,
  logger: RuntimeConfigHtmlLogger = console,
): Promise<void> {
  await resolveRuntimeConfigJsonForHtml(env, logger);
}

function loadIndexHtmlBytes(absolutePath: string): { body: Buffer; mtimeMs: number } {
  const cached = getCachedStaticFile(absolutePath);

  if (cached) {
    return { body: cached.body, mtimeMs: cached.mtimeMs };
  }

  const resolved = resolve(absolutePath);
  const body = readFileSync(resolved);
  const stat = statSync(resolved);

  return { body, mtimeMs: stat.mtimeMs };
}

/**
 * Serves SPA `index.html` with warm runtime config inlined and HTML cache validators.
 */
export async function sendIndexHtmlWithRuntimeConfig(
  res: Response,
  indexHtmlPath: string,
  req?: StaticCacheRequestHeaders,
  env: FetchRuntimeConfigEnv = process.env as unknown as FetchRuntimeConfigEnv,
  logger: RuntimeConfigHtmlLogger = console,
): Promise<void> {
  const { body: baseBody, mtimeMs } = loadIndexHtmlBytes(indexHtmlPath);
  const injected = await buildHtmlCachedFileWithRuntimeConfig(indexHtmlPath, baseBody, mtimeMs, env, logger);

  sendCachedStaticFile(res, injected, req);
}

/**
 * Serves an HTML string (e.g. CommonEngine SSR output) with warm CONFIG inlined.
 */
export async function sendHtmlStringWithRuntimeConfig(
  res: Response,
  absolutePathForCacheKey: string,
  html: string,
  mtimeMs: number = Date.now(),
  req?: StaticCacheRequestHeaders,
  env: FetchRuntimeConfigEnv = process.env as unknown as FetchRuntimeConfigEnv,
  logger: RuntimeConfigHtmlLogger = console,
): Promise<void> {
  const injected = await buildHtmlCachedFileWithRuntimeConfig(absolutePathForCacheKey, html, mtimeMs, env, logger);

  sendCachedStaticFile(res, injected, req);
}

/**
 * Node `http.ServerResponse` variant used by the locale delegating front.
 */
export async function writeHtmlFileWithRuntimeConfigToNodeResponse(
  res: ServerResponse,
  htmlFilePath: string,
  req?: IncomingMessage,
  env: FetchRuntimeConfigEnv = process.env as unknown as FetchRuntimeConfigEnv,
  logger: RuntimeConfigHtmlLogger = console,
): Promise<void> {
  const { body: baseBody, mtimeMs } = loadIndexHtmlBytes(htmlFilePath);
  const injected = await buildHtmlCachedFileWithRuntimeConfig(htmlFilePath, baseBody, mtimeMs, env, logger);

  writeCachedStaticFileToNodeResponse(res, injected, req);
}
