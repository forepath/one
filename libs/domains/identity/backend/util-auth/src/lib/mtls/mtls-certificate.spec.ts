import { MtlsVerificationError, verifyClientCertificateChain } from './mtls-certificate';
import { loadMtlsConfig, type MtlsConfig } from './mtls.config';
import { createTestCertificate, createTestPki, OID_CLIENT_AUTH, OID_SERVER_AUTH } from './testing/mtls-test-pki';

describe('verifyClientCertificateChain', () => {
  const pki = createTestPki();
  let config: MtlsConfig;

  beforeEach(() => {
    config = loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem });
  });

  function expectRejected(chain: Parameters<typeof verifyClientCertificateChain>[0], reason: RegExp, cfg = config) {
    expect(() => verifyClientCertificateChain(chain, cfg, 'tls')).toThrow(MtlsVerificationError);
    expect(() => verifyClientCertificateChain(chain, cfg, 'tls')).toThrow(reason);
  }

  it('accepts a client certificate issued by the trusted CA and describes the principal', () => {
    const principal = verifyClientCertificateChain([pki.client.certificate], config, 'tls');

    expect(principal).toEqual({
      source: 'tls',
      subject: 'CN=api-client',
      commonName: 'api-client',
      issuer: 'CN=Test Root CA',
      serialNumber: pki.client.certificate.serialNumber,
      fingerprint256: pki.client.fingerprint256,
      validTo: new Date(pki.client.certificate.validTo).toISOString(),
    });
  });

  it('accepts a chain through a CA intermediate presented by the client', () => {
    const principal = verifyClientCertificateChain(
      [pki.intermediateClient.certificate, pki.intermediateCa.certificate],
      config,
      'assertion',
    );

    expect(principal.commonName).toBe('intermediate-client');
    expect(principal.source).toBe('assertion');
  });

  it('accepts an intermediate configured as trust anchor', () => {
    const intermediateOnly = loadMtlsConfig({ MTLS_CA_CERT: pki.intermediateCa.pem });

    expect(verifyClientCertificateChain([pki.intermediateClient.certificate], intermediateOnly, 'tls').commonName).toBe(
      'intermediate-client',
    );
    expectRejected([pki.client.certificate], /not issued by a trusted CA/, intermediateOnly);
  });

  it('rejects an intermediate-issued leaf without its intermediate', () => {
    expectRejected([pki.intermediateClient.certificate], /not issued by a trusted CA/);
  });

  it('rejects certificates of an unrelated CA, even with a matching subject', () => {
    expectRejected([pki.foreignClient.certificate], /not issued by a trusted CA/);
  });

  it('rejects a forged certificate that copies the CA name but is signed by another key', () => {
    const impostorCa = createTestCertificate({ commonName: 'Test Root CA', isCa: true });
    const forged = createTestCertificate({ commonName: 'api-client', issuer: { certificate: impostorCa } });

    expectRejected([forged.certificate], /not issued by a trusted CA/);
    // Supplying the impostor CA as "intermediate" must not help either.
    expectRejected([forged.certificate, impostorCa.certificate], /not issued by a trusted CA/);
  });

  it('rejects an intermediate that is not a CA', () => {
    const notCa = createTestCertificate({ commonName: 'not-a-ca', issuer: { certificate: pki.rootCa } });
    const leaf = createTestCertificate({ commonName: 'leaf', issuer: { certificate: notCa } });

    expectRejected([leaf.certificate, notCa.certificate], /not issued by a trusted CA/);
  });

  it('rejects expired and not-yet-valid client certificates', () => {
    const expired = createTestCertificate({
      commonName: 'expired',
      issuer: { certificate: pki.rootCa },
      notBefore: new Date(Date.now() - 2 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    const future = createTestCertificate({
      commonName: 'future',
      issuer: { certificate: pki.rootCa },
      notBefore: new Date(Date.now() + 86_400_000),
    });

    expectRejected([expired.certificate], /expired or not yet valid/);
    expectRejected([future.certificate], /expired or not yet valid/);
  });

  it('rejects chains whose intermediate expired', () => {
    const expiredIntermediate = createTestCertificate({
      commonName: 'Expired Intermediate',
      isCa: true,
      issuer: { certificate: pki.rootCa },
      notBefore: new Date(Date.now() - 2 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    const leaf = createTestCertificate({ commonName: 'leaf', issuer: { certificate: expiredIntermediate } });

    expectRejected([leaf.certificate, expiredIntermediate.certificate], /not issued by a trusted CA/);
  });

  it('rejects CA certificates as client certificates', () => {
    expectRejected([pki.intermediateCa.certificate], /CA certificates cannot authenticate/);
  });

  it('requires clientAuth when the certificate restricts extended key usage', () => {
    const serverOnly = createTestCertificate({
      commonName: 'server',
      issuer: { certificate: pki.rootCa },
      extendedKeyUsage: [OID_SERVER_AUTH],
    });
    const both = createTestCertificate({
      commonName: 'both',
      issuer: { certificate: pki.rootCa },
      extendedKeyUsage: [OID_SERVER_AUTH, OID_CLIENT_AUTH],
    });
    const unrestricted = createTestCertificate({
      commonName: 'unrestricted',
      issuer: { certificate: pki.rootCa },
      extendedKeyUsage: null,
    });

    expectRejected([serverOnly.certificate], /not valid for client authentication/);
    expect(verifyClientCertificateChain([both.certificate], config, 'tls').commonName).toBe('both');
    expect(verifyClientCertificateChain([unrestricted.certificate], config, 'tls').commonName).toBe('unrestricted');
  });

  it.each([
    ['rsa-2048', true],
    ['ec-p384', true],
    ['ec-p521', true],
    ['ed25519', true],
    ['rsa-1024', false],
    ['ec-secp256k1', false],
  ] as const)('key type %s accepted: %s', (keyType, accepted) => {
    const leaf = createTestCertificate({ commonName: keyType, keyType, issuer: { certificate: pki.rootCa } });

    if (accepted) {
      expect(verifyClientCertificateChain([leaf.certificate], config, 'tls').commonName).toBe(keyType);
    } else {
      expectRejected([leaf.certificate], /RSA keys must have|unsupported elliptic curve/);
    }
  });

  it('rejects revoked certificates', () => {
    const withRevocation = loadMtlsConfig({
      MTLS_CA_CERT: pki.rootCa.pem,
      MTLS_REVOKED_FINGERPRINTS: pki.client.certificate.fingerprint256,
    });

    expectRejected([pki.client.certificate], /revoked/, withRevocation);
  });

  it('enforces fingerprint and subject allowlists (either match suffices)', () => {
    const other = createTestCertificate({ commonName: 'other', issuer: { certificate: pki.rootCa } });
    const byFingerprint = loadMtlsConfig({
      MTLS_CA_CERT: pki.rootCa.pem,
      MTLS_ALLOWED_FINGERPRINTS: pki.client.fingerprint256,
    });
    const bySubject = loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem, MTLS_ALLOWED_SUBJECTS: 'other' });
    const both = loadMtlsConfig({
      MTLS_CA_CERT: pki.rootCa.pem,
      MTLS_ALLOWED_FINGERPRINTS: pki.client.fingerprint256,
      MTLS_ALLOWED_SUBJECTS: 'other',
    });

    expect(verifyClientCertificateChain([pki.client.certificate], byFingerprint, 'tls').commonName).toBe('api-client');
    expectRejected([other.certificate], /not allowlisted/, byFingerprint);
    expect(verifyClientCertificateChain([other.certificate], bySubject, 'tls').commonName).toBe('other');
    expectRejected([pki.client.certificate], /not allowlisted/, bySubject);
    expect(verifyClientCertificateChain([pki.client.certificate], both, 'tls').commonName).toBe('api-client');
    expect(verifyClientCertificateChain([other.certificate], both, 'tls').commonName).toBe('other');
  });

  it('accepts a pinned self-signed client certificate configured as trust anchor', () => {
    const selfSigned = createTestCertificate({ commonName: 'pinned-client' });
    const pinned = loadMtlsConfig({ MTLS_CA_CERT: selfSigned.pem });
    const otherSelfSigned = createTestCertificate({ commonName: 'pinned-client' });
    const issuedByPinnedLeaf = createTestCertificate({ commonName: 'child', issuer: { certificate: selfSigned } });

    expect(verifyClientCertificateChain([selfSigned.certificate], pinned, 'tls').commonName).toBe('pinned-client');
    expectRejected([otherSelfSigned.certificate], /not issued by a trusted CA/, pinned);
    // A non-CA anchor only pins itself: it cannot issue other client certificates.
    expectRejected([issuedByPinnedLeaf.certificate], /not issued by a trusted CA/, pinned);
  });

  it('rejects empty and oversized chains', () => {
    expectRejected([], /no client certificate/);
    expectRejected(Array(6).fill(pki.client.certificate), /chain too long/);
  });
});
