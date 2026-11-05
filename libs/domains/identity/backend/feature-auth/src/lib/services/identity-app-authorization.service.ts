import {
  type IdentityAppEntity,
  type IdentityAppGrantEntity,
  type UserEntity,
  UserRole,
} from '@forepath/identity/backend';
import { DEFAULT_TENANT, getTenantIdOrDefault } from '@forepath/shared/backend';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import {
  APP_AUTHORIZATION_2FA_INVALID_CODE,
  APP_AUTHORIZATION_2FA_REQUIRED_CODE,
  APP_AUTHORIZATION_CODE_PREFIX,
  APP_AUTHORIZATION_CODE_TTL_MS,
  APP_REFRESH_TOKEN_PREFIX,
  APP_SECRET_PREFIX,
  DUMMY_APP_SECRET_BCRYPT_HASH,
  type AppAuthorizationErrorCode,
} from '../constants/app.constants';
import type { Login2faMethod } from '../constants/auth-error.constants';
import { IDENTITY_PAT_SCOPE_CATALOG } from '../constants/pat.constants';
import { IdentityAppsRepository } from '../repositories/identity-apps.repository';
import { UsersRepository } from '../repositories/users.repository';
import {
  buildAppReturnUrl,
  evaluateAppScopes,
  generateAppCredential,
  hashAppCredential,
  sameScopeSet,
  verifyPkceS256,
  type AppScopeEvaluation,
} from '../utils/identity-app.utils';

import { AuthService } from './auth.service';
import { PersonalAccessTokenService } from './personal-access-token.service';

/** Avoid writing last-used timestamps on every authenticated app request. */
const LAST_USED_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface AppAuthorizationRequest {
  appId: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
}

export interface AppAuthorizationInfo {
  app: { id: string; name: string; description: string | null; returnUrl: string };
  /** Scopes the grant will carry (requested ∩ what the user may grant). */
  grantableScopes: string[];
  /** Requested scopes the user's account cannot grant (never granted). */
  ungrantableScopes: string[];
  /** An active grant already covers everything grantable: approval skips consent and 2FA. */
  alreadyAuthorized: boolean;
  /** Second factor required to approve (`null` when none or already authorized). */
  secondFactor: Login2faMethod | null;
}

export interface AppTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
  scopes: string[];
  reauthorization_required: boolean;
  user: { id: string; email: string; role: UserRole };
}

export interface ActiveAppSession {
  scopes: string[];
  appId: string;
  appSessionId: string;
}

/** Token endpoint failure (OAuth-style `error` + description, never revealing which check failed). */
function tokenError(error: AppAuthorizationErrorCode, description: string, status: 400 | 401 = 400): never {
  const body = { error, error_description: description, message: description };

  if (status === 401) {
    throw new UnauthorizedException(body);
  }

  throw new BadRequestException(body);
}

/**
 * Grant flow (GitHub-style app authorization) and app token issuance.
 *
 * Security invariants:
 * - Only interactive sessions reach the grant endpoints (controller: `@RequireInteractiveSession`).
 * - A user only ever grants app scopes their current role may grant; effective scopes are re-capped per request.
 * - Redirects only go to the app's registered return URL.
 * - Codes are single-use (replay revokes the session they created); refresh tokens rotate (replay revokes).
 */
@Injectable()
export class IdentityAppAuthorizationService {
  private readonly logger = new Logger(IdentityAppAuthorizationService.name);

  constructor(
    private readonly repository: IdentityAppsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly patService: PersonalAccessTokenService,
    private readonly authService: AuthService,
    @Inject(IDENTITY_PAT_SCOPE_CATALOG) private readonly scopeCatalog: readonly string[],
  ) {}

  // --- grant page ---

