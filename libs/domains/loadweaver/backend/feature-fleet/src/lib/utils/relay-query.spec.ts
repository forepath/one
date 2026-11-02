import * as querystring from 'node:querystring';

import { MAX_RELAY_QUERY_PAIRS, parseRelayQuery, serializeRelayQuery } from './relay-query';

/** What the cluster reads (Express 5 `query parser: 'simple'` = `querystring.parse`, default `maxKeys` 1000). */
const clusterReads = (raw: string) => querystring.parse(raw);

describe('relay query parsing (3.24, H1 query smuggling)', () => {
  it('refuses the smuggling attack: 1000 filler pairs push `project` past the cluster parser', () => {
    const raw = `${Array.from({ length: 1000 }, (_, i) => `x${i}=1`).join('&')}&project=a`;

    // The discrepancy the attack relied on: URLSearchParams sees `project`, the cluster does not.
    expect(new URLSearchParams(raw).get('project')).toBe('a');
    expect(clusterReads(raw)['project']).toBeUndefined();

    expect(parseRelayQuery(raw)).toEqual({ ok: false, reason: `at most ${MAX_RELAY_QUERY_PAIRS} query parameters` });
  });

  it('parses like the cluster and re-serialises to the same values', () => {
    const raw = 'project=shop&status=pending&q=a+b%26c%3Dd&x=1&x=2&empty=';
    const parsed = parseRelayQuery(raw);

    expect(parsed).toEqual({
      ok: true,
      query: { project: 'shop', status: 'pending', q: 'a b&c=d', x: ['1', '2'], empty: '' },
    });

    const forwarded = serializeRelayQuery((parsed as { query: Record<string, unknown> }).query);

    // The cluster decodes the forwarded string to exactly the authorised parameters.
    expect({ ...clusterReads(forwarded) }).toEqual({ ...clusterReads(raw) });
  });

  it('refuses repeated authorization parameters, empty pairs and non-plain names', () => {
    for (const raw of [
      'project=a&project=b',
      'project=a&&x=1',
      'project=a&',
      'pro%6Aect=a',
      'project%3Db=a',
      'a%26project=b',
      'project+=a',
      'project[]=a',
      '__proto__=x',
      '=a',
    ])
      expect(parseRelayQuery(raw)).toMatchObject({ ok: false });
  });

  it('accepts an empty query and limits size', () => {
    expect(parseRelayQuery('')).toEqual({ ok: true, query: {} });
    expect(parseRelayQuery(`q=${'a'.repeat(9000)}`)).toMatchObject({ ok: false, reason: 'query too long' });
    expect(parseRelayQuery(Array.from({ length: MAX_RELAY_QUERY_PAIRS }, (_, i) => `x${i}=1`).join('&'))).toMatchObject(
      { ok: true },
    );
  });
});
