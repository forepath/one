import { verifyMtlsAssertion } from './mtls-assertion';
import {
  createMtlsAuthorizationHeader,
  describeMtlsClientCertificate,
  MTLS_CLIENT_ASSERTION_LIFETIME_SECONDS,
  MtlsClientCredentialError,
  validateMtlsClientCredential,
} from './mtls-client-credential';
import { loadMtlsConfig } from './mtls.config';
import { createTestCertificate, createTestPki } from './testing/mtls-test-pki';

describe('mtls client credentials (outbound)', () => {
  const pki = createTestPki();

  describe('validateMtlsClientCredential', () => {
    it('accepts a matching certificate / key pair and summarises it', () => {
      expect(validateMtlsClientCredential(pki.client.pem, pki.client.privateKeyPem)).toEqual({
        fingerprint256: pki.client.fingerprint256,
        commonName: 'api-client',
        validTo: new Date(Date.parse(pki.client.certificate.validTo)).toISOString(),
      });
      expect(
        validateMtlsClientCredential(
          `${pki.intermediateClient.pem}${pki.intermediateCa.pem}`,
          pki.intermediateClient.privateKeyPem,
        ).commonName,
      ).toBe('intermediate-client');
    });

    it('accepts PKCS#1 / SEC1 keys', () => {
      const rsa = createTestCertificate({
        commonName: 'rsa',
        keyType: 'rsa-2048',
        issuer: { certificate: pki.rootCa },
      });

      expect(
        validateMtlsClientCredential(rsa.pem, rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString())
          .commonName,
      ).toBe('rsa');
      expect(
        validateMtlsClientCredential(
          pki.client.pem,
          pki.client.privateKey.export({ type: 'sec1', format: 'pem' }).toString(),
        ).commonName,
      ).toBe('api-client');
    });

    it.each([
      ['garbage certificate', () => ['nope', pki.client.privateKeyPem], /not a valid PEM certificate/],
      ['garbage key', () => [pki.client.pem, 'nope'], /not a valid PEM private key/],
      [
        'encrypted key',
        () => [
          pki.client.pem,
          pki.client.privateKey
            .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' })
            .toString(),
        ],
        /Encrypted private keys/,
      ],
      ['key of another certificate', () => [pki.client.pem, pki.foreignClient.privateKeyPem], /does not belong/],
      [
        'intermediate first',
        () => [`${pki.intermediateCa.pem}${pki.intermediateClient.pem}`, pki.intermediateClient.privateKeyPem],
        /leaf certificate must come first/,
      ],
      ['CA certificate', () => [pki.rootCa.pem, pki.rootCa.privateKeyPem], /CA certificate cannot/],
      ['too many certificates', () => [pki.client.pem.repeat(6), pki.client.privateKeyPem], /at most 5/],
      ['oversized input', () => ['x'.repeat(40_000), pki.client.privateKeyPem], /too large/],
    ])('rejects %s', (_label, input, message) => {
      const [certificate, key] = input();

      expect(() => validateMtlsClientCredential(certificate, key)).toThrow(MtlsClientCredentialError);
      expect(() => validateMtlsClientCredential(certificate, key)).toThrow(message);
    });

    it('rejects weak keys and expired certificates', () => {
      const weak = createTestCertificate({
        commonName: 'weak',
        keyType: 'rsa-1024',
        issuer: { certificate: pki.rootCa },
      });
      const expired = createTestCertificate({
        commonName: 'expired',
        issuer: { certificate: pki.rootCa },
        notBefore: new Date(Date.now() - 2 * 86_400_000),
        notAfter: new Date(Date.now() - 86_400_000),
      });

      expect(() => validateMtlsClientCredential(weak.pem, weak.privateKeyPem)).toThrow(
        /Unsupported client certificate key/,
      );
      expect(() => validateMtlsClientCredential(expired.pem, expired.privateKeyPem)).toThrow(/expired/);
    });
  });

  it('describeMtlsClientCertificate never throws', () => {
    expect(describeMtlsClientCertificate(pki.client.pem)?.commonName).toBe('api-client');
    expect(describeMtlsClientCertificate('broken')).toBeUndefined();
    expect(describeMtlsClientCertificate(null)).toBeUndefined();
  });

  it('createMtlsAuthorizationHeader signs short-lived assertions the server accepts', () => {
    const header = createMtlsAuthorizationHeader({
      certificateChain: pki.client.pem,
      privateKey: pki.client.privateKeyPem,
      audience: 'https://manager.example.com',
    });
    const [scheme, token] = header.split(' ');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const config = loadMtlsConfig({
      MTLS_CA_CERT: pki.rootCa.pem,
      MTLS_ASSERTION_AUDIENCE: 'https://manager.example.com',
    });

    expect(scheme).toBe('Certificate');
    expect(payload.exp - payload.iat).toBe(MTLS_CLIENT_ASSERTION_LIFETIME_SECONDS);
    expect(payload.aud).toBe('https://manager.example.com');
    expect(verifyMtlsAssertion(token, config).commonName).toBe('api-client');
  });
});
