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
});
