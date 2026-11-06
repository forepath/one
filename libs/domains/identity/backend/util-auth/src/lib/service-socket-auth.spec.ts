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

  it.each(['users', 'saml'])('rejects every handshake in %s mode', async (method) => {
    process.env.AUTHENTICATION_METHOD = method;
    process.env.STATIC_API_KEY = 'secret-key';

    await expect(authenticateServiceSocket(socket('Bearer secret-key'))).resolves.toBe(false);
  });
});
