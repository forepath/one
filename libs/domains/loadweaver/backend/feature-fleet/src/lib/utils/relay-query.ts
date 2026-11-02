import * as querystring from 'node:querystring';

/**
 * Query strings of relayed requests (3.24). The cluster (Express 5, `query parser: 'simple'`) parses queries with
 * `node:querystring` and its default `maxKeys` of 1000: pairs after the 1000th are dropped silently. Authorising on
 * a different parser (or on more pairs than the cluster reads) lets a caller smuggle parameters past the fleet —
 * `?x0=1&…&x999=1&project=a` passes a project check while the cluster never sees `project`. So the fleet:
 *
 * - parses with the same `node:querystring` semantics and limit as the cluster,
 * - refuses long / large queries (≤ {@link MAX_RELAY_QUERY_PAIRS} pairs, far below the cluster's limit), empty pairs,
 *   and parameter names that are not plain (no percent-encoding, `+`, brackets or separators),
 * - refuses repeated authorization-relevant parameters (`project`),
 * - and re-serialises the forwarded query from the parsed, validated parameters (never the raw string).
 */
export const CLUSTER_QUERY_MAX_KEYS = 1000;
export const MAX_RELAY_QUERY_PAIRS = 100;
export const MAX_RELAY_QUERY_LENGTH = 8192;

/** Parameters the fleet authorises on: never accepted more than once. */
export const AUTHORIZATION_QUERY_PARAMS: readonly string[] = ['project'];

const QUERY_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export type RelayQuery = Record<string, string | string[]>;

export type RelayQueryResult = { ok: true; query: RelayQuery } | { ok: false; reason: string };

export function parseRelayQuery(raw: string): RelayQueryResult {
  if (!raw) return { ok: true, query: {} };

  if (raw.length > MAX_RELAY_QUERY_LENGTH) return { ok: false, reason: 'query too long' };

  const pairs = raw.split('&');

  if (pairs.length > MAX_RELAY_QUERY_PAIRS)
    return { ok: false, reason: `at most ${MAX_RELAY_QUERY_PAIRS} query parameters` };

  for (const pair of pairs) {
    if (!pair) return { ok: false, reason: 'empty query parameter' };

    const eq = pair.indexOf('=');

    if (!QUERY_KEY.test(eq < 0 ? pair : pair.slice(0, eq))) return { ok: false, reason: 'invalid query parameter' };
  }

  // The cluster's parser, with its limit: what is authorised below is what the cluster would read.
  const parsed = querystring.parse(raw, '&', '=', { maxKeys: CLUSTER_QUERY_MAX_KEYS });
  const query: RelayQuery = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) continue;

    if (Array.isArray(value) && AUTHORIZATION_QUERY_PARAMS.includes(key))
      return { ok: false, reason: `repeated ${key} parameter` };

    query[key] = Array.isArray(value) ? [...value] : value;
  }

  return { ok: true, query };
}

/** The forwarded query string, serialised from the validated parameters (decoded by the cluster to the same values). */
export function serializeRelayQuery(query: Record<string, unknown> | undefined): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;

    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v));
  }

  return params.toString();
}
