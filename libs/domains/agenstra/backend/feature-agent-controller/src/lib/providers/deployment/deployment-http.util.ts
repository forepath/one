import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

/** Default timeout of every CI/CD provider request. */
export const DEPLOYMENT_HTTP_TIMEOUT_MS = 30_000;

/** Maximum length of provider messages surfaced to callers (errors, connection test results). */
export const DEPLOYMENT_PROVIDER_MESSAGE_MAX_LENGTH = 300;

export interface DeploymentHttpContext {
  /** Human readable provider name used in messages (`GitHub`, `GitLab`, `Jenkins`). */
  providerLabel: string;
  /** What was attempted (`list repositories`, `trigger run`, ...). */
  action: string;
  /** Secret values that must never appear in thrown messages. */
  secrets?: Array<string | null | undefined>;
  timeoutMs?: number;
}

export type DeploymentRequestInit = Omit<RequestInit, 'signal'> & { timeoutMs?: number };

/**
 * Validates and normalizes an admin supplied provider base URL: absolute `http(s)` URL, no credentials, query or
 * fragment, trailing slashes stripped.
 */
export function normalizeDeploymentBaseUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();

  if (!trimmed) {
    throw new BadRequestException('Base URL must not be empty');
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('Base URL must be an absolute http(s) URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('Base URL must be an absolute http(s) URL');
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException('Base URL must not contain credentials');
  }

  if (parsed.search || trimmed.includes('?')) {
    throw new BadRequestException('Base URL must not contain a query string');
  }

  if (parsed.hash || trimmed.includes('#')) {
    throw new BadRequestException('Base URL must not contain a fragment');
  }

  const path = parsed.pathname.replace(/\/+$/, '');

  return `${parsed.protocol}//${parsed.host}${path}`;
}

/**
 * URL-encodes one caller supplied path segment. Rejects empty, dot and control-character segments so encoded values
 * can never traverse the provider API path.
 */
export function encodeDeploymentPathSegment(value: string, label = 'Path segment'): string {
  const v = typeof value === 'string' ? value.trim() : '';

  // eslint-disable-next-line no-control-regex
  if (!v || v === '.' || v === '..' || /[\u0000-\u001f\u007f]/.test(v)) {
    throw new BadRequestException(`${label} is invalid`);
  }

  return encodeURIComponent(v);
}

export function buildDeploymentBasicAuthHeader(username: string, secret: string): string {
  return `Basic ${Buffer.from(`${username}:${secret}`, 'utf8').toString('base64')}`;
}

/**
 * Removes secrets and credential-like values from a provider message, collapses whitespace and caps the length.
 */
