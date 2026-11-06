// Test-only PKI builder of the identity domain.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createTestPki } from '../../../../../../identity/backend/util-auth/src/lib/mtls/testing/mtls-test-pki';

import { createClientMtlsAuthorizationHeader } from './client-mtls-authorization';

describe('createClientMtlsAuthorizationHeader', () => {
  const pki = createTestPki();
  const payloadOf = (header: string) =>
    JSON.parse(Buffer.from(header.split(' ')[1].split('.')[1], 'base64url').toString());

  it('signs a fresh assertion per call with the manager origin as audience', () => {
    const client = {
      endpoint: 'https://manager.example.com/prefix/',
      mtlsCertificate: pki.client.pem,
      mtlsPrivateKey: pki.client.privateKeyPem,
    };
    const first = createClientMtlsAuthorizationHeader(client);
    const second = createClientMtlsAuthorizationHeader(client);

    expect(first.startsWith('Certificate ')).toBe(true);
    expect(payloadOf(first).aud).toBe('https://manager.example.com');
    expect(payloadOf(first).jti).not.toBe(payloadOf(second).jti);
  });

  it('omits the audience for unparsable endpoints', () => {
    expect(
      payloadOf(
        createClientMtlsAuthorizationHeader({
          endpoint: 'not a url',
          mtlsCertificate: pki.client.pem,
          mtlsPrivateKey: pki.client.privateKeyPem,
        }),
      ).aud,
    ).toBeUndefined();
  });

  it('rejects missing or unusable credentials without leaking key material', () => {
    expect(() =>
      createClientMtlsAuthorizationHeader({ endpoint: 'https://m', mtlsCertificate: pki.client.pem }),
    ).toThrow('Client certificate is not configured for this client');
    expect(() =>
      createClientMtlsAuthorizationHeader({ endpoint: 'https://m', mtlsCertificate: 'x', mtlsPrivateKey: 'y' }),
    ).toThrow('Client certificate of this client cannot be used');
  });
});