  async getAuthorizationInfo(userId: string, appId: string): Promise<AppAuthorizationInfo> {
    const { app, user, grant, scopes } = await this.loadContext(userId, appId);
    const alreadyAuthorized = Boolean(grant) && !scopes.needsReauthorization && scopes.grantable.length > 0;

    return {
      app: { id: app.id, name: app.name, description: app.description ?? null, returnUrl: app.returnUrl },
      grantableScopes: scopes.grantable,
      ungrantableScopes: scopes.ungrantable,
      alreadyAuthorized,
      secondFactor: alreadyAuthorized ? null : this.authService.getSecondFactorMethod(user),
    };
  }

  /** Approve: (re)consent with 2FA when needed, issue a code, return the redirect to the app. */
  async approve(userId: string, request: AppAuthorizationRequest, secondFactorCode?: string): Promise<string> {
    const { app, user, grant, scopes } = await this.loadContext(userId, request.appId);

    if (scopes.grantable.length === 0) {
      return this.returnUrl(app, request, {
        status: 'error',
        error: 'invalid_scope',
        errorDescription: 'Your account cannot grant any of the permissions this app requests.',
      });
    }

    let activeGrant: IdentityAppGrantEntity | null = grant;

    if (!grant || scopes.needsReauthorization) {
      await this.authService.verifySecondFactor(user, secondFactorCode, {
        required: APP_AUTHORIZATION_2FA_REQUIRED_CODE,
        invalid: APP_AUTHORIZATION_2FA_INVALID_CODE,
      });
      activeGrant = await this.repository.upsertGrant({
        appId: app.id,
        userId: user.id,
        tenantId: app.tenantId,
        scopes: scopes.grantable,
      });
    }

    const code = generateAppCredential(APP_AUTHORIZATION_CODE_PREFIX);

    await this.repository.createCode({
      codeHash: hashAppCredential(code),
      grantId: (activeGrant as IdentityAppGrantEntity).id,
      appId: app.id,
      userId: user.id,
      codeChallenge: request.codeChallenge ?? null,
      expiresAt: new Date(Date.now() + APP_AUTHORIZATION_CODE_TTL_MS),
    });

    // Opportunistic cleanup of stale codes (single-use + short-lived, nothing to keep).
    await this.repository.deleteExpiredCodes(new Date(Date.now() - APP_AUTHORIZATION_CODE_TTL_MS)).catch(() => {
      /* best effort */
    });

    return this.returnUrl(app, request, { status: 'approved', code });
  }

  /** Deny: redirect with `access_denied`; an existing grant stays untouched. */
  async deny(userId: string, request: AppAuthorizationRequest): Promise<string> {
    const { app } = await this.loadContext(userId, request.appId);

    return this.returnUrl(app, request, {
      status: 'denied',
      error: 'access_denied',
      errorDescription: 'The user denied the authorization request.',
    });
  }

  // --- token endpoint ---