export function sanitizeDeploymentProviderMessage(
  message: string | null | undefined,
  secrets: Array<string | null | undefined> = [],
  maxLength = DEPLOYMENT_PROVIDER_MESSAGE_MAX_LENGTH,
): string {
  let out = String(message ?? '');

  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join('[redacted]');
    }
  }

  out = out
    .replace(/-----BEGIN [^-]+-----[\s\S]*?(-----END [^-]+-----|$)/g, '[redacted]')
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,})\b/g, '[redacted]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/\s+/g, ' ')
    .trim();

  if (out.length > maxLength) {
    out = `${out.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  return out;
}

/** Extracts a human readable message from a provider error body (JSON `message` / `error` / `errors`, or text). */
export function extractDeploymentProviderErrorMessage(body: string): string {
  const text = (body ?? '').trim();

  if (!text) {
    return '';
  }

  try {
    const json = JSON.parse(text) as unknown;

    if (json && typeof json === 'object') {
      const o = json as Record<string, unknown>;
      const parts: string[] = [];

      if (typeof o['message'] === 'string') {
        parts.push(o['message']);
      } else if (o['message'] && typeof o['message'] === 'object') {
        parts.push(JSON.stringify(o['message']));
      }

      if (typeof o['error_description'] === 'string') {
        parts.push(o['error_description']);
      } else if (typeof o['error'] === 'string') {
        parts.push(o['error']);
      }

      if (Array.isArray(o['errors'])) {
        for (const e of o['errors'].slice(0, 5)) {
          if (typeof e === 'string') {
            parts.push(e);
          } else if (e && typeof e === 'object' && typeof (e as Record<string, unknown>)['message'] === 'string') {
            parts.push((e as Record<string, string>)['message']);
          }
        }
      }

      return parts.join('; ');
    }
  } catch {
    // not JSON
  }

  // HTML error pages (Jenkins, proxies) are not useful to surface.
  if (/^<!doctype html|^<html/i.test(text)) {
    return '';
  }

  return text.slice(0, 1_000);
}

/** Maps a non-2xx provider response to a Nest exception with a sanitized message. */
export function deploymentProviderHttpError(status: number, body: string, ctx: DeploymentHttpContext): HttpException {
  const detail = sanitizeDeploymentProviderMessage(extractDeploymentProviderErrorMessage(body), ctx.secrets);
  const base = `${ctx.providerLabel}: failed to ${ctx.action}`;
  const withDetail = detail ? `${base} (HTTP ${status}: ${detail})` : `${base} (HTTP ${status})`;

  if (status === 404) {
    return new NotFoundException(detail ? `${base}: not found (${detail})` : `${base}: not found`);
  }

  if (status === 400 || status === 409 || status === 422) {
    return new BadRequestException(withDetail);
  }

  if (status === 401) {
    return new BadGatewayException(`${base}: authentication failed (HTTP 401)`);
  }

  if (status === 403) {
    return new BadGatewayException(detail ? `${base}: access denied (${detail})` : `${base}: access denied (HTTP 403)`);
  }

  if (status === 429) {
    return new BadGatewayException(`${base}: rate limited (HTTP 429)`);
  }

  return new BadGatewayException(withDetail);
}

/**
 * `fetch` with timeout (AbortController) and sanitized transport errors. Returns the response for any HTTP status.
 */
export async function deploymentFetch(
  url: string,
  init: DeploymentRequestInit,
  ctx: DeploymentHttpContext,
): Promise<Response> {
  const { timeoutMs: initTimeout, ...rest } = init;
  const timeoutMs = initTimeout ?? ctx.timeoutMs ?? DEPLOYMENT_HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || controller.signal.aborted) {
      throw new GatewayTimeoutException(`${ctx.providerLabel}: failed to ${ctx.action} (timed out)`);
    }

    throw new BadGatewayException(`${ctx.providerLabel}: failed to ${ctx.action} (provider unreachable)`);
  } finally {
    clearTimeout(timer);
  }
}

/** {@link deploymentFetch} that throws the mapped provider error for non-2xx (and non-3xx with `redirect: manual`). */
export async function deploymentRequest(
  url: string,
  init: DeploymentRequestInit,
  ctx: DeploymentHttpContext,
): Promise<Response> {
  const res = await deploymentFetch(url, init, ctx);
  const okManualRedirect = init.redirect === 'manual' && res.status >= 300 && res.status < 400;

  if (!res.ok && !okManualRedirect) {
    const body = await safeReadText(res);

    throw deploymentProviderHttpError(res.status, body, ctx);
  }

  return res;
}

/** Performs a request and parses the JSON body (`undefined` for empty bodies). */
export async function deploymentRequestJson<T>(
  url: string,
  init: DeploymentRequestInit,
  ctx: DeploymentHttpContext,
): Promise<T> {
  const res = await deploymentRequest(url, init, ctx);

  return await readDeploymentJson<T>(res, ctx);
}

export async function readDeploymentJson<T>(res: Response, ctx: DeploymentHttpContext): Promise<T> {
  const text = await safeReadText(res);

  if (!text.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BadGatewayException(`${ctx.providerLabel}: failed to ${ctx.action} (invalid JSON response)`);
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Keeps the last `maxBytes` bytes of a UTF-8 string. */
export function tailDeploymentText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text ?? '', 'utf8');

  if (buf.length <= maxBytes) {
    return { text: text ?? '', truncated: false };
  }

  return { text: decodeTail(buf.subarray(buf.length - Math.max(0, maxBytes))), truncated: true };
}

/**
 * Reads a response body as text keeping only the last `maxBytes` bytes (streamed, memory bounded by roughly
 * `maxBytes` plus one chunk).
 */
export async function readDeploymentTextTail(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const limit = Math.max(0, maxBytes);
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;

  if (!body || typeof body.getReader !== 'function') {
    return tailDeploymentText(await safeReadText(res), limit);
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (!value || value.length === 0) {
      continue;
    }

    chunks.push(Buffer.from(value));
    total += value.length;

    while (chunks.length > 1 && total - chunks[0].length >= limit) {
      total -= chunks[0].length;
      chunks.shift();
      truncated = true;
    }
  }

  let buf = Buffer.concat(chunks);

  if (buf.length > limit) {
    buf = buf.subarray(buf.length - limit);
    truncated = true;
  }

  return { text: truncated ? decodeTail(buf) : buf.toString('utf8'), truncated };
}

/** Decodes a byte tail, dropping a partial UTF-8 sequence at the start. */
function decodeTail(buf: Buffer): string {
  let start = 0;

  // Skip UTF-8 continuation bytes (10xxxxxx) left over from a cut multi-byte character.
  while (start < buf.length && start < 4 && (buf[start] & 0xc0) === 0x80) {
    start++;
  }

  return buf.subarray(start).toString('utf8');
}

/** Parses an ISO date (or epoch millis) into a Date; null for missing / invalid values. */
export function parseDeploymentDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));

  return Number.isNaN(d.getTime()) ? null : d;
}

/** Joins per-job logs into one capped run log (tail). */
export function joinDeploymentJobLogs(
  parts: Array<{ name: string; logs: string; truncated: boolean }>,
  maxBytes: number,
): { logs: string; truncated: boolean } {
  const joined = parts.map((p) => `===== ${p.name} =====\n${p.logs}`).join('\n\n');
  const tail = tailDeploymentText(joined, maxBytes);

  return { logs: tail.text, truncated: tail.truncated || parts.some((p) => p.truncated) };
}

export function sleepDeployment(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
