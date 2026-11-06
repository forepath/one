import { createHash } from 'node:crypto';

import { type ExternalIdentityProvider, UserEntity, UserRole } from '@forepath/identity/backend';
import { getTenantIdOrDefault, parseConfiguredTenants } from '@forepath/shared/backend';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { UsersRepository } from '../repositories/users.repository';

/** Identity asserted by an external provider (verified OIDC access token or validated SAML assertion). */
export interface ExternalIdentityAssertion {
  provider: ExternalIdentityProvider;
  /** OIDC `sub` / SAML NameID. */
  subject: string;
  email?: string;
  /** `false` when the provider says the address is unverified; `undefined` when it does not say. */
  emailVerified?: boolean;
}

/**
 * Whether an asserted email may be trusted: verified by the provider (`email_verified: true`), or — for providers
 * that never send the claim (SAML, some OIDC IdPs) — when the operator opts in with `OIDC_TRUST_EMAIL=true` /
 * `SAML_TRUST_EMAIL=true` because the IdP controls the address. An explicit `false` is never trusted.
 */
export function isTrustedExternalEmail(
  identity: Pick<ExternalIdentityAssertion, 'provider' | 'emailVerified'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (identity.emailVerified === true) {
    return true;
  }

  if (identity.emailVerified === false) {
    return false;
  }

  const flag = identity.provider === 'saml' ? env.SAML_TRUST_EMAIL : env.OIDC_TRUST_EMAIL;

  return flag?.trim().toLowerCase() === 'true';
}

const MAX_SUBJECT_LENGTH = 255;
const MAX_EMAIL_LENGTH = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PG_UNIQUE_VIOLATION = '23505';

/** Parses `email_verified` claims that some providers send as strings. */
export function parseEmailVerifiedClaim(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return undefined;
  }

  return email;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; driverError?: { code?: string } } | undefined;

  return candidate?.code === PG_UNIQUE_VIOLATION || candidate?.driverError?.code === PG_UNIQUE_VIOLATION;
}

/**
 * Tenants in which unknown external identities are created automatically (`EXTERNAL_AUTH_AUTO_PROVISION_TENANTS`):
 * unset or `*` → every tenant (default, backward compatible); `none` → never; otherwise a comma-separated allowlist.
 * Outside the allowlist only existing (or linkable) local accounts can sign in — use it for multi-tenant deployments
 * where one IdP serves several tenants, so an IdP user cannot claim an empty tenant (and become its first admin).
 */
