import { createMtlsAssertion, UserRole } from '@forepath/identity/backend';
import { JwtService } from '@nestjs/jwt';

// Test-only PKI builder of the identity domain (not part of the public util-auth API).
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createTestPki } from '../../../../util-auth/src/lib/mtls/testing/mtls-test-pki';
import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';

import { SocketAuthService } from './socket-auth.service';

describe('SocketAuthService', () => {
  let service: SocketAuthService;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById'>>;
  let revokedUserTokensRepository: jest.Mocked<Pick<RevokedUserTokensRepository, 'isRevoked'>>;

  beforeEach(() => {
    process.env.AUTHENTICATION_METHOD = 'users';

    jwtService = { verifyAsync: jest.fn() };
    usersRepository = { findById: jest.fn() };
    revokedUserTokensRepository = { isRevoked: jest.fn().mockResolvedValue(false) };

    service = new SocketAuthService(
      null,
      jwtService as unknown as JwtService,
      usersRepository as unknown as UsersRepository,
      revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
    );
  });

  afterEach(() => {
    delete process.env.AUTHENTICATION_METHOD;
    jest.clearAllMocks();
  });

  it('rejects users JWT when token version does not match', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
      tv: 0,
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 2,
    } as never);

    const result = await service.validateAndGetUser('Bearer valid.jwt.token');

    expect(result).toBeNull();
  });

  it('rejects users JWT when token jti is revoked', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
      tv: 2,
      jti: 'session-1',
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 2,
    } as never);
    revokedUserTokensRepository.isRevoked.mockResolvedValue(true);

    const result = await service.validateAndGetUser('Bearer valid.jwt.token');

    expect(result).toBeNull();
  });

  it('accepts users JWT when token version matches and jti is not revoked', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
      tv: 2,
      jti: 'session-1',
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 2,
    } as never);

    const result = await service.validateAndGetUser('Bearer valid.jwt.token');

    expect(result).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        userRole: UserRole.USER,
      }),
    );
  });

  it('rejects oidc-mode PAT JWTs on sockets not opened to machine tokens, before OIDC validation', async () => {
    process.env.AUTHENTICATION_METHOD = 'oidc';
    const oidcVerifier = { verifyAccessToken: jest.fn(), getEmail: jest.fn() };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      amr: ['pat'],
      patId: 't1',
      scopes: ['clients:read'],
    });
    const oidcService = new SocketAuthService(
      oidcVerifier as never,
      jwtService as unknown as JwtService,
      usersRepository as unknown as UsersRepository,
      revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
    );
    const result = await oidcService.validateAndGetUser('Bearer pat.jwt.token');

    expect(result).toBeNull();
    expect(oidcVerifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  describe('static credentials (api-key / mtls): full access, like HTTP', () => {
    const pki = createTestPki();
    const originalEnv = { ...process.env };
    const assertion = (certificate = pki.client) =>
      createMtlsAssertion({ certificateChain: [certificate.certificate], privateKey: certificate.privateKey });
    const tlsSocket = (der: Buffer) => ({ encrypted: true, getPeerCertificate: () => ({ raw: der }) });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    describe('api-key', () => {
      beforeEach(() => {
        process.env.AUTHENTICATION_METHOD = 'api-key';
        process.env.STATIC_API_KEY = 'socket-key';
      });

      it.each(['Bearer socket-key', 'ApiKey socket-key'])('accepts %s as the admin principal', async (header) => {
        await expect(service.validateAndGetUser(header, undefined, { websocket: 'clients' })).resolves.toEqual({
          isApiKeyAuth: true,
          user: { id: 'api-key-user', roles: ['admin', 'user'] },
        });
      });

      it('rejects wrong keys, missing headers and certificate assertions', async () => {
        await expect(service.validateAndGetUser('Bearer wrong')).resolves.toBeNull();
        await expect(service.validateAndGetUser(undefined)).resolves.toBeNull();
        await expect(
          service.validateAndGetUser(`Certificate ${assertion()}`, undefined, {
            transportSocket: tlsSocket(pki.client.der),
          }),
        ).resolves.toBeNull();
      });
    });

    describe('mtls', () => {
      beforeEach(() => {
        process.env.AUTHENTICATION_METHOD = 'mtls';
        process.env.MTLS_CA_CERT = pki.rootCa.pem;
        process.env.STATIC_API_KEY = 'socket-key';
      });

      it('accepts a certificate assertion as the admin principal', async () => {
        const result = await service.validateAndGetUser(`Certificate ${assertion()}`, undefined, {
          websocket: 'clients',
        });

        expect(result).toEqual({
          isApiKeyAuth: true,
          user: { id: 'mtls-user', roles: ['admin', 'user'] },
          clientCertificate: expect.objectContaining({ source: 'assertion', commonName: 'api-client' }),
        });
        expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      });

      it('accepts a TLS client certificate without an Authorization value', async () => {
        const result = await service.validateAndGetUser(undefined, undefined, {
          websocket: 'clients',
          transportSocket: tlsSocket(pki.client.der),
        });

        expect(result?.isApiKeyAuth).toBe(true);
        expect(result?.clientCertificate?.source).toBe('tls');
      });

      it('rejects untrusted certificates, the API key, JWTs and missing credentials', async () => {
        await expect(service.validateAndGetUser(`Certificate ${assertion(pki.foreignClient)}`)).resolves.toBeNull();
        await expect(
          service.validateAndGetUser(undefined, undefined, { transportSocket: tlsSocket(pki.foreignClient.der) }),
        ).resolves.toBeNull();
        await expect(service.validateAndGetUser('Bearer socket-key')).resolves.toBeNull();
        await expect(service.validateAndGetUser('Bearer valid.jwt.token')).resolves.toBeNull();
        await expect(service.validateAndGetUser(undefined)).resolves.toBeNull();
        expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      });

      it('fails closed when the mTLS configuration is missing', async () => {
        delete process.env.MTLS_CA_CERT;

        await expect(service.validateAndGetUser(`Certificate ${assertion()}`)).resolves.toBeNull();
      });
    });
  });

  describe('oidc mode', () => {
    const syncedUser = {
      id: 'local-1',
      email: 'u@example.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
    };
    let oidcVerifier: { verifyAccessToken: jest.Mock; getEmail: jest.Mock };
    let externalIdentity: { resolveUser: jest.Mock };
    let oidcService: SocketAuthService;

    beforeEach(() => {
      process.env.AUTHENTICATION_METHOD = 'oidc';
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid algorithm'));
      oidcVerifier = {
        verifyAccessToken: jest
          .fn()
          .mockResolvedValue({ sub: 'idp-sub', email: 'u@example.com', email_verified: true }),
        getEmail: jest.fn().mockReturnValue('u@example.com'),
      };
      externalIdentity = { resolveUser: jest.fn().mockResolvedValue(syncedUser) };
      oidcService = new SocketAuthService(
        oidcVerifier as never,
        jwtService as unknown as JwtService,
        usersRepository as unknown as UsersRepository,
        revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
        null,
        null,
        externalIdentity as never,
      );
    });

    it('verifies the access token and maps it to the local user and role', async () => {
      const result = await oidcService.validateAndGetUser('Bearer idp.access.token', 'default');

      expect(oidcVerifier.verifyAccessToken).toHaveBeenCalledWith('idp.access.token');
      expect(externalIdentity.resolveUser).toHaveBeenCalledWith({
        provider: 'oidc',
        subject: 'idp-sub',
        email: 'u@example.com',
        emailVerified: true,
      });
      expect(result).toEqual(
        expect.objectContaining({ userId: 'local-1', userRole: UserRole.USER, amr: ['oidc'], isApiKeyAuth: false }),
      );
    });

    it('resolves the identity in the socket tenant, not the (unbound) default tenant', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { getTenantIdOrDefault } = require('@forepath/shared/backend');
      let tenantDuringResolve: string | undefined;

      externalIdentity.resolveUser.mockImplementation(async () => {
        tenantDuringResolve = getTenantIdOrDefault();

        return { ...syncedUser, tenantId: 'acme' };
      });

      await expect(oidcService.validateAndGetUser('Bearer idp.access.token', 'acme')).resolves.toEqual(
        expect.objectContaining({ userId: 'local-1' }),
      );
      expect(tenantDuringResolve).toBe('acme');
    });

    it('never grants admin from IdP role claims', async () => {
      oidcVerifier.verifyAccessToken.mockResolvedValue({
        sub: 'idp-sub',
        realm_access: { roles: ['admin', 'realm-admin'] },
      });

      await expect(oidcService.validateAndGetUser('Bearer idp.access.token')).resolves.toEqual(
        expect.objectContaining({ userRole: UserRole.USER }),
      );
    });

    it('rejects invalid tokens, locked users and other tenants', async () => {
      oidcVerifier.verifyAccessToken.mockRejectedValueOnce(new Error('bad'));
      await expect(oidcService.validateAndGetUser('Bearer bad')).resolves.toBeNull();

      externalIdentity.resolveUser.mockRejectedValueOnce(new Error('locked'));
      await expect(oidcService.validateAndGetUser('Bearer t')).resolves.toBeNull();

      await expect(oidcService.validateAndGetUser('Bearer t', 'other-tenant')).resolves.toBeNull();
    });
  });

  it('rejects password sessions on saml-mode sockets (method switched)', async () => {
    process.env.AUTHENTICATION_METHOD = 'saml';
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@b.com', roles: [UserRole.ADMIN], tv: 0 });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 0,
    } as never);

    await expect(service.validateAndGetUser('Bearer pwd.session.jwt')).resolves.toBeNull();
  });

  it('validates saml-mode sockets with the app session JWT (like users mode)', async () => {
    process.env.AUTHENTICATION_METHOD = 'saml';
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.USER],
      amr: ['saml'],
      tv: 0,
    });
    usersRepository.findById.mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 0,
    } as never);

    await expect(service.validateAndGetUser('Bearer saml.session.jwt')).resolves.toEqual(
      expect.objectContaining({ userId: 'user-1', amr: ['saml'] }),
    );
  });

  describe('machine tokens (PAT / app access tokens)', () => {
    const machineVerifiers = () => ({
      personalAccessTokenService: { assertPatJwtActive: jest.fn() },
      appAuthorizationService: { assertAppJwtActive: jest.fn() },
    });
    let verifiers: ReturnType<typeof machineVerifiers>;
    let machineService: SocketAuthService;
    const activeUser = {
      id: 'user-1',
      email: 'a@b.com',
      tenantId: 'default',
      lockedAt: null,
      tokenVersion: 0,
      role: UserRole.ADMIN,
    };
    const patPayload = (scopes: string[]) => ({
      sub: 'user-1',
      email: 'a@b.com',
      roles: [UserRole.ADMIN],
      amr: ['pat'],
      patId: 'pat-1',
      scopes,
      tv: 0,
      jti: 'jti-1',
      exp: 1_900_000_000,
    });

    beforeEach(() => {
      verifiers = machineVerifiers();
      machineService = new SocketAuthService(
        null,
        jwtService as unknown as JwtService,
        usersRepository as unknown as UsersRepository,
        revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
        null,
        verifiers,
      );
      usersRepository.findById.mockResolvedValue(activeUser as never);
    });

    it('rejects PAT JWTs on sockets that are not opened to machine tokens', async () => {
      jwtService.verifyAsync.mockResolvedValue(patPayload(['websocket:clients:read']));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes: ['websocket:clients:read'] });

      await expect(machineService.validateAndGetUser('Bearer pat.jwt')).resolves.toBeNull();
      expect(verifiers.personalAccessTokenService.assertPatJwtActive).not.toHaveBeenCalled();
    });

    it('accepts a PAT JWT with the websocket scope and returns live scopes and the live role', async () => {
      const scopes = ['websocket:clients:read', 'clients:read'];

      jwtService.verifyAsync.mockResolvedValue(patPayload(scopes));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes });

      const result = await machineService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' });

      expect(verifiers.personalAccessTokenService.assertPatJwtActive).toHaveBeenCalledWith('pat-1', 'user-1', scopes);
      expect(result).toEqual({
        userId: 'user-1',
        userRole: UserRole.ADMIN,
        isApiKeyAuth: false,
        amr: ['pat'],
        scopes,
        exp: 1_900_000_000,
        user: { id: 'user-1', email: 'a@b.com', roles: [UserRole.ADMIN], amr: ['pat'], scopes },
      });
    });

    it('accepts the websocket write scope as read (level hierarchy)', async () => {
      const scopes = ['websocket:clients:write'];

      jwtService.verifyAsync.mockResolvedValue(patPayload(scopes));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes });

      await expect(
        machineService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' }),
      ).resolves.toEqual(expect.objectContaining({ scopes }));
    });

    it('rejects a PAT JWT without the scope of this socket', async () => {
      const scopes = ['websocket:tickets:read', 'clients:admin'];

      jwtService.verifyAsync.mockResolvedValue(patPayload(scopes));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes });

      await expect(
        machineService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' }),
      ).resolves.toBeNull();
    });

    it('rejects revoked / changed PAT sessions', async () => {
      jwtService.verifyAsync.mockResolvedValue(patPayload(['websocket:clients:read']));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockRejectedValue(new Error('revoked'));

      await expect(
        machineService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' }),
      ).resolves.toBeNull();
    });

    it('rejects PAT JWTs without a PAT id', async () => {
      jwtService.verifyAsync.mockResolvedValue({ ...patPayload(['websocket:clients:read']), patId: undefined });

      await expect(
        machineService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' }),
      ).resolves.toBeNull();
      expect(verifiers.personalAccessTokenService.assertPatJwtActive).not.toHaveBeenCalled();
    });

    it('validates app access tokens against the live app session', async () => {
      const scopes = ['websocket:billing:read', 'subscriptions:read'];

      jwtService.verifyAsync.mockResolvedValue({
        ...patPayload(scopes),
        amr: ['pat', 'app'],
        patId: undefined,
        appId: 'app-1',
        appSessionId: 'session-1',
      });
      verifiers.appAuthorizationService.assertAppJwtActive.mockResolvedValue({ scopes });

      const result = await machineService.validateAndGetUser('Bearer app.jwt', 'default', { websocket: 'billing' });

      expect(verifiers.appAuthorizationService.assertAppJwtActive).toHaveBeenCalledWith({
        appSessionId: 'session-1',
        appId: 'app-1',
        userId: 'user-1',
        jwtScopes: scopes,
      });
      expect(verifiers.personalAccessTokenService.assertPatJwtActive).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ amr: ['pat', 'app'], scopes }));
    });

    it.each([
      ['locked users', { lockedAt: new Date() }, undefined],
      ['another tenant', { tenantId: 'tenant-b' }, undefined],
      ['a tenant other than the handshake tenant', {}, 'tenant-b'],
      ['an outdated token version', { tokenVersion: 3 }, undefined],
    ])('rejects %s', async (_label, userOverrides, tenantId) => {
      const scopes = ['websocket:clients:read'];

      usersRepository.findById.mockResolvedValue({ ...activeUser, ...userOverrides } as never);
      jwtService.verifyAsync.mockResolvedValue(patPayload(scopes));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes });

      await expect(
        machineService.validateAndGetUser('Bearer pat.jwt', tenantId as string | undefined, { websocket: 'clients' }),
      ).resolves.toBeNull();
    });

    it('rejects revoked JWT ids', async () => {
      const scopes = ['websocket:clients:read'];

      jwtService.verifyAsync.mockResolvedValue(patPayload(scopes));
      revokedUserTokensRepository.isRevoked.mockResolvedValue(true);
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes });

      await expect(
        machineService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' }),
      ).resolves.toBeNull();
    });

    it('fails closed when no machine token verifiers are registered (e.g. api-key apps)', async () => {
      const unwired = new SocketAuthService(
        null,
        jwtService as unknown as JwtService,
        usersRepository as unknown as UsersRepository,
        revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
        {
          get: jest.fn(() => {
            throw new Error('not found');
          }),
        } as never,
      );

      jwtService.verifyAsync.mockResolvedValue(patPayload(['websocket:clients:read']));

      await expect(
        unwired.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' }),
      ).resolves.toBeNull();
    });

    it('resolves verifiers from the application module graph', async () => {
      const scopes = ['websocket:clients:read'];
      const get = jest.fn((token: { name: string }) =>
        token.name === 'PersonalAccessTokenService'
          ? verifiers.personalAccessTokenService
          : verifiers.appAuthorizationService,
      );
      const wired = new SocketAuthService(
        null,
        jwtService as unknown as JwtService,
        usersRepository as unknown as UsersRepository,
        revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
        { get } as never,
      );

      jwtService.verifyAsync.mockResolvedValue(patPayload(scopes));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes });

      await expect(wired.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'clients' })).resolves.toEqual(
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(get).toHaveBeenCalledWith(expect.anything(), { strict: false });
    });

    it('keeps interactive users-mode JWTs on the existing path', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@b.com', roles: [UserRole.USER], tv: 0 });

      const result = await machineService.validateAndGetUser('Bearer pwd.jwt', undefined, { websocket: 'clients' });

      expect(result).toEqual(expect.objectContaining({ userId: 'user-1', amr: ['pwd'] }));
      expect(result?.scopes).toBeUndefined();
      expect(verifiers.personalAccessTokenService.assertPatJwtActive).not.toHaveBeenCalled();
    });

    it('accepts oidc-mode PAT JWTs for opened sockets without OIDC validation', async () => {
      process.env.AUTHENTICATION_METHOD = 'oidc';
      const oidcVerifier = { verifyAccessToken: jest.fn(), getEmail: jest.fn() };
      const oidcService = new SocketAuthService(
        oidcVerifier as never,
        jwtService as unknown as JwtService,
        usersRepository as unknown as UsersRepository,
        revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
        null,
        verifiers,
      );
      const scopes = ['websocket:status:read'];

      jwtService.verifyAsync.mockResolvedValue(patPayload(scopes));
      verifiers.personalAccessTokenService.assertPatJwtActive.mockResolvedValue({ scopes });

      await expect(
        oidcService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'status' }),
      ).resolves.toEqual(expect.objectContaining({ userId: 'user-1', scopes }));
      expect(oidcVerifier.verifyAccessToken).not.toHaveBeenCalled();
    });
  });
});
