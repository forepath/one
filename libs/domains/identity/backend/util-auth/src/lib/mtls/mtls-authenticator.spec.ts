import { createMtlsAssertion } from './mtls-assertion';
import { authenticateMtls, readMtlsAssertionFromAuthorization } from './mtls-authenticator';
import { loadMtlsConfig, MtlsConfigurationError } from './mtls.config';
import { createTestPki } from './testing/mtls-test-pki';

describe('authenticateMtls', () => {
  const pki = createTestPki();
  const config = loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem });
  const tlsSocket = (der: Buffer) => ({ encrypted: true, getPeerCertificate: () => ({ raw: der }) });
  const assertionFor = (certificate = pki.client) =>
    createMtlsAssertion({ certificateChain: [certificate.certificate], privateKey: certificate.privateKey });

  it('authenticates a trusted TLS client certificate', () => {
    const result = authenticateMtls({ transportSocket: tlsSocket(pki.client.der) }, { config });

    expect(result).toEqual({
      ok: true,
      principal: expect.objectContaining({ source: 'tls', commonName: 'api-client' }),
    });
  });

  it('authenticates a trusted certificate assertion (case-insensitive scheme)', () => {
    for (const scheme of ['Certificate', 'certificate', 'CERTIFICATE']) {
      const result = authenticateMtls({ authorization: `${scheme} ${assertionFor()}` }, { config });

      expect(result).toEqual({ ok: true, principal: expect.objectContaining({ source: 'assertion' }) });
    }
  });

  it('accepts a valid assertion even when the TLS certificate is not trusted', () => {
    const result = authenticateMtls(
      { transportSocket: tlsSocket(pki.foreignClient.der), authorization: `Certificate ${assertionFor()}` },
      { config },
    );

    expect(result.ok && result.principal.source).toBe('assertion');
  });

  it('reports a missing certificate', () => {
    expect(authenticateMtls({}, { config })).toEqual({
      ok: false,
      presented: false,
      reason: 'no client certificate presented',
    });
  });

  it('never accepts other credentials (API keys, bearer tokens)', () => {
    process.env.STATIC_API_KEY = 'secret';

    try {
      for (const authorization of ['Bearer secret', 'ApiKey secret', `Bearer ${assertionFor()}`, 'secret']) {
        expect(authenticateMtls({ authorization }, { config })).toMatchObject({ ok: false, presented: false });
      }
    } finally {
      delete process.env.STATIC_API_KEY;
    }
  });

  it('reports invalid presented certificates with the reasons', () => {
    const result = authenticateMtls(
      {
        transportSocket: tlsSocket(pki.foreignClient.der),
        authorization: `Certificate ${assertionFor(pki.foreignClient)}`,
      },
      { config },
    );

    expect(result).toEqual({
      ok: false,
      presented: true,
      reason:
        'tls: client certificate is not issued by a trusted CA; assertion: client certificate is not issued by a trusted CA',
    });
    expect(authenticateMtls({ authorization: 'Certificate abc' }, { config })).toEqual({
      ok: false,
      presented: true,
      reason: 'assertion: malformed assertion',
    });
  });

  it('throws configuration errors (fail-closed)', () => {
    const original = { ...process.env };

    delete process.env.MTLS_CA_CERT;
    delete process.env.MTLS_CA_CERT_FILE;

    try {
      expect(() => authenticateMtls({ authorization: `Certificate ${assertionFor()}` })).toThrow(
        MtlsConfigurationError,
      );
    } finally {
      process.env = original;
    }
  });

  describe('readMtlsAssertionFromAuthorization', () => {
    it.each([
      [undefined, undefined],
      [123, undefined],
      ['Certificate', undefined],
      ['Certificate ', undefined],
      ['Certificate a b', undefined],
      ['Bearer abc', undefined],
      ['Certificate abc', 'abc'],
      ['  Certificate abc  ', 'abc'],
    ])('%p → %p', (input, expected) => {
      expect(readMtlsAssertionFromAuthorization(input)).toBe(expected);
    });
  });
});
