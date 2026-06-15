import { AxiosHeaders } from 'axios';

import { buildClientProxyRequestHeaders } from './client-proxy-request-headers';

describe('buildClientProxyRequestHeaders', () => {
  it('sets Authorization and Content-Type from service arguments', () => {
    const h = buildClientProxyRequestHeaders(undefined, 'Bearer svc-token', 'application/json');

    expect(h.Authorization).toBe('Bearer svc-token');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('strips caller Authorization and keeps non-credential headers', () => {
    const h = buildClientProxyRequestHeaders(
      new AxiosHeaders({
        Authorization: 'Bearer user-jwt',
        'X-Request-Id': 'req-1',
        'X-Api-Key': 'should-drop',
      }),
      'Bearer svc-token',
    );

    expect(h.Authorization).toBe('Bearer svc-token');
    expect(h['X-Request-Id']).toBe('req-1');
    expect(h['X-Api-Key']).toBeUndefined();
  });

  it('strips cookie-like headers', () => {
    const h = buildClientProxyRequestHeaders(
      {
        Cookie: 'session=secret',
        'Set-Cookie': 'a=b',
        'X-Custom': 'ok',
      } as Record<string, string>,
      'Bearer t',
    );

    expect(h.Cookie).toBeUndefined();
    expect(h['Set-Cookie']).toBeUndefined();
    expect(h['X-Custom']).toBe('ok');
  });
});
