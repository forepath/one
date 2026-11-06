import { createMtlsAssertion } from './mtls/mtls-assertion';
import { createTestPki } from './mtls/testing/mtls-test-pki';
import { authenticateServiceSocket } from './service-socket-auth';

const socket = (authorization?: string, viaAuth = false) => ({
  handshake: viaAuth
    ? { headers: {}, auth: authorization ? { Authorization: authorization } : {} }
    : { headers: authorization ? { authorization } : {} },
});

describe('authenticateServiceSocket', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  describe('api-key mode', () => {
    beforeEach(() => {
      process.env.AUTHENTICATION_METHOD = 'api-key';
      process.env.STATIC_API_KEY = 'secret-key';
    });

    it('accepts the static API key (Bearer / ApiKey, header or handshake auth)', async () => {
      await expect(authenticateServiceSocket(socket('Bearer secret-key'))).resolves.toBe(true);
      await expect(authenticateServiceSocket(socket('ApiKey secret-key'))).resolves.toBe(true);
      await expect(authenticateServiceSocket(socket('Bearer secret-key', true))).resolves.toBe(true);
    });

    it('rejects missing, wrong and malformed credentials', async () => {
      await expect(authenticateServiceSocket(socket())).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket('Bearer wrong'))).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket('Basic secret-key'))).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket('Bearer secret-key extra'))).resolves.toBe(false);
    });

    it('rejects everything when STATIC_API_KEY is unset', async () => {
      delete process.env.STATIC_API_KEY;
      await expect(authenticateServiceSocket(socket('Bearer '))).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket('Bearer undefined'))).resolves.toBe(false);
    });
  });

  describe('oidc mode', () => {
    beforeEach(() => {
      process.env.AUTHENTICATION_METHOD = 'oidc';
    });

    it('accepts tokens the OIDC verifier accepts', async () => {
      const verifier = { verifyAccessToken: jest.fn().mockResolvedValue({ sub: 's' }) };

      await expect(authenticateServiceSocket(socket('Bearer tok'), verifier)).resolves.toBe(true);
      expect(verifier.verifyAccessToken).toHaveBeenCalledWith('tok');
    });

    it('rejects tokens the verifier rejects, other schemes and a missing verifier', async () => {
      const verifier = { verifyAccessToken: jest.fn().mockRejectedValue(new Error('azp')) };

      await expect(authenticateServiceSocket(socket('Bearer tok'), verifier)).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket('ApiKey tok'), verifier)).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket('Bearer tok'), null)).resolves.toBe(false);
    });
  });

  describe('mtls mode', () => {
    const pki = createTestPki();
    const assertion = (certificate = pki.client) =>
      createMtlsAssertion({ certificateChain: [certificate.certificate], privateKey: certificate.privateKey });
    const tlsSocket = (der: Buffer) => ({ encrypted: true, getPeerCertificate: () => ({ raw: der }) });

    beforeEach(() => {
      process.env.AUTHENTICATION_METHOD = 'mtls';
      process.env.MTLS_CA_CERT = pki.rootCa.pem;
      process.env.STATIC_API_KEY = 'secret-key';
    });

    it('accepts certificate assertions (header or handshake auth) and TLS client certificates', async () => {
      await expect(authenticateServiceSocket(socket(`Certificate ${assertion()}`))).resolves.toBe(true);
      await expect(authenticateServiceSocket(socket(`Certificate ${assertion()}`, true))).resolves.toBe(true);
      await expect(
        authenticateServiceSocket({ ...socket(), request: { socket: tlsSocket(pki.client.der) } }),
      ).resolves.toBe(true);
    });

    it('rejects untrusted certificates, the API key and missing credentials', async () => {
      await expect(authenticateServiceSocket(socket(`Certificate ${assertion(pki.foreignClient)}`))).resolves.toBe(
        false,
      );
      await expect(
        authenticateServiceSocket({ ...socket(), request: { socket: tlsSocket(pki.foreignClient.der) } }),
      ).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket('Bearer secret-key'))).resolves.toBe(false);
      await expect(authenticateServiceSocket(socket())).resolves.toBe(false);
    });

    it('fails closed without MTLS_CA_CERT', async () => {
      delete process.env.MTLS_CA_CERT;

      await expect(authenticateServiceSocket(socket(`Certificate ${assertion()}`))).resolves.toBe(false);
    });
  });

  it.each(['users', 'saml'])('rejects every handshake in %s mode', async (method) => {
    process.env.AUTHENTICATION_METHOD = method;
    process.env.STATIC_API_KEY = 'secret-key';

    await expect(authenticateServiceSocket(socket('Bearer secret-key'))).resolves.toBe(false);
  });
});
