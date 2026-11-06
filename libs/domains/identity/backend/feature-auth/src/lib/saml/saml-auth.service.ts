import { randomBytes } from 'node:crypto';

import {
  getTenantId,
  getTenantIdOrDefault,
  resolveTenantIdFromHeader,
  runWithTenantId,
} from '@forepath/shared/backend';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { type Profile, SAML, type SamlConfig } from '@node-saml/node-saml';

import {
  SAML_LOGIN_CODE_PREFIX,
  SAML_LOGIN_CODE_TTL_MS,
  SAML_LOGIN_ERROR_CODE,
  SAML_REQUEST_TTL_MS,
  SAML_RESPONSE_MAX_LENGTH,
  SAML_SESSION_AMR,
} from '../constants/saml.constants';
import { ExternalAuthStatesRepository } from '../repositories/external-auth-states.repository';
import { UsersRepository } from '../repositories/users.repository';
import { AuthService } from '../services/auth.service';
import { ExternalIdentityService } from '../services/external-identity.service';
import { generateAppCredential, verifyPkceS256 } from '../utils/identity-app.utils';

import { SamlStateCacheProvider } from './saml-state-cache.provider';
import {
  readSamlServiceProviderConfig,
  SAML_DEFAULT_EMAIL_ATTRIBUTES,
  type SamlServiceProviderConfig,
} from './saml.config';

const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const NAMEID_FORMAT_TRANSIENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';
const NAMEID_FORMAT_EMAIL = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const MAX_REDIRECT_PATH_LENGTH = 2048;

/**
 * Same-origin console path after sign-in. Anything that could leave the origin (absolute URLs,
 * protocol-relative `//host`, backslashes, control characters) falls back to `/`.
 */
export function sanitizeSamlRedirectPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REDIRECT_PATH_LENGTH) {
    return '/';
  }

  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || hasControlCharacter(value)) {
    return '/';
  }

  return value;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(firstString).find((entry) => entry !== undefined);
  }

  return undefined;
}

/**
 * SAML 2.0 service provider (`AUTHENTICATION_METHOD=saml`).
 *
 * Flow: console → `GET /auth/saml/login` (PKCE challenge) → IdP → `POST /auth/saml/acs` → console callback with a
 * one-time code → `POST /auth/saml/token` (code + verifier) → app session JWT (`amr: ['saml']`).
 *
 * Security properties:
 * - Signed assertions/responses only (node-saml), exact audience (SP entity id), optional IdP issuer pinning.
 * - Unsolicited (IdP-initiated) responses are rejected: `InResponseTo` must match an outstanding request id, which is
 *   consumed atomically; assertion ids are remembered to reject replays.
 * - RelayState is an opaque random key bound to the request id; the browser that started sign-in must present the
 *   PKCE verifier to redeem the code (blocks login CSRF and code interception).
 */
@Injectable()
export class SamlAuthService {
  private readonly logger = new Logger(SamlAuthService.name);
  private config: SamlServiceProviderConfig | null = null;

  constructor(
    private readonly states: ExternalAuthStatesRepository,
    private readonly externalIdentityService: ExternalIdentityService,
    private readonly usersRepository: UsersRepository,
    private readonly authService: AuthService,
  ) {}

  getConfig(): SamlServiceProviderConfig {
    if (!this.config) {
      this.config = readSamlServiceProviderConfig();
    }

    return this.config;
  }

  /** Builds the IdP redirect URL for a new sign-in. */
  async createLoginRedirect(codeChallenge: unknown, redirect: unknown, tenant?: unknown): Promise<string> {
    if (typeof codeChallenge !== 'string' || !PKCE_CHALLENGE_PATTERN.test(codeChallenge)) {
      throw new UnauthorizedException('A valid PKCE code_challenge (S256) is required.');
    }

    // Browser navigation cannot send `x-tenant`: the console passes `tenant` explicitly (validated against TENANTS,
    // same rules as the header); without it the request's tenant context (or the default tenant) applies.
    const tenantId =
      typeof tenant === 'string' && tenant.trim().length > 0
        ? resolveTenantIdFromHeader(tenant)
        : (getTenantId() ?? resolveTenantIdFromHeader(undefined));

    if (!tenantId) {
      throw new UnauthorizedException('Invalid or unknown tenant.');
    }

    return runWithTenantId(tenantId, () => this.startLogin(codeChallenge, redirect));
  }

  private async startLogin(codeChallenge: string, redirect: unknown): Promise<string> {
    // xs:ID values must not start with a digit.
    const requestId = `_${randomBytes(20).toString('hex')}`;
    const relayState = randomBytes(32).toString('base64url');

    await this.states.save('saml_relay', relayState, new Date(Date.now() + SAML_REQUEST_TTL_MS), {
      requestId,
      codeChallenge,
      redirectPath: sanitizeSamlRedirectPath(redirect),
    });

    return this.createSaml(() => requestId).getAuthorizeUrlAsync(relayState, {});
  }

  /**
   * Validates an IdP response posted to the ACS and returns the console callback URL
   * (with a one-time code on success, `error=saml_failed` otherwise).
   */
  async handleAssertionConsumerService(body: Record<string, unknown> | undefined): Promise<string> {
    const callbackUrl = new URL(this.getConfig().frontendCallbackUrl);

    try {
      const { code, redirectPath } = await this.consumeResponse(body);

      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('redirect', redirectPath);
    } catch (error) {
      this.logger.warn(`SAML sign-in rejected: ${(error as Error).message}`);
      callbackUrl.searchParams.set('error', SAML_LOGIN_ERROR_CODE);
    }

    return callbackUrl.toString();
  }

