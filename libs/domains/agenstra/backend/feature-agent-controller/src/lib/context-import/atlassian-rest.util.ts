import { createHash } from 'crypto';

const FETCH_TIMEOUT_MS = 45_000;

export function normalizeAtlassianBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Atlassian base URL must be http(s)');
  }

  // Atlassian Cloud serves Jira at /rest and Confluence at /wiki/rest. Admin UI links often include /wiki/…;
  // keep site origin only so callers can append /rest/… or /wiki/rest/… exactly once.
  if (parsed.hostname === 'atlassian.net' || parsed.hostname.endsWith('.atlassian.net')) {
    const portPart = parsed.port ? `:${parsed.port}` : '';

    return `${parsed.protocol}//${parsed.hostname}${portPart}`;
  }

  return trimmed;
}

/**
 * Base URL for Confluence REST paths (`/rest/api/...`).
 * On Atlassian Cloud this is `{site}/wiki`; on Confluence Server/DC it is the configured Confluence root URL.
 */
export function confluenceRestApiRoot(normalizedSiteBase: string): string {
  const trimmed = normalizedSiteBase.trim().replace(/\/+$/, '');
  const u = new URL(trimmed);

  if (u.hostname === 'atlassian.net' || u.hostname.endsWith('.atlassian.net')) {
    const portPart = u.port ? `:${u.port}` : '';

    return `${u.protocol}//${u.hostname}${portPart}/wiki`;
  }

  return trimmed;
}

/**
 * Resolves Confluence CQL search `_links.next` to an absolute URL.
 * Cloud responses often use `/rest/api/...` (relative to `/wiki`) or `/wiki/rest/api/...` (relative to site origin).
 *
 * `siteBase` is the base for `/wiki/...` links (site origin, or `https://api.atlassian.com/ex/confluence/{cloudId}` for
 * OAuth connections) and `confluenceRoot` the Confluence REST root (`.../wiki` on Cloud). Absolute links are followed
 * only when they point at the origin of `confluenceRoot`; any other host (e.g. the site URL while requests go through
 * the API gateway) is reduced to its path + query and resolved against our bases, so credentials never leave the
 * configured origin.
 */
export function resolveConfluencePaginationUrl(siteBase: string, confluenceRoot: string, relNext: string): string {
  let r = relNext.trim();

  if (!r) {
    return siteBase;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) {
    let parsed: URL;

    try {
      parsed = new URL(r, confluenceRoot);
    } catch {
      return siteBase;
    }

    if (
      parsed.origin === new URL(confluenceRoot).origin &&
      (parsed.protocol === 'https:' || parsed.protocol === 'http:')
    ) {
      return parsed.toString();
    }

    r = `${parsed.pathname}${parsed.search}`;
  }

  const originBase = siteBase.replace(/\/+$/, '');

  if (r.startsWith('/wiki/')) {
    return `${originBase}${r}`;
  }

  const root = confluenceRoot.replace(/\/+$/, '');

  return `${root}${r.startsWith('/') ? '' : '/'}${r}`;
}

function searchParamsSortedKeyString(search: string): string {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const keys = [...new Set([...sp.keys()])].sort();

  return keys.map((k) => `${k}=${sp.getAll(k).join(',')}`).join('&');
}

/** Avoid infinite pagination when `next` is logically the same page (e.g. query param reordering). */
export function confluenceContentSearchUrlsEquivalent(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);

    if (ua.origin !== ub.origin) {
      return false;
    }

    const pa = ua.pathname.replace(/\/+/g, '/');
    const pb = ub.pathname.replace(/\/+/g, '/');

    if (pa !== pb) {
      return false;
    }

    return searchParamsSortedKeyString(ua.search) === searchParamsSortedKeyString(ub.search);
  } catch {
    return a === b;
  }
}

export function buildBasicAuthHeader(email: string, apiToken: string): string {
  const token = Buffer.from(`${email}:${apiToken}`, 'utf8').toString('base64');

  return `Basic ${token}`;
}

export async function atlassianFetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const timeoutMs = init.timeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.headers as Record<string, string>),
      },
    });
    const text = await res.text();
    let json: unknown = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

export function contentHashForImport(title: string, body: string | null): string {
  return createHash('sha256')
    .update(`${title}\0${body ?? ''}`)
    .digest('hex')
    .slice(0, 32);
}
