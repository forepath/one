import { UserRole } from '@forepath/identity/backend';
import { UnauthorizedException } from '@nestjs/common';

import type { UsersRepository } from '../repositories/users.repository';

import {
  ExternalIdentityService,
  isAutoProvisioningAllowed,
  isTrustedExternalEmail,
  parseEmailVerifiedClaim,
} from './external-identity.service';

describe('ExternalIdentityService', () => {
  let repo: jest.Mocked<
    Pick<
      UsersRepository,
      | 'findByExternalIdentity'
      | 'findByEmail'
      | 'findByIdOrThrow'
      | 'linkExternalIdentityIfUnlinked'
      | 'createWithTenantBootstrap'
    >
  >;
  let service: ExternalIdentityService;
  const user = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'u1',
      email: 'a@example.com',
      role: UserRole.USER,
      tenantId: 'default',
      lockedAt: null,
      externalProvider: null,
      externalSubject: null,
      ...overrides,
    }) as never;
  let isFirst: boolean;
  let linked: { provider: string; subject: string } | undefined;

  beforeEach(() => {
    isFirst = false;
    linked = undefined;
    repo = {
      findByExternalIdentity: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      findByIdOrThrow: jest.fn(async (id) =>
        user({ id, externalProvider: linked?.provider, externalSubject: linked?.subject }),
      ),
      linkExternalIdentityIfUnlinked: jest.fn(async (_id, provider, subject) => {
        linked = { provider, subject };

        return true;
      }),
      createWithTenantBootstrap: jest.fn(async (build, tenantId) => ({
        user: user({ id: 'new', tenantId, ...build(isFirst) }),
        isFirstUser: isFirst,
      })),
    };
    service = new ExternalIdentityService(repo as unknown as UsersRepository);
  });

  it('returns the linked user for a known (provider, subject)', async () => {
    repo.findByExternalIdentity.mockResolvedValue(user({ externalProvider: 'oidc', externalSubject: 'sub-1' }));

    await expect(service.resolveUser({ provider: 'oidc', subject: 'sub-1' })).resolves.toMatchObject({ id: 'u1' });
    expect(repo.findByExternalIdentity).toHaveBeenCalledWith('oidc', 'sub-1', 'default');
    expect(repo.createWithTenantBootstrap).not.toHaveBeenCalled();
  });

  it('rejects locked users', async () => {
    repo.findByExternalIdentity.mockResolvedValue(user({ lockedAt: new Date() }));

    await expect(service.resolveUser({ provider: 'oidc', subject: 'sub-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('creates the first user of a tenant as admin and later users as user', async () => {
    isFirst = true;
    await expect(
      service.resolveUser({ provider: 'saml', subject: 'n1', email: 'First@Example.com', emailVerified: true }),
    ).resolves.toMatchObject({
      email: 'first@example.com',
      role: UserRole.ADMIN,
      externalProvider: 'saml',
      externalSubject: 'n1',
    });
    expect(repo.createWithTenantBootstrap).toHaveBeenLastCalledWith(expect.any(Function), 'default');

    isFirst = false;
    await expect(
      service.resolveUser({ provider: 'saml', subject: 'n2', email: 'second@example.com', emailVerified: true }),
    ).resolves.toMatchObject({ role: UserRole.USER });
  });

  it('links an existing unlinked local account by verified email', async () => {
    repo.findByEmail.mockResolvedValue(user({ passwordHash: 'hash' }));

    await expect(
      service.resolveUser({ provider: 'oidc', subject: 'sub-1', email: 'a@example.com', emailVerified: true }),
    ).resolves.toMatchObject({ id: 'u1', externalProvider: 'oidc', externalSubject: 'sub-1' });
    expect(repo.linkExternalIdentityIfUnlinked).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      'oidc',
      'sub-1',
    );
  });

  it.each([
    ['explicitly unverified', false],
    ['unspecified (no trust opt-in)', undefined],
  ])('neither links nor stores an %s email (account takeover / address squatting)', async (_label, emailVerified) => {
    repo.findByEmail.mockResolvedValue(user({ passwordHash: 'hash' }));

    await service.resolveUser({ provider: 'oidc', subject: 'attacker', email: 'a@example.com', emailVerified });

    expect(repo.findByEmail).not.toHaveBeenCalled();
    expect(repo.linkExternalIdentityIfUnlinked).not.toHaveBeenCalled();

    const build = repo.createWithTenantBootstrap.mock.calls[0][0] as (first: boolean) => { email: string };

    expect(build(false)).toMatchObject({
      email: expect.stringMatching(/@external\.invalid$/),
      externalSubject: 'attacker',
    });
  });

  describe('trust opt-in for providers without email_verified', () => {
    afterEach(() => {
      delete process.env.SAML_TRUST_EMAIL;
      delete process.env.OIDC_TRUST_EMAIL;
    });

    it('SAML_TRUST_EMAIL=true trusts unspecified SAML emails (but never explicit false)', async () => {
      process.env.SAML_TRUST_EMAIL = 'true';
      repo.findByEmail.mockResolvedValue(user());

      await service.resolveUser({ provider: 'saml', subject: 'n1', email: 'a@example.com' });
      expect(repo.linkExternalIdentityIfUnlinked).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1' }),
        'saml',
        'n1',
      );

      expect(isTrustedExternalEmail({ provider: 'saml', emailVerified: false })).toBe(false);
      expect(isTrustedExternalEmail({ provider: 'oidc', emailVerified: undefined })).toBe(false);
    });

    it('OIDC_TRUST_EMAIL=true applies to OIDC only', () => {
      process.env.OIDC_TRUST_EMAIL = 'true';
      expect(isTrustedExternalEmail({ provider: 'oidc' })).toBe(true);
      expect(isTrustedExternalEmail({ provider: 'saml' })).toBe(false);
    });
  });

  it('never re-links an account that is already linked to another identity', async () => {
    repo.findByEmail.mockResolvedValue(user({ externalProvider: 'oidc', externalSubject: 'original' }));

    await expect(
      service.resolveUser({ provider: 'oidc', subject: 'other', email: 'a@example.com', emailVerified: true }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.linkExternalIdentityIfUnlinked).not.toHaveBeenCalled();
  });

  it('refuses when another identity links the account concurrently (compare-and-set lost)', async () => {
    repo.findByEmail.mockResolvedValue(user());
    repo.linkExternalIdentityIfUnlinked.mockResolvedValueOnce(false);

    await expect(
      service.resolveUser({ provider: 'oidc', subject: 'late', email: 'a@example.com', emailVerified: true }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the account when it was linked to this same identity between lookup and link', async () => {
    repo.findByEmail.mockResolvedValue(user({ externalProvider: 'oidc', externalSubject: 'same' }));

    await expect(
      service.resolveUser({ provider: 'oidc', subject: 'same', email: 'a@example.com', emailVerified: true }),
    ).resolves.toMatchObject({ id: 'u1', externalSubject: 'same' });
    expect(repo.linkExternalIdentityIfUnlinked).not.toHaveBeenCalled();
  });

  it('returns the account when the concurrent link winner is the same identity (parallel first requests)', async () => {
    repo.findByEmail.mockResolvedValue(user());
    repo.linkExternalIdentityIfUnlinked.mockResolvedValueOnce(false);
    repo.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(user({ externalProvider: 'oidc', externalSubject: 'same' }));

    await expect(
      service.resolveUser({ provider: 'oidc', subject: 'same', email: 'a@example.com', emailVerified: true }),
    ).resolves.toMatchObject({ id: 'u1', externalSubject: 'same' });
  });

  describe('EXTERNAL_AUTH_AUTO_PROVISION_TENANTS', () => {
    afterEach(() => delete process.env.EXTERNAL_AUTH_AUTO_PROVISION_TENANTS);

    it('refuses to create accounts outside the allowlist but still signs in linked / linkable accounts', async () => {
      process.env.EXTERNAL_AUTH_AUTO_PROVISION_TENANTS = 'acme';

      await expect(service.resolveUser({ provider: 'oidc', subject: 'new' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(repo.createWithTenantBootstrap).not.toHaveBeenCalled();

      repo.findByExternalIdentity.mockResolvedValueOnce(user({ externalProvider: 'oidc', externalSubject: 'known' }));
      await expect(service.resolveUser({ provider: 'oidc', subject: 'known' })).resolves.toMatchObject({ id: 'u1' });

      repo.findByEmail.mockResolvedValueOnce(user());
      await expect(
        service.resolveUser({ provider: 'oidc', subject: 'linkable', email: 'a@example.com', emailVerified: true }),
      ).resolves.toMatchObject({ externalSubject: 'linkable' });
    });

    it.each([
      [undefined, 'default', true],
      ['*', 'default', true],
      ['none', 'default', false],
      ['acme, globex', 'globex', true],
      ['acme', 'default', false],
    ])('%s / tenant %s → %s', (value, tenant, expected) => {
      expect(
        isAutoProvisioningAllowed(tenant, value === undefined ? {} : { EXTERNAL_AUTH_AUTO_PROVISION_TENANTS: value }),
      ).toBe(expected);
    });
  });

  it('uses a non-routable placeholder (no linking) when no usable email is asserted', async () => {
    await service.resolveUser({ provider: 'oidc', subject: 'sub-x', email: 'not an email' });

    expect(repo.findByEmail).not.toHaveBeenCalled();

    const build = repo.createWithTenantBootstrap.mock.calls[0][0] as (first: boolean) => { email: string };

    expect(build(false).email).toMatch(/^oidc-[0-9a-f]{32}@external\.invalid$/);
  });

  it('rejects empty and oversized subjects', async () => {
    await expect(service.resolveUser({ provider: 'oidc', subject: ' ' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.resolveUser({ provider: 'oidc', subject: 'x'.repeat(256) })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recovers from a concurrent first sign-in (unique violation) by re-reading the winner', async () => {
    repo.createWithTenantBootstrap.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    repo.findByExternalIdentity.mockResolvedValueOnce(null).mockResolvedValueOnce(user({ id: 'winner' }));

    await expect(service.resolveUser({ provider: 'saml', subject: 'n1' })).resolves.toMatchObject({ id: 'winner' });

    // Different identity, same email claimed concurrently → clean 401 instead of a 500.
    repo.findByExternalIdentity.mockResolvedValue(null);
    await expect(service.resolveUser({ provider: 'saml', subject: 'n2' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('parses email_verified claims', () => {
    expect(parseEmailVerifiedClaim(true)).toBe(true);
    expect(parseEmailVerifiedClaim('false')).toBe(false);
    expect(parseEmailVerifiedClaim('TRUE')).toBe(true);
    expect(parseEmailVerifiedClaim(undefined)).toBeUndefined();
    expect(parseEmailVerifiedClaim(1)).toBeUndefined();
  });
});