export function isAutoProvisioningAllowed(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.EXTERNAL_AUTH_AUTO_PROVISION_TENANTS?.trim();

  if (!raw || raw === '*') {
    return true;
  }

  if (raw.toLowerCase() === 'none') {
    return false;
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .includes(tenantId);
}

let multiTenantWarningLogged = false;

/** One-time startup hint: with several tenants behind one IdP every IdP user can claim an empty tenant by default. */
function warnAboutMultiTenantAutoProvisioning(logger: Logger): void {
  if (multiTenantWarningLogged || process.env.EXTERNAL_AUTH_AUTO_PROVISION_TENANTS?.trim()) {
    return;
  }

  multiTenantWarningLogged = true;

  if (parseConfiguredTenants().length > 1) {
    logger.warn(
      'Several tenants are configured and EXTERNAL_AUTH_AUTO_PROVISION_TENANTS is unset: any identity of the IdP gets an account (and becomes admin of an empty tenant) on first sign-in in every tenant. Restrict it to the tenants that should self-provision.',
    );
  }
}

/** Stable, non-routable placeholder for identities without a usable email address. */
function placeholderEmail(provider: ExternalIdentityProvider, subject: string): string {
  const digest = createHash('sha256').update(`${provider}:${subject}`, 'utf8').digest('hex').slice(0, 32);

  return `${provider}-${digest}@external.invalid`;
}

/**
 * Maps identities from external providers (OIDC, SAML) to rows of the local `users` table.
 * Shared by every external authentication method so roles, locking, tenants, PATs and client access work the same.
 *
 * - Known (provider, subject) → that user (rejected when locked).
 * - Otherwise an existing local account is linked by email only when the email is trusted
 *   ({@link isTrustedExternalEmail}) and the account is not linked to another external identity yet.
 * - Otherwise a new user is created (first user of a tenant becomes admin). Untrusted emails are not stored — the
 *   account gets a non-routable placeholder, so nobody can claim an address (e.g. to be added to a workspace by email).
 */
@Injectable()
export class ExternalIdentityService {
  private readonly logger = new Logger(ExternalIdentityService.name);

  constructor(private readonly usersRepository: UsersRepository) {
    warnAboutMultiTenantAutoProvisioning(this.logger);
  }

  async resolveUser(identity: ExternalIdentityAssertion): Promise<UserEntity> {
    const subject = identity.subject?.trim();

    if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
      throw new UnauthorizedException('Missing or invalid authorization token');
    }

    const tenantId = getTenantIdOrDefault();
    const known = await this.usersRepository.findByExternalIdentity(identity.provider, subject, tenantId);

    if (known) {
      return this.assertUsable(known, tenantId);
    }

    try {
      return await this.linkOrCreate(identity.provider, subject, identity, tenantId);
    } catch (error) {
      // Concurrent first requests of the same identity race on the unique index: re-read the winner.
      if (isUniqueViolation(error)) {
        const winner = await this.usersRepository.findByExternalIdentity(identity.provider, subject, tenantId);

        if (winner) {
          return this.assertUsable(winner, tenantId);
        }

        // Another identity claimed the same email address concurrently.
        throw new UnauthorizedException('This email address is already in use by another account.');
      }

      throw error;
    }
  }

  private async linkOrCreate(
    provider: ExternalIdentityProvider,
    subject: string,
    identity: ExternalIdentityAssertion,
    tenantId: string,
  ): Promise<UserEntity> {
    const claimedEmail = normalizeEmail(identity.email);
    const email = claimedEmail && isTrustedExternalEmail(identity) ? claimedEmail : undefined;

    if (claimedEmail && !email) {
      this.logger.warn(
        `${provider} identity asserts an unverified email; it is not linked or stored (set ${provider.toUpperCase()}_TRUST_EMAIL=true if the IdP controls emails)`,
      );
    }

    if (email) {
      const existing = await this.usersRepository.findByEmail(email, tenantId);

      if (existing) {
        this.assertUsable(existing, tenantId);

        // Linked meanwhile by a parallel first request of this very identity: that is the account.
        if (existing.externalProvider === provider && existing.externalSubject === subject) {
          return existing;
        }

        if (existing.externalSubject) {
          this.logger.warn(`Refusing to link ${provider} identity: account is already linked to another identity`);
          throw new UnauthorizedException('This email address is already in use by another account.');
        }

        if (!(await this.usersRepository.linkExternalIdentityIfUnlinked(existing, provider, subject))) {
          // Lost a concurrent link: fine when the winner is this very identity (parallel first requests).
          const winner = await this.usersRepository.findByExternalIdentity(provider, subject, tenantId);

          if (winner) {
            return this.assertUsable(winner, tenantId);
          }

          this.logger.warn(`Refusing to link ${provider} identity: account was linked concurrently`);
          throw new UnauthorizedException('This email address is already in use by another account.');
        }

        return this.usersRepository.findByIdOrThrow(existing.id);
      }
    }

    if (!isAutoProvisioningAllowed(tenantId)) {
      this.logger.warn(
        `${provider} identity has no account in tenant "${tenantId}" and auto-provisioning is disabled there`,
      );
      throw new UnauthorizedException('No account exists for this identity. Please contact an administrator.');
    }

    const { user } = await this.usersRepository.createWithTenantBootstrap(
      (isFirstUser) => ({
        email: email ?? placeholderEmail(provider, subject),
        externalProvider: provider,
        externalSubject: subject,
        role: isFirstUser ? UserRole.ADMIN : UserRole.USER,
        emailConfirmedAt: new Date(),
      }),
      tenantId,
    );

    return user;
  }

  private assertUsable(user: UserEntity, tenantId: string): UserEntity {
    if (user.lockedAt) {
      throw new UnauthorizedException('This account is locked. Please contact an administrator.');
    }

    if (user.tenantId !== tenantId) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    return user;
  }
}
