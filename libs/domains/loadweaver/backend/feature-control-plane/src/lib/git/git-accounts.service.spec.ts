import type { RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { VerifiedFleetIdentity } from '../fleet-identity/fleet-identity.utils';
import type { AuditLogService } from '../services/audit-log.service';
import type { PlatformCredentialsService } from '../services/platform-credentials.service';
import { GitAccountsService, gitLinkReturnUrl } from './git-accounts.service';
import type { GitBotConfigService } from './github-app';
import { signOAuthState, verifyOAuthState } from './plan-bot.utils';

const KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';
const PERSON = 'fleet:fleet-1:alice';
const NONCE = 'pending-nonce-0123456789';
const ACCOUNT = '6f1c1b0e-0000-4000-8000-0000000000aa';
const RETURN = 'https://fleet.example.com/de/account/git-accounts';

const identity: VerifiedFleetIdentity = {
  person: PERSON,
  issuer: 'fleet-1',
  subject: 'alice',
  email: 'alice@example.com',
  emailVerified: true,
  role: null,
  projects: { shop: 'viewer' },
  jti: 'jti-0123456789abcdef',
  expiresAt: new Date(Date.now() + 60_000),
};

/** The fleet's service user (PAT with `fleet:on-behalf-of`), with or without a verified person. */
const relayed = (person?: VerifiedFleetIdentity) =>
  ({
    user: { id: 'svc-fleet', roles: ['user'], amr: ['pat'], scopes: ['fleet:on-behalf-of', 'git:accounts'] },
    ...(person ? { fleetIdentity: person } : {}),
  }) as unknown as RequestWithUser;
const native = (id = 'u-native') => ({ user: { id, roles: ['user'], amr: ['pwd'] } }) as unknown as RequestWithUser;

function setup(accounts: { id: string; userId: string; provider: string; login: string }[] = []) {
  const found: unknown[] = [];
  const saved: Record<string, unknown>[] = [];
  const repo = {
    find: jest.fn(async (q: unknown) => {
      found.push(q);

      return accounts.map((a) => ({ ...a, providerUserId: '42', createdAt: new Date() }));
    }),
    findOne: jest.fn(async (q: { where: { id?: string; nonce?: string } }) => {
      if (q.where.nonce)
        return {
          nonce: q.where.nonce,
          userId: PERSON,
          provider: 'github',
          providerUserId: '42',
          login: 'octo',
          expiresAt: new Date(Date.now() + 60_000),
        };

      const account = accounts.find((a) => a.id === q.where.id);

      return account ? { ...account, providerUserId: '42', createdAt: new Date() } : null;
    }),
    delete: jest.fn(async () => undefined),
    create: (x: object) => x,
    save: jest.fn(async (x: Record<string, unknown>) => {
      saved.push(x);

      return { id: ACCOUNT, createdAt: new Date(), ...x };
    }),
  };
  const manager = {
    getRepository: () => ({ ...repo, findOne: async () => null }),
    query: jest.fn(async () => [{ provider: 'github', provider_user_id: '42', login: 'octo' }]),
  };
  const dataSource = {
    getRepository: () => repo,
    transaction: async (fn: (m: unknown) => Promise<unknown>) => await fn(manager),
  } as unknown as DataSource;
  const config = {
    config: async () => ({
      github: {
        clientId: 'client-1',
        clientSecret: 'secret://lw-system/github-oauth',
        webUrl: 'https://github.com',
        apiUrl: 'https://api.github.com',
      },
    }),
  } as unknown as GitBotConfigService;
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditLogService;
  const svc = new GitAccountsService(dataSource, config, {} as PlatformCredentialsService, audit);

  return { svc, repo, manager, found, saved, audit };
}

describe('GitAccountsService through a fleet (3.41)', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = KEY;
    process.env['LOADWEAVER_PUBLIC_URL'] = 'https://cluster.example.com';
    process.env['LOADWEAVER_CONSOLE_URL'] = 'https://console.cluster.example.com';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('keys the links by the verified person, never by the fleet’s service user', async () => {
    const { svc, found } = setup();

    await svc.list(relayed(identity));
    expect(found[0]).toMatchObject({ where: { userId: PERSON } });

    await svc.list(native());
    expect(found[1]).toMatchObject({ where: { userId: 'u-native' } });
  });

  it('refuses the fleet’s service credential without a verified person', async () => {
    const { svc } = setup();

    await expect(svc.list(relayed())).rejects.toThrow(ForbiddenException);
    await expect(svc.authorize(relayed(), 'github')).rejects.toThrow(ForbiddenException);
    await expect(svc.confirm(relayed(), NONCE)).rejects.toThrow(ForbiddenException);
  });

  it('records the fleet console page in the signed state, only for a verified fleet', async () => {
    const { svc, repo } = setup();
    const { url } = await svc.authorize(relayed(identity), 'github', RETURN);
    const authorize = new URL(url);
    const state = verifyOAuthState(KEY, authorize.searchParams.get('state') ?? '');

    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://cluster.example.com/api/git/accounts/github/callback',
    );
    expect(state).toMatchObject({ userId: PERSON, provider: 'github', returnUrl: RETURN });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: PERSON, provider: 'github' }));
    expect(svc.returnUrlOf(authorize.searchParams.get('state') ?? '')).toBe(RETURN);
    expect(svc.settingsUrl({ confirm: 'n1' }, RETURN)).toBe(`${RETURN}?confirm=n1`);
    expect(svc.settingsUrl({ error: 'denied' }, RETURN)).toBe(`${RETURN}?error=denied`);

    // Natively (no verified fleet) a return URL is refused; the callback uses the cluster's own console.
    await expect(svc.authorize(native(), 'github', RETURN)).rejects.toThrow(BadRequestException);
    await expect(svc.authorize(relayed(identity), 'github', 'https://fleet.example.com/settings')).rejects.toThrow(
      BadRequestException,
    );
    expect(svc.settingsUrl({ confirm: 'n1' })).toBe(
      'https://console.cluster.example.com/account/git-accounts?confirm=n1',
    );
    expect(svc.returnUrlOf(signOAuthState(KEY, { userId: 'u', provider: 'github', nonce: 'n', expiresAt: 0 }))).toBe(
      null,
    );
  });

  it('confirms a pending link for the person and audits the service user on behalf of them', async () => {
    const { svc, saved, audit, manager } = setup();

    await expect(svc.confirm(relayed(identity), NONCE)).resolves.toMatchObject({ provider: 'github', login: 'octo' });
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('lw_git_pending_links'), [NONCE, PERSON]);
    expect(saved[0]).toMatchObject({ userId: PERSON, provider: 'github', providerUserId: '42' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'git.account.link',
        actor: expect.objectContaining({ type: 'user', id: 'svc-fleet', onBehalfOf: PERSON, person: PERSON }),
      }),
    );

    // Another user's pending link is unknown (the stored one belongs to the fleet person).
    await expect(svc.pending(native(), NONCE)).rejects.toThrow(NotFoundException);
  });

  it('unlinks only the person’s own accounts', async () => {
    const { svc, audit } = setup([
      { id: ACCOUNT, userId: PERSON, provider: 'github', login: 'octo' },
      { id: '6f1c1b0e-0000-4000-8000-0000000000bb', userId: 'u-native', provider: 'gitlab', login: 'other' },
    ]);

    await expect(svc.remove(relayed(identity), '6f1c1b0e-0000-4000-8000-0000000000bb')).rejects.toThrow(
      NotFoundException,
    );
    await svc.remove(relayed(identity), ACCOUNT);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'git.account.unlink', actor: expect.objectContaining({ onBehalfOf: PERSON }) }),
    );
  });

  it('accepts only a console’s Git accounts page as return URL', () => {
    expect(gitLinkReturnUrl('https://fleet.example.com/account/git-accounts')).toBe(
      'https://fleet.example.com/account/git-accounts',
    );
    expect(gitLinkReturnUrl(RETURN)).toBe(RETURN);

    for (const bad of [
      'javascript:alert(1)//account/git-accounts',
      'https://fleet.example.com/account/git-accounts?x=1',
      'https://fleet.example.com/account/git-accounts#x',
      'https://user:pw@fleet.example.com/account/git-accounts',
      'https://fleet.example.com/settings',
      'ftp://fleet.example.com/account/git-accounts',
      `https://fleet.example.com/${'a'.repeat(600)}/account/git-accounts`,
      42,
    ])
      expect(gitLinkReturnUrl(bad)).toBeNull();
  });
});
