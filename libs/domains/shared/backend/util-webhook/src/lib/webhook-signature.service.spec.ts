import { WebhookSignatureService } from './webhook-signature.service';
import { applyWebhookAuth, assertWebhookAuthCompatible } from './webhook-auth-applicator';

describe('WebhookSignatureService', () => {
  const service = new WebhookSignatureService();

  it('signs and verifies payload', () => {
    const payload = '{"type":"invoice.issued"}';
    const secret = 'test-secret';
    const header = service.sign(payload, secret, 1_700_000_000);

    expect(service.verify(payload, secret, header, 999_999_999)).toBe(true);
  });

  it('rejects tampered payload', () => {
    const header = service.sign('{"type":"invoice.issued"}', 'secret', 1_700_000_000);

    expect(service.verify('{"type":"invoice.paid"}', 'secret', header, 999_999_999)).toBe(false);
  });
});

describe('applyWebhookAuth', () => {
  it('applies authorization header', () => {
    const applied = applyWebhookAuth({ authType: 'authorization', authValue: 'Bearer token' });

    expect(applied.headers.Authorization).toBe('Bearer token');
    expect(applied.queryParams).toEqual({});
  });

  it('applies custom header', () => {
    const applied = applyWebhookAuth({
      authType: 'custom_header',
      authHeaderName: 'X-Api-Key',
      authValue: 'abc',
    });

    expect(applied.headers['X-Api-Key']).toBe('abc');
  });

  it('applies query param for GET-compatible auth', () => {
    assertWebhookAuthCompatible('GET', { authType: 'query_param', authValue: 'secret' });
    const applied = applyWebhookAuth({ authType: 'query_param', authValue: 'secret' });

    expect(applied.queryParams.token).toBe('secret');
  });

  it('rejects query param auth for POST', () => {
    expect(() => assertWebhookAuthCompatible('POST', { authType: 'query_param', authValue: 'secret' })).toThrow(
      'Query parameter authentication is only supported for GET requests',
    );
  });
});
