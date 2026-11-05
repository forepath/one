import { createHash, randomUUID } from 'node:crypto';

import type {
  IdentityAppAuthorizationCodeEntity,
  IdentityAppEntity,
  IdentityAppGrantEntity,
  IdentityAppSessionEntity,
} from '@forepath/identity/backend';
import { UserRole } from '@forepath/identity/backend';
import { runWithTenantId } from '@forepath/shared/backend';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { APP_AUTHORIZATION_2FA_REQUIRED_CODE } from '../constants/app.constants';

import { IdentityAppAuthorizationService } from './identity-app-authorization.service';
import { PersonalAccessTokenService } from './personal-access-token.service';

const CATALOG = ['tickets:read', 'tickets:write', 'users:admin'] as const;
const SECRET = 'fp_aps_' + 'a'.repeat(43);

/** Minimal in-memory IdentityAppsRepository (same semantics as the TypeORM one, incl. cascades). */
class FakeAppsRepository {
  apps = new Map<string, IdentityAppEntity>();
  grants = new Map<string, IdentityAppGrantEntity>();
  sessions = new Map<string, IdentityAppSessionEntity>();
  codes = new Map<string, IdentityAppAuthorizationCodeEntity>();

  async findAppForTenant(id: string, tenantId: string) {
    const app = this.apps.get(id);

    return app && app.tenantId === tenantId ? app : null;
  }
  async findAppById(id: string) {
    return this.apps.get(id) ?? null;
  }
  async findGrant(appId: string, userId: string) {
    return [...this.grants.values()].find((g) => g.appId === appId && g.userId === userId) ?? null;
  }
  async findGrantById(id: string) {
    return this.grants.get(id) ?? null;
  }
  async upsertGrant(data: { appId: string; userId: string; tenantId: string; scopes: string[] }) {
    const existing = await this.findGrant(data.appId, data.userId);

    if (existing) {
      existing.scopes = [...data.scopes];

      return existing;
    }

    const grant = { ...data, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() } as IdentityAppGrantEntity;

    this.grants.set(grant.id, grant);

    return grant;
  }
  async deleteGrant(id: string) {
    this.grants.delete(id);
    [...this.sessions.values()].filter((s) => s.grantId === id).forEach((s) => this.sessions.delete(s.id));
    [...this.codes.values()].filter((c) => c.grantId === id).forEach((c) => this.codes.delete(c.id));

    return true;
  }
  async touchGrantLastUsed() {
    /* noop */
  }
  async createCode(data: Partial<IdentityAppAuthorizationCodeEntity>) {
    const code = { ...data, id: randomUUID(), consumedAt: null, sessionId: null } as IdentityAppAuthorizationCodeEntity;

    this.codes.set(code.id, code);

    return code;
  }
  async findCodeByHash(codeHash: string) {
    return [...this.codes.values()].find((c) => c.codeHash === codeHash) ?? null;
  }
  async consumeCode(id: string, at: Date) {
    const code = this.codes.get(id);

    if (!code || code.consumedAt) {
      return false;
    }

    code.consumedAt = at;

    return true;
  }
  async setCodeSession(id: string, sessionId: string) {
    (this.codes.get(id) as IdentityAppAuthorizationCodeEntity).sessionId = sessionId;
  }
  async deleteExpiredCodes() {
    /* noop */
  }
  async createSession(data: Partial<IdentityAppSessionEntity>) {
    const session = { ...data, id: randomUUID(), createdAt: new Date() } as IdentityAppSessionEntity;

    this.sessions.set(session.id, session);

    return session;
  }
  async findSessionById(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async findSessionByRefreshHash(hash: string) {
    return [...this.sessions.values()].find((s) => s.refreshTokenHash === hash) ?? null;
  }
  async findSessionByPreviousRefreshHash(hash: string) {
    return [...this.sessions.values()].find((s) => s.previousRefreshTokenHash === hash) ?? null;
  }
  async rotateSessionRefreshToken(id: string, expected: string, next: string, at: Date) {
    const session = this.sessions.get(id);

    if (!session || session.refreshTokenHash !== expected) {
      return false;
    }

    session.previousRefreshTokenHash = expected;
    session.refreshTokenHash = next;
    session.refreshedAt = at;

    return true;
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async touchSessionLastUsed() {
    /* noop */
  }
}

describe('IdentityAppAuthorizationService', () => {
  let repository: FakeAppsRepository;
  let users: Map<string, Record<string, unknown>>;
  let authService: {
    getSecondFactorMethod: jest.Mock;
    verifySecondFactor: jest.Mock;
    issueAppAccessToken: jest.Mock;
  };
  let service: IdentityAppAuthorizationService;
  let app: IdentityAppEntity;
  let secretHash: string;

  beforeAll(async () => {
    secretHash = await bcrypt.hash(SECRET, 4);
  });

  const user = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'user@example.com',
    role: UserRole.USER,
    tenantId: 'default',
    passwordHash: 'hash',
    emailConfirmedAt: new Date(),
    lockedAt: null,
    tokenVersion: 0,
    ...overrides,
  });

  beforeEach(() => {
    repository = new FakeAppsRepository();
    users = new Map([['user-1', user()]]);
    authService = {
      getSecondFactorMethod: jest.fn().mockReturnValue(null),
      verifySecondFactor: jest.fn().mockResolvedValue(undefined),
      issueAppAccessToken: jest.fn().mockReturnValue({ accessToken: 'jwt', expiresIn: 3600 }),
    };
    app = {
      id: randomUUID(),
      tenantId: 'default',
      name: 'Integration',
      description: 'Syncs tickets',
      returnUrl: 'https://app.example.com/callback',
      scopes: ['tickets:read', 'users:admin'],
      secretPrefix: SECRET.slice(0, 15),
      secretHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IdentityAppEntity;
    repository.apps.set(app.id, app);

    const usersRepository = { findById: jest.fn(async (id: string) => users.get(id) ?? null) };
    const patService = new PersonalAccessTokenService({} as never, usersRepository as never, CATALOG);

    service = new IdentityAppAuthorizationService(
      repository as never,
      usersRepository as never,
      patService,
      authService as never,
      CATALOG,
    );
  });

  const approve = async (overrides: Record<string, unknown> = {}) =>
    new URL(await service.approve('user-1', { appId: app.id, state: 'xyz', ...overrides }));
  const exchange = (code: string, extra: Record<string, unknown> = {}) =>
    service.exchangeAuthorizationCode({ appId: app.id, appSecret: SECRET, code, ...extra });

  it('shows only the scopes the user can grant and the second factor on first authorization', async () => {
    authService.getSecondFactorMethod.mockReturnValue('totp');

    const info = await service.getAuthorizationInfo('user-1', app.id);

    expect(info.app).toMatchObject({ id: app.id, name: 'Integration', description: 'Syncs tickets' });
    expect(info.grantableScopes).toEqual(['tickets:read']);
    expect(info.ungrantableScopes).toEqual(['users:admin']);
    expect(info.alreadyAuthorized).toBe(false);
    expect(info.secondFactor).toBe('totp');
  });

  it('does not leak apps of another tenant', async () => {
    await expect(runWithTenantId('acme', () => service.getAuthorizationInfo('user-1', app.id))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('approves with the second factor, stores only grantable scopes and redirects with a code', async () => {
    const url = await approve({});

    expect(authService.verifySecondFactor).toHaveBeenCalledTimes(1);
    expect(url.origin + url.pathname).toBe('https://app.example.com/callback');
    expect(url.searchParams.get('status')).toBe('approved');
    expect(url.searchParams.get('app_id')).toBe(app.id);
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('code')).toMatch(/^fp_apc_/);

    const [grant] = [...repository.grants.values()];

    expect(grant.scopes).toEqual(['tickets:read']);
    // Only the hash of the code is persisted.
    expect([...repository.codes.values()][0].codeHash).toHaveLength(64);
    expect([...repository.codes.values()][0].codeHash).not.toContain('fp_apc_');
  });

  it('propagates a missing second factor without creating a grant', async () => {
    authService.verifySecondFactor.mockRejectedValue(
      new UnauthorizedException({ code: APP_AUTHORIZATION_2FA_REQUIRED_CODE, method: 'email' }),
    );

    await expect(approve()).rejects.toThrow(UnauthorizedException);
    expect(repository.grants.size).toBe(0);
    expect(repository.codes.size).toBe(0);
  });

  it('skips consent and 2FA when an up-to-date grant exists', async () => {
    await approve();
    authService.verifySecondFactor.mockClear();

    const info = await service.getAuthorizationInfo('user-1', app.id);

    expect(info.alreadyAuthorized).toBe(true);
    expect(info.secondFactor).toBeNull();

    const url = await approve();

    expect(url.searchParams.get('code')).toMatch(/^fp_apc_/);
    expect(authService.verifySecondFactor).not.toHaveBeenCalled();
  });

  it('asks for re-authorization (with 2FA) after the app gained a scope', async () => {
    app.scopes = ['tickets:read'];
    await approve();
    app.scopes = ['tickets:read', 'tickets:write'];
    authService.verifySecondFactor.mockClear();

    expect((await service.getAuthorizationInfo('user-1', app.id)).alreadyAuthorized).toBe(false);

    await approve();

    expect(authService.verifySecondFactor).toHaveBeenCalledTimes(1);
    expect([...repository.grants.values()][0].scopes).toEqual(['tickets:read', 'tickets:write']);
  });

  it('redirects with invalid_scope when the user cannot grant any requested scope', async () => {
    app.scopes = ['users:admin'];

    const url = await approve();

    expect(url.searchParams.get('status')).toBe('error');
    expect(url.searchParams.get('error')).toBe('invalid_scope');
    expect(url.searchParams.has('code')).toBe(false);
    expect(repository.grants.size).toBe(0);
  });

  it('denies with access_denied and keeps an existing grant', async () => {
    await approve();

    const url = new URL(await service.deny('user-1', { appId: app.id, state: 's' }));

    expect(url.searchParams.get('status')).toBe('denied');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('s');
    expect(repository.grants.size).toBe(1);
  });

  describe('token endpoint', () => {
    it('exchanges a code once for access + refresh token with effective scopes', async () => {
      const code = (await approve()).searchParams.get('code') as string;
      const tokens = await exchange(code);

      expect(tokens).toMatchObject({
        access_token: 'jwt',
        token_type: 'Bearer',
        expires_in: 3600,
        scopes: ['tickets:read'],
        scope: 'tickets:read',
        reauthorization_required: false,
        user: { id: 'user-1', role: UserRole.USER },
      });
      expect(tokens.refresh_token).toMatch(/^fp_apr_/);
      expect(authService.issueAppAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        expect.objectContaining({ scopes: ['tickets:read'], appId: app.id }),
      );
      expect(repository.sessions.size).toBe(1);
    });

    it('rejects a wrong secret and unknown apps as invalid_client', async () => {
      const code = (await approve()).searchParams.get('code') as string;

      await expect(exchange(code, { appSecret: 'fp_aps_' + 'b'.repeat(43) })).rejects.toThrow(UnauthorizedException);
      await expect(service.exchangeAuthorizationCode({ appId: randomUUID(), appSecret: SECRET, code })).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.exchangeAuthorizationCode({ appId: 'nope', appSecret: SECRET, code })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a code of another app', async () => {
      const code = (await approve()).searchParams.get('code') as string;
      const other = { ...app, id: randomUUID() };

      repository.apps.set(other.id, other);

      await expect(service.exchangeAuthorizationCode({ appId: other.id, appSecret: SECRET, code })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('revokes the session created by a code when the code is replayed', async () => {
      const code = (await approve()).searchParams.get('code') as string;

      await exchange(code);
      expect(repository.sessions.size).toBe(1);

      await expect(exchange(code)).rejects.toThrow(BadRequestException);
      expect(repository.sessions.size).toBe(0);
    });

    it('rejects expired codes', async () => {
      const code = (await approve()).searchParams.get('code') as string;

      [...repository.codes.values()][0].expiresAt = new Date(Date.now() - 1);

      await expect(exchange(code)).rejects.toThrow(BadRequestException);
    });

    it('enforces PKCE when a challenge was sent', async () => {
      const verifier = 'v'.repeat(64);
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const code = (await approve({ codeChallenge: challenge, codeChallengeMethod: 'S256' })).searchParams.get(
        'code',
      ) as string;

      await expect(exchange(code)).rejects.toThrow(BadRequestException);

      const code2 = (await approve({ codeChallenge: challenge, codeChallengeMethod: 'S256' })).searchParams.get(
        'code',
      ) as string;

      await expect(exchange(code2, { codeVerifier: verifier })).resolves.toMatchObject({ token_type: 'Bearer' });
    });

    it('rejects codes for locked or unconfirmed users', async () => {
      const code = (await approve()).searchParams.get('code') as string;

      users.set('user-1', user({ lockedAt: new Date() }));

      await expect(exchange(code)).rejects.toThrow(BadRequestException);
    });

    it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
      const code = (await approve()).searchParams.get('code') as string;
      const first = await exchange(code);
      const second = await service.refresh({ appId: app.id, appSecret: SECRET, refreshToken: first.refresh_token });

      expect(second.refresh_token).not.toBe(first.refresh_token);
      expect(repository.sessions.size).toBe(1);

      await expect(
        service.refresh({ appId: app.id, appSecret: SECRET, refreshToken: first.refresh_token }),
      ).rejects.toThrow(BadRequestException);
      // Replay of the rotated token = theft signal: the session is gone, the current token too.
      expect(repository.sessions.size).toBe(0);
      await expect(
        service.refresh({ appId: app.id, appSecret: SECRET, refreshToken: second.refresh_token }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stops refreshing once the grant was revoked', async () => {
      const code = (await approve()).searchParams.get('code') as string;
      const first = await exchange(code);

      await repository.deleteGrant([...repository.grants.keys()][0]);

      await expect(
        service.refresh({ appId: app.id, appSecret: SECRET, refreshToken: first.refresh_token }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reports pending re-authorization but keeps the consented scopes', async () => {
      app.scopes = ['tickets:read'];

      const code = (await approve()).searchParams.get('code') as string;
      const first = await exchange(code);

      app.scopes = ['tickets:read', 'tickets:write'];

      const refreshed = await service.refresh({
        appId: app.id,
        appSecret: SECRET,
        refreshToken: first.refresh_token,
      });

      expect(refreshed.scopes).toEqual(['tickets:read']);
      expect(refreshed.reauthorization_required).toBe(true);
    });
  });

  describe('assertAppJwtActive', () => {
    const activeSession = async () => {
      const code = (await approve()).searchParams.get('code') as string;

      await exchange(code);

      return [...repository.sessions.values()][0];
    };

    it('accepts matching scopes and returns the effective scopes', async () => {
      const session = await activeSession();

      await expect(
        service.assertAppJwtActive({
          appSessionId: session.id,
          appId: app.id,
          userId: 'user-1',
          jwtScopes: ['tickets:read'],
        }),
      ).resolves.toEqual({ scopes: ['tickets:read'], appId: app.id, appSessionId: session.id });
    });

    it('rejects when scopes drifted (app must refresh)', async () => {
      const session = await activeSession();

      await expect(
        service.assertAppJwtActive({
          appSessionId: session.id,
          appId: app.id,
          userId: 'user-1',
          jwtScopes: ['tickets:read', 'users:admin'],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects after the grant is revoked, the app is deleted or the user is locked', async () => {
      const session = await activeSession();
      const input = { appSessionId: session.id, appId: app.id, userId: 'user-1', jwtScopes: ['tickets:read'] };

      users.set('user-1', user({ lockedAt: new Date() }));
      await expect(service.assertAppJwtActive(input)).rejects.toThrow(UnauthorizedException);

      users.set('user-1', user());
      repository.apps.delete(app.id);
      await expect(service.assertAppJwtActive(input)).rejects.toThrow(UnauthorizedException);

      repository.apps.set(app.id, app);
      await repository.deleteGrant(session.grantId);
      await expect(service.assertAppJwtActive(input)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a session presented for another user or app', async () => {
      const session = await activeSession();

      await expect(
        service.assertAppJwtActive({
          appSessionId: session.id,
          appId: app.id,
          userId: 'user-2',
          jwtScopes: ['tickets:read'],
        }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.assertAppJwtActive({
          appSessionId: session.id,
          appId: randomUUID(),
          userId: 'user-1',
          jwtScopes: ['tickets:read'],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
