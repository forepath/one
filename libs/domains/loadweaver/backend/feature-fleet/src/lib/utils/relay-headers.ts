import { FLEET_ON_BEHALF_OF_HEADER } from '../constants/fleet.constants';

/** Request headers copied from the caller to the cluster; everything else (credentials, cookies, hop-by-hop) is dropped. */
const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'content-range',
  'range',
  'if-none-match',
  // Optimistic concurrency of Workspace drafts (3.36).
  'if-match',
  'if-modified-since',
  'x-correlation-id',
  'x-request-id',
  'x-upload-id',
  // Declared SHA-256 of a streamed upload (release bundles), bound into the claim and checked by the cluster.
  'x-loadweaver-content-sha256',
]);

/** Response headers copied back to the caller. */
const FORWARDED_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-disposition',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
  'x-correlation-id',
  'x-file-type',
  'x-loadweaver-warning',
  'x-loadweaver-version',
]);

function first(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;

  return value === undefined || value === null ? undefined : String(value);
}

/** Printable ASCII only, capped: the on-behalf-of label must never smuggle header syntax. */
export function sanitizeHeaderValue(value: string, max = 255): string {
  return [...value]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) < 0x7f)
    .join('')
    .trim()
    .slice(0, max);
}

/**
 * Headers of a relayed request: an allow-list of the caller's headers, then the cluster's service credential and
 * the acting fleet user (recorded by clusters whose service PAT carries `fleet:on-behalf-of`).
 */
export function buildRelayRequestHeaders(
  incoming: Record<string, unknown>,
  credential: string,
  onBehalfOf: string,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    const v = first(value);

    if (FORWARDED_REQUEST_HEADERS.has(lower) && v !== undefined) out[lower] = v;
  }

  // Uncompressed answers: the relay streams bodies through unchanged and doesn't forward `content-encoding`.
  out['accept-encoding'] = 'identity';
  out['authorization'] = `Bearer ${credential}`;

  const label = sanitizeHeaderValue(onBehalfOf);

  if (label) out[FLEET_ON_BEHALF_OF_HEADER.toLowerCase()] = label;

  return out;
}

/** Headers of the cluster's response passed back to the caller (no cookies, no auth challenges, no CORS of the cluster). */
export function filterRelayResponseHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    const v = first(value);

    if (FORWARDED_RESPONSE_HEADERS.has(lower) && v !== undefined) out[lower] = v;
  }

  return out;
}