  /** Redeems a one-time login code for a console session JWT. */
  async exchangeCode(code: unknown, codeVerifier: unknown): Promise<{ access_token: string }> {
    if (
      typeof code !== 'string' ||
      !code.startsWith(SAML_LOGIN_CODE_PREFIX) ||
      typeof codeVerifier !== 'string' ||
      !PKCE_VERIFIER_PATTERN.test(codeVerifier)
    ) {
      throw new UnauthorizedException('Invalid or expired login code.');
    }

    const state = await this.states.consume('saml_code', code);

    if (!state?.userId || !state.codeChallenge || !verifyPkceS256(codeVerifier, state.codeChallenge)) {
      throw new UnauthorizedException('Invalid or expired login code.');
    }

    const user = await this.usersRepository.findById(state.userId);

    if (!user || user.tenantId !== getTenantIdOrDefault() || user.externalProvider !== 'saml') {
      throw new UnauthorizedException('Invalid or expired login code.');
    }

    if (user.lockedAt) {
      throw new UnauthorizedException('This account is locked. Please contact an administrator.');
    }

    return { access_token: this.authService.issueExternalSessionToken(user, SAML_SESSION_AMR) };
  }

  /** SP metadata for configuring the IdP. */
  getServiceProviderMetadata(): string {
    return this.createSaml().generateServiceProviderMetadata(null, null);
  }

  private async consumeResponse(
    body: Record<string, unknown> | undefined,
  ): Promise<{ code: string; redirectPath: string }> {
    const samlResponse = body?.SAMLResponse;
    const relayState = body?.RelayState;

    if (
      typeof samlResponse !== 'string' ||
      samlResponse.length === 0 ||
      samlResponse.length > SAML_RESPONSE_MAX_LENGTH
    ) {
      throw new Error('missing or oversized SAMLResponse');
    }

    if (typeof relayState !== 'string' || relayState.length === 0 || relayState.length > 256) {
      throw new Error('missing RelayState (IdP-initiated sign-in is not supported)');
    }

    // The ACS post carries no tenant header: the tenant travels in the single-use relay state.
    const relay = await this.states.consumeForAnyTenant('saml_relay', relayState);

    if (!relay?.requestId || !relay.codeChallenge) {
      throw new Error('unknown or expired RelayState');
    }

    return runWithTenantId(relay.tenantId, () => this.completeResponse(samlResponse, relayState, relay));
  }

  private async completeResponse(
    samlResponse: string,
    relayState: string,
    relay: { requestId?: string | null; codeChallenge?: string | null; redirectPath?: string | null },
  ): Promise<{ code: string; redirectPath: string }> {
    const { profile, loggedOut } = await this.createSaml().validatePostResponseAsync({
      SAMLResponse: samlResponse,
      RelayState: relayState,
    });

    if (loggedOut || !profile) {
      throw new Error('response carries no assertion');
    }

    if (profile.inResponseTo !== relay.requestId) {
      throw new Error('response does not answer the request bound to RelayState');
    }

    const subject = firstString(profile.nameID);

    if (!subject) {
      throw new Error('assertion has no NameID');
    }

    if (profile.nameIDFormat === NAMEID_FORMAT_TRANSIENT) {
      throw new Error('transient NameIDs cannot identify a returning user; configure a persistent NameID format');
    }

    const user = await this.externalIdentityService.resolveUser({
      provider: 'saml',
      subject,
      email: this.readEmail(profile),
    });
    const code = generateAppCredential(SAML_LOGIN_CODE_PREFIX);

    await this.states.save('saml_code', code, new Date(Date.now() + SAML_LOGIN_CODE_TTL_MS), {
      userId: user.id,
      codeChallenge: relay.codeChallenge ?? null,
      redirectPath: relay.redirectPath ?? '/',
    });

    return { code, redirectPath: sanitizeSamlRedirectPath(relay.redirectPath) };
  }

  private readEmail(profile: Profile): string | undefined {
    const configured = this.getConfig().emailAttribute;

    if (configured) {
      return firstString(profile[configured]);
    }

    for (const attribute of SAML_DEFAULT_EMAIL_ATTRIBUTES) {
      const value = firstString(profile[attribute]);

      if (value) {
        return value;
      }
    }

    return profile.nameIDFormat === NAMEID_FORMAT_EMAIL ? firstString(profile.nameID) : undefined;
  }

  private createSaml(generateUniqueId?: () => string): SAML {
    const config = this.getConfig();
    const options: SamlConfig = {
      entryPoint: config.idpSsoUrl,
      idpCert: config.idpCerts,
      issuer: config.spEntityId,
      audience: config.spEntityId,
      callbackUrl: config.acsUrl,
      idpIssuer: config.idpIssuer,
      identifierFormat: config.nameIdFormat,
      wantAssertionsSigned: config.wantAssertionsSigned,
      wantAuthnResponseSigned: config.wantAuthnResponseSigned,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
      acceptedClockSkewMs: config.acceptedClockSkewMs,
      maxAssertionAgeMs: SAML_REQUEST_TTL_MS,
      validateInResponseTo: config.validateInResponseTo,
      requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
      rejectReplayedAssertions: true,
      cacheProvider: new SamlStateCacheProvider(this.states),
      disableRequestedAuthnContext: true,
      ...(config.spPrivateKey ? { privateKey: config.spPrivateKey } : {}),
      ...(config.spDecryptionPrivateKey ? { decryptionPvk: config.spDecryptionPrivateKey } : {}),
      ...(generateUniqueId ? { generateUniqueId } : {}),
    };

    return new SAML(options);
  }
}
