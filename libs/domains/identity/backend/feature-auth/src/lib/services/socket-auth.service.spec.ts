import { UserRole } from '@forepath/identity/backend';
import { JwtService } from '@nestjs/jwt';

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

  it('rejects Keycloak-mode PAT JWTs before OIDC validation', async () => {
    process.env.AUTHENTICATION_METHOD = 'keycloak';
    const keycloak = {
      grantManager: {
        createGrant: jest.fn(),
        validateAccessToken: jest.fn(),
        validateToken: jest.fn(),
      },
    };

    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      amr: ['pat'],
      patId: 't1',
      scopes: ['clients:read'],
    });
    const keycloakService = new SocketAuthService(
      keycloak as never,
      { tokenValidation: 'ONLINE' } as never,
      jwtService as unknown as JwtService,
      usersRepository as unknown as UsersRepository,
      revokedUserTokensRepository as unknown as RevokedUserTokensRepository,
    );
    const result = await keycloakService.validateAndGetUser('Bearer pat.jwt.token');

    expect(result).toBeNull();
    expect(keycloak.grantManager.createGrant).not.toHaveBeenCalled();
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

    it('accepts Keycloak-mode PAT JWTs for opened sockets without OIDC validation', async () => {
      process.env.AUTHENTICATION_METHOD = 'keycloak';
      const keycloak = {
        grantManager: { createGrant: jest.fn(), validateAccessToken: jest.fn(), validateToken: jest.fn() },
      };
      const keycloakService = new SocketAuthService(
        keycloak as never,
        { tokenValidation: 'ONLINE' } as never,
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
        keycloakService.validateAndGetUser('Bearer pat.jwt', undefined, { websocket: 'status' }),
      ).resolves.toEqual(expect.objectContaining({ userId: 'user-1', scopes }));
      expect(keycloak.grantManager.createGrant).not.toHaveBeenCalled();
    });
  });
});
