import { buildRelayRequestHeaders, filterRelayResponseHeaders, sanitizeHeaderValue } from './relay-headers';

describe('relay headers', () => {
  it('forwards an allow-list, replaces credentials and adds the acting user', () => {
    const headers = buildRelayRequestHeaders(
      {
        Authorization: 'Bearer fleet-user-token',
        Cookie: 'session=1',
        'X-Api-Key': 'k',
        'Content-Type': 'application/json',
        'X-Correlation-Id': 'c1',
        Host: 'fleet.example.com',
        'X-Loadweaver-On-Behalf-Of': 'spoofed',
        Range: ['bytes=0-9', 'x'],
        'Accept-Encoding': 'gzip, br',
        'If-Match': '"3"',
      },
      'cluster-pat',
      'fleet:alice@example.com',
    );

    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-correlation-id': 'c1',
      range: 'bytes=0-9',
      // Workspace drafts' optimistic concurrency (3.36).
      'if-match': '"3"',
      // The relay streams bodies unchanged without `content-encoding`: always ask for identity.
      'accept-encoding': 'identity',
      authorization: 'Bearer cluster-pat',
      'x-loadweaver-on-behalf-of': 'fleet:alice@example.com',
    });
  });

  it('sanitises the on-behalf-of label', () => {
    expect(sanitizeHeaderValue('a\r\nX-Evil: 1')).toBe('aX-Evil: 1');
    expect(sanitizeHeaderValue('ü-x')).toBe('-x');
    expect(sanitizeHeaderValue('y'.repeat(300))).toHaveLength(255);
    expect(buildRelayRequestHeaders({}, 'p', '\n')['x-loadweaver-on-behalf-of']).toBeUndefined();
  });

  it('passes only safe response headers back', () => {
    expect(
      filterRelayResponseHeaders({
        'content-type': 'application/json',
        'set-cookie': ['a=b'],
        'www-authenticate': 'Bearer',
        'access-control-allow-origin': '*',
        'x-loadweaver-version': '1.2.3',
      }),
    ).toEqual({ 'content-type': 'application/json', 'x-loadweaver-version': '1.2.3' });
  });
});