  async exchangeAuthorizationCode(input: {
    appId: string;
    appSecret: string;
    code?: string;
    codeVerifier?: string;
  }): Promise<AppTokenResponse> {
    const app = await this.authenticateApp(input.appId, input.appSecret);

    if (!input.code || !input.code.startsWith(APP_AUTHORIZATION_CODE_PREFIX)) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    const code = await this.repository.findCodeByHash(hashAppCredential(input.code));

    if (!code || code.appId !== app.id) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    if (code.consumedAt) {
      // Replay: the code leaked or was intercepted - kill whatever it produced.
      if (code.sessionId) {
        await this.repository.deleteSession(code.sessionId);
        this.logger.warn(`Authorization code replay for app ${app.id}; revoked session ${code.sessionId}`);
      }

      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    if (code.expiresAt.getTime() < Date.now()) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    if (code.codeChallenge && (!input.codeVerifier || !verifyPkceS256(input.codeVerifier, code.codeChallenge))) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    if (!(await this.repository.consumeCode(code.id, new Date()))) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    const grant = await this.repository.findGrantById(code.grantId);

    if (!grant || grant.appId !== app.id || grant.userId !== code.userId) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    const user = await this.loadEligibleUser(grant.userId, app.tenantId);

    if (!user) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    const scopes = this.evaluate(app, user, grant);

    if (scopes.effective.length === 0) {
      tokenError('invalid_grant', 'Invalid authorization code.');
    }

    const refreshToken = generateAppCredential(APP_REFRESH_TOKEN_PREFIX);
    const now = new Date();
    const session = await this.repository.createSession({
      grantId: grant.id,
      appId: app.id,
      userId: user.id,
      refreshTokenHash: hashAppCredential(refreshToken),
      lastUsedAt: now,
    });

    await this.repository.setCodeSession(code.id, session.id);
    await this.repository.touchGrantLastUsed(grant.id, now);

    return this.tokenResponse(user, app, session.id, scopes, refreshToken);
  }

  async refresh(input: { appId: string; appSecret: string; refreshToken?: string }): Promise<AppTokenResponse> {
    const app = await this.authenticateApp(input.appId, input.appSecret);

    if (!input.refreshToken || !input.refreshToken.startsWith(APP_REFRESH_TOKEN_PREFIX)) {
      tokenError('invalid_grant', 'Invalid refresh token.');
    }

    const presentedHash = hashAppCredential(input.refreshToken);
    const session = await this.repository.findSessionByRefreshHash(presentedHash);

    if (!session) {
      const rotatedAway = await this.repository.findSessionByPreviousRefreshHash(presentedHash);

      if (rotatedAway && rotatedAway.appId === app.id) {
        // Reuse of a rotated refresh token: assume theft and revoke the session.
        await this.repository.deleteSession(rotatedAway.id);
        this.logger.warn(`Refresh token replay for app ${app.id}; revoked session ${rotatedAway.id}`);
      }

      tokenError('invalid_grant', 'Invalid refresh token.');
    }

    if (session.appId !== app.id) {
      tokenError('invalid_grant', 'Invalid refresh token.');
    }

    const grant = await this.repository.findGrantById(session.grantId);
    const user = grant ? await this.loadEligibleUser(grant.userId, app.tenantId) : null;

    if (!grant || !user || grant.userId !== session.userId) {
      tokenError('invalid_grant', 'Invalid refresh token.');
    }

    const scopes = this.evaluate(app, user, grant);

    if (scopes.effective.length === 0) {
      tokenError('invalid_grant', 'Invalid refresh token.');
    }

    const nextRefreshToken = generateAppCredential(APP_REFRESH_TOKEN_PREFIX);
    const now = new Date();
    const rotated = await this.repository.rotateSessionRefreshToken(
      session.id,
      presentedHash,
      hashAppCredential(nextRefreshToken),
      now,
    );

    if (!rotated) {
      tokenError('invalid_grant', 'Invalid refresh token.');
    }

    await this.repository.touchGrantLastUsed(grant.id, now);

    return this.tokenResponse(user, app, session.id, scopes, nextRefreshToken);
  }

  // --- per-request validation of app JWTs ---

  /**
   * Live validation for an app access JWT: session, grant and app still exist, the user is eligible, and the
   * JWT scopes equal the current effective scopes (else the app must refresh). Returns the effective scopes.
   */
  async assertAppJwtActive(input: {
    appSessionId?: string;
    appId?: string;
    userId: string;
    jwtScopes?: string[];
  }): Promise<ActiveAppSession> {
    const invalid = (): never => {
      throw new UnauthorizedException('Session is no longer valid.');
    };

    if (!input.appSessionId || !input.appId) {
      invalid();
    }

    const session = await this.repository.findSessionById(input.appSessionId as string);

    if (!session || session.userId !== input.userId || session.appId !== input.appId) {
      invalid();
    }

    const activeSession = session as NonNullable<typeof session>;
    const [app, grant] = await Promise.all([
      this.repository.findAppById(activeSession.appId),
      this.repository.findGrantById(activeSession.grantId),
    ]);

    if (!app || !grant || grant.appId !== app.id || grant.userId !== input.userId) {
      invalid();
    }

    const user = await this.loadEligibleUser(input.userId, (app as IdentityAppEntity).tenantId);

    if (!user) {
      invalid();
    }

    const scopes = this.evaluate(app as IdentityAppEntity, user as UserEntity, grant as IdentityAppGrantEntity);

    if (scopes.effective.length === 0 || !sameScopeSet(scopes.effective, input.jwtScopes)) {
      invalid();
    }

    const now = Date.now();

    if (now - (activeSession.lastUsedAt?.getTime() ?? 0) >= LAST_USED_TOUCH_INTERVAL_MS) {
      await this.repository.touchSessionLastUsed(activeSession.id, new Date(now));
    }

    return { scopes: scopes.effective, appId: activeSession.appId, appSessionId: activeSession.id };
  }

  // --- helpers ---

  private async loadContext(userId: string, appId: string) {
    const tenantId = getTenantIdOrDefault();
    const app = await this.repository.findAppForTenant(appId, tenantId);

    if (!app) {
      throw new NotFoundException('App not found');
    }

    const user = await this.usersRepository.findById(userId);

    if (!user || (user.tenantId?.trim() || DEFAULT_TENANT) !== app.tenantId) {
      throw new NotFoundException('App not found');
    }

    const grant = await this.repository.findGrant(app.id, user.id);

    return { app, user, grant, scopes: this.evaluate(app, user, grant) };
  }

  private evaluate(app: IdentityAppEntity, user: UserEntity, grant: IdentityAppGrantEntity | null): AppScopeEvaluation {
    return evaluateAppScopes({
      appScopes: app.scopes,
      catalog: this.scopeCatalog,
      // Live DB role: demotion caps grants immediately.
      roleCatalog: this.patService.getCatalogForRole(user.role),
      consentedScopes: grant?.scopes ?? null,
    });
  }

  /** Same eligibility as PATs: local password or Keycloak-linked, confirmed, not locked, same tenant as the app. */
  private async loadEligibleUser(userId: string, appTenantId: string): Promise<UserEntity | null> {
    const user = await this.usersRepository.findById(userId);

    if (!user || !(user.passwordHash || user.keycloakSub) || !user.emailConfirmedAt || user.lockedAt) {
      return null;
    }

    if ((user.tenantId?.trim() || DEFAULT_TENANT) !== appTenantId) {
      return null;
    }

    return user;
  }

  /** App credentials check (tenant-scoped, constant bcrypt work for unknown apps). */
  private async authenticateApp(appId: string, appSecret: string): Promise<IdentityAppEntity> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId ?? '');
    const app = isUuid ? await this.repository.findAppForTenant(appId, getTenantIdOrDefault()) : null;
    const secretLooksValid = typeof appSecret === 'string' && appSecret.startsWith(APP_SECRET_PREFIX);
    const valid = await bcrypt.compare(
      secretLooksValid ? appSecret : '',
      app?.secretHash ?? DUMMY_APP_SECRET_BCRYPT_HASH,
    );

    if (!app || !secretLooksValid || !valid) {
      tokenError('invalid_client', 'Invalid app credentials.', 401);
    }

    return app;
  }

  private returnUrl(
    app: IdentityAppEntity,
    request: AppAuthorizationRequest,
    params: Omit<Parameters<typeof buildAppReturnUrl>[1], 'appId' | 'state'>,
  ): string {
    return buildAppReturnUrl(app.returnUrl, { ...params, appId: app.id, state: request.state });
  }

  private tokenResponse(
    user: UserEntity,
    app: IdentityAppEntity,
    sessionId: string,
    scopes: AppScopeEvaluation,
    refreshToken: string,
  ): AppTokenResponse {
    const { accessToken, expiresIn } = this.authService.issueAppAccessToken(user, {
      scopes: scopes.effective,
      appId: app.id,
      appSessionId: sessionId,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: scopes.effective.join(' '),
      scopes: scopes.effective,
      reauthorization_required: scopes.needsReauthorization,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
