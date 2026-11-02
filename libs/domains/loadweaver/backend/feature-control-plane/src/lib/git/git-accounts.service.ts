import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import type { ClusterGit } from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan } from 'typeorm';

import type { GitPendingLinkDto } from '../dto/git.dto';
import {
  GIT_ACCOUNT_PROVIDERS,
  GitAccountEntity,
  GitOAuthStateEntity,
  GitPendingLinkEntity,
  type GitAccountProvider,
} from '../entities/git.entity';
import { fleetIdentityOf, isFleetRelayCaller } from '../fleet-identity/fleet-identity.utils';
import { actorFromRequest, AuditLogService, ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { GitBotConfigService } from './github-app';
import { consoleBaseUrl } from './git-sync.utils';
import { newOAuthNonce, OAUTH_STATE_TTL_MS, signOAuthState, verifyOAuthState } from './plan-bot.utils';
import { providerRequest } from './providers';

export interface GitAccountDto {
  id: string;
  provider: GitAccountProvider;
  providerUserId: string;
  login: string;
  createdAt: string;
}

function toDto(a: GitAccountEntity): GitAccountDto {
  return {
    id: a.id,
    provider: a.provider,
    providerUserId: a.providerUserId,
    login: a.login,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Pending links are valid this long (as the OAuth state). */
const PENDING_TTL_MS = OAUTH_STATE_TTL_MS;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

/** Why a callback didn't link (a fixed code in the redirect, never provider text). */
export type GitLinkError = 'invalid-state' | 'denied' | 'not-configured' | 'exchange-failed' | 'already-linked';

/** The OAuth app of a provider, with its endpoints. */
interface OAuthApp {
  clientId: string;
  clientSecretRef: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  caCertificate: string | null;
  extraAuthorize: Record<string, string>;
}

function oauthApp(provider: GitAccountProvider, git: ClusterGit): OAuthApp | null {
  if (provider === 'github') {
    const gh = git.github;

    if (!gh?.clientId || !gh.clientSecret) return null;

    const web = gh.webUrl.replace(/\/+$/, '');

    return {
      clientId: gh.clientId,
      clientSecretRef: gh.clientSecret,
      authorizeUrl: `${web}/login/oauth/authorize`,
      tokenUrl: `${web}/login/oauth/access_token`,
      userUrl: `${gh.apiUrl.replace(/\/+$/, '')}/user`,
      caCertificate: gh.caCertificate ?? null,
      extraAuthorize: { allow_signup: 'false' },
    };
  }

  const gl = git.gitlab;

  if (!gl?.applicationId || !gl.applicationSecret) return null;

  const base = gl.url.replace(/\/+$/, '');

  return {
    clientId: gl.applicationId,
    clientSecretRef: gl.applicationSecret,
    authorizeUrl: `${base}/oauth/authorize`,
    tokenUrl: `${base}/oauth/token`,
    userUrl: `${base}/api/v4/user`,
    caCertificate: gl.caCertificate ?? null,
    extraAuthorize: { response_type: 'code', scope: 'read_user' },
  };
}

/** The control plane's public base URL (the OAuth callback lives below it). */
function publicApiUrl(): string | null {
  const url = (process.env['LOADWEAVER_PUBLIC_URL'] ?? '').trim().replace(/\/+$/, '');

  return /^https?:\/\/[^\s]+$/.test(url) ? url : null;
}

function encryptionKey(): string {
  const key = process.env['ENCRYPTION_KEY'];

  if (!key) throw new ConflictException('ENCRYPTION_KEY is not set: Git account linking is unavailable');

  return key;
}

/** The console page the callback returns to: a fixed path, no query / fragment / credentials (3.41). */
const RETURN_PATH = /^(?:\/[A-Za-z0-9._~-]+)*\/account\/git-accounts$/;

/**
 * A fleet console's Git accounts page (3.41), or null: `http(s)`, no credentials / query / fragment, a path ending in
 * `/account/git-accounts`, at most 512 characters. Only taken from requests with a verified fleet identity — the
 * fleet signs the body and forwards only its own console origins.
 */
export function gitLinkReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;

  try {
    const url = new URL(value);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    if (url.username || url.password || url.search || url.hash || !RETURN_PATH.test(url.pathname)) return null;

    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function assertAccountProvider(provider: string): GitAccountProvider {
  if (!(GIT_ACCOUNT_PROVIDERS as readonly string[]).includes(provider))
    throw new NotFoundException('unknown provider (github, gitlab)');

  return provider as GitAccountProvider;
}

/**
 * Git account linking (3.30): a Loadweaver user links their GitHub / GitLab account through OAuth. The state is
 * HMAC-signed (user, provider, nonce, expiry ≤ 10 min, key derived from `ENCRYPTION_KEY`) and single use; only the
 * provider's user id and login are stored, the OAuth token is used once to read them and dropped. The callback only
 * redirects to the console's own settings page — or, for a link started through a trusted fleet, to that fleet
 * console's page the fleet named in the signed request (3.41).
 *
 * Through a fleet (3.41) the account is the verified person's (`fleet:<iss>:<sub>`), never the fleet's service user:
 * the fleet's service credential without a verified person is refused. The plan bot acts for such a link only with
 * the roles the cluster itself grants that person id (see `GitBotService`), never with a fleet grant from a past claim.
 */
@Injectable()
export class GitAccountsService {
  private readonly logger = new Logger(GitAccountsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: GitBotConfigService,
    private readonly credentials: PlatformCredentialsService,
    private readonly audit: AuditLogService,
  ) {}

  /** The owner of the caller's links: the verified fleet person through a fleet, else the signed-in user. */
  private userOf(req: RequestWithUser | undefined): string {
    const identity = fleetIdentityOf(req);

    if (identity) return identity.person;

    if (isFleetRelayCaller(req, ON_BEHALF_OF_SCOPE))
      throw new ForbiddenException('Git accounts through a fleet need a verified fleet identity');

    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (info.isApiKeyAuth || !info.userId)
      throw new BadRequestException('Git accounts are linked to users; this session has no user');

    return info.userId;
  }

  async list(req: RequestWithUser | undefined): Promise<GitAccountDto[]> {
    const userId = this.userOf(req);

    return (
      await this.dataSource.getRepository(GitAccountEntity).find({ where: { userId }, order: { provider: 'ASC' } })
    ).map(toDto);
  }

  /** The provider's authorize URL with a fresh signed state. */
  async authorize(
    req: RequestWithUser | undefined,
    provider: string,
    returnUrl?: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const userId = this.userOf(req);
    const kind = assertAccountProvider(provider);
    // A fleet console's page (3.41): only on the word of a verified fleet (the claim binds the body).
    let back: string | null = null;

    if (returnUrl !== undefined && returnUrl !== null) {
      back = fleetIdentityOf(req) ? gitLinkReturnUrl(returnUrl) : null;

      if (!back)
        throw new BadRequestException(
          "returnUrl is only accepted through a trusted fleet, for its console's /account/git-accounts page",
        );
    }
    const app = oauthApp(kind, await this.config.config());
    const base = publicApiUrl();

    if (!app) throw new ConflictException(`${kind} account linking is not configured (Cluster.spec.git.${kind})`);

    if (!base) throw new ConflictException('LOADWEAVER_PUBLIC_URL is not set: the OAuth callback has no address');

    const nonce = newOAuthNonce();
    const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
    const repo = this.dataSource.getRepository(GitOAuthStateEntity);

    await repo.delete({ expiresAt: LessThan(new Date()) });
    await repo.save(repo.create({ nonce, userId, provider: kind, expiresAt: new Date(expiresAt) }));

    const url = new URL(app.authorizeUrl);

    url.search = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: `${base}/api/git/accounts/${kind}/callback`,
      state: signOAuthState(encryptionKey(), {
        userId,
        provider: kind,
        nonce,
        expiresAt,
        ...(back ? { returnUrl: back } : {}),
      }),
      ...app.extraAuthorize,
    }).toString();

    return { url: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Where the callback sends the browser: the console's Account › Git accounts page (fixed path, never from the
   * request), or the fleet console page recorded in the signed state when the link was started through a fleet.
   */
  settingsUrl(result: { confirm: string } | { error: GitLinkError }, returnUrl?: string | null): string | null {
    const back = returnUrl ? gitLinkReturnUrl(returnUrl) : null;
    const base = consoleBaseUrl();

    if (!back && !base) return null;

    const query = 'confirm' in result ? `confirm=${encodeURIComponent(result.confirm)}` : `error=${result.error}`;

    return `${back ?? `${base}/account/git-accounts`}?${query}`;
  }

  /** The return page a callback's (signed) state names, if any — for errors after the state was verified too. */
  returnUrlOf(state: string | undefined): string | null {
    const key = process.env['ENCRYPTION_KEY'];
    const verified = key && state ? verifyOAuthState(key, state) : null;

    return verified?.returnUrl ? gitLinkReturnUrl(verified.returnUrl) : null;
  }

  /**
   * `GET /git/accounts/:provider/callback`: verifies the state (single use), exchanges the code and records the
   * provider account as a pending link (10 minutes) for the user who started the flow; nothing is linked until that
   * user confirms it in the console (L5: a victim lured through someone else's flow links nothing).
   */
  async callback(
    provider: string,
    query: { code?: string; state?: string; error?: string },
  ): Promise<{ confirm: string } | { error: GitLinkError }> {
    let kind: GitAccountProvider;

    try {
      kind = assertAccountProvider(provider);
    } catch {
      return { error: 'invalid-state' };
    }

    const state = verifyOAuthState(encryptionKey(), query.state ?? '');

    if (!state || state.provider !== kind) return { error: 'invalid-state' };

    // Single use: the nonce is deleted on the first callback (also a denied one).
    const used: unknown[] = await this.dataSource.query(
      `DELETE FROM "lw_git_oauth_states" WHERE "nonce" = $1 AND "user_id" = $2 AND "provider" = $3 AND "expires_at" > now() RETURNING "nonce"`,
      [state.nonce, state.userId, kind],
    );

    if ((Array.isArray(used[0]) ? (used[0] as unknown[]) : used).length === 0) return { error: 'invalid-state' };

    if (query.error || !query.code || !/^[A-Za-z0-9._~-]{1,512}$/.test(query.code)) return { error: 'denied' };

    const app = oauthApp(kind, await this.config.config());
    const base = publicApiUrl();

    if (!app || !base) return { error: 'not-configured' };

    let user: { id: string; login: string };

    try {
      user = await this.exchange(kind, app, query.code, `${base}/api/git/accounts/${kind}/callback`);
    } catch (error) {
      this.logger.warn(`Git account linking (${kind}): ${error instanceof Error ? error.message : String(error)}`);

      return { error: 'exchange-failed' };
    }

    const other = await this.dataSource
      .getRepository(GitAccountEntity)
      .findOne({ where: { provider: kind, providerUserId: user.id } });

    if (other && other.userId !== state.userId) return { error: 'already-linked' };

    const pending = this.dataSource.getRepository(GitPendingLinkEntity);
    const nonce = newOAuthNonce();

    await pending.delete({ expiresAt: LessThan(new Date()) });
    await pending.save(
      pending.create({
        nonce,
        userId: state.userId,
        provider: kind,
        providerUserId: user.id,
        login: user.login,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      }),
    );

    return { confirm: nonce };
  }

  private async pendingOf(userId: string, nonce: string): Promise<GitPendingLinkEntity> {
    const link = NONCE.test(nonce)
      ? await this.dataSource.getRepository(GitPendingLinkEntity).findOne({ where: { nonce } })
      : null;

    // Someone else's pending link is as unknown as an expired one.
    if (!link || link.userId !== userId || link.expiresAt.getTime() < Date.now())
      throw new NotFoundException('the link request expired or does not exist; start linking again');

    return link;
  }

  /** `GET /git/accounts/pending/:nonce`: which provider account the caller's OAuth flow returned. */
  async pending(req: RequestWithUser | undefined, nonce: string): Promise<GitPendingLinkDto> {
    const link = await this.pendingOf(this.userOf(req), nonce);

    return {
      provider: link.provider,
      login: link.login,
      providerUserId: link.providerUserId,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /** `POST /git/accounts/confirm`: the user who started the flow links the returned account (single use). */
  async confirm(req: RequestWithUser | undefined, nonce: string): Promise<GitAccountDto> {
    const userId = this.userOf(req);

    await this.pendingOf(userId, nonce);

    return await this.dataSource.transaction(async (manager) => {
      const used: unknown[] = await manager.query(
        `DELETE FROM "lw_git_pending_links" WHERE "nonce" = $1 AND "user_id" = $2 AND "expires_at" > now() RETURNING "provider", "provider_user_id", "login"`,
        [nonce, userId],
      );
      const rows = (Array.isArray(used[0]) ? used[0] : used) as {
        provider: GitAccountProvider;
        provider_user_id: string;
        login: string;
      }[];
      const link = rows[0];

      if (!link) throw new NotFoundException('the link request expired or does not exist; start linking again');

      const repo = manager.getRepository(GitAccountEntity);
      const other = await repo.findOne({ where: { provider: link.provider, providerUserId: link.provider_user_id } });

      if (other && other.userId !== userId)
        throw new ConflictException(`this ${link.provider} account is already linked to another Loadweaver user`);

      await repo.delete({ userId, provider: link.provider });

      const saved = await repo.save(
        repo.create({ userId, provider: link.provider, providerUserId: link.provider_user_id, login: link.login }),
      );

      await this.audit.record(manager, {
        actor: this.actorOf(req, userId),
        action: 'git.account.link',
        target: `git/account/${saved.id}`,
        details: { provider: link.provider, login: link.login, providerUserId: link.provider_user_id },
      });

      return toDto(saved);
    });
  }

  /** `DELETE /git/accounts/pending/:nonce`: drops a pending link without linking. */
  async cancel(req: RequestWithUser | undefined, nonce: string): Promise<void> {
    const link = await this.pendingOf(this.userOf(req), nonce);

    await this.dataSource.getRepository(GitPendingLinkEntity).delete({ nonce: link.nonce });
  }

  /** Code → access token → the provider user (`/user`); the token is used for this one call and dropped. */
  private async exchange(
    kind: GitAccountProvider,
    app: OAuthApp,
    code: string,
    redirectUri: string,
  ): Promise<{ id: string; login: string }> {
    const secret = await this.credentials.providerConfig(app.clientSecretRef);
    const clientSecret = secret['clientSecret'] ?? secret['apiToken'] ?? '';
    const ctx = { caCertificate: app.caCertificate, timeoutMs: 15_000 };
    const token = await providerRequest(
      ctx,
      'POST',
      app.tokenUrl,
      {},
      {
        client_id: app.clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        ...(kind === 'gitlab' ? { grant_type: 'authorization_code' } : {}),
      },
    );
    const accessToken = typeof token.json?.access_token === 'string' ? (token.json.access_token as string) : null;

    if (token.status !== 200 || !accessToken)
      throw new Error(
        `token exchange: HTTP ${token.status}${token.json?.error ? ` (${String(token.json.error).slice(0, 80)})` : ''}`,
      );

    const res = await providerRequest(ctx, 'GET', app.userUrl, { authorization: `Bearer ${accessToken}` });
    const id = res.json?.id;
    const login = kind === 'github' ? res.json?.login : res.json?.username;

    if (res.status !== 200 || (typeof id !== 'number' && typeof id !== 'string') || typeof login !== 'string')
      throw new Error(`user: HTTP ${res.status}`);

    if (!/^\d{1,20}$/.test(String(id))) throw new Error('user: unexpected id');

    return { id: String(id), login: login.slice(0, 255) };
  }

  async remove(req: RequestWithUser | undefined, id: string): Promise<void> {
    const userId = this.userOf(req);
    const repo = this.dataSource.getRepository(GitAccountEntity);
    const account = /^[0-9a-f-]{36}$/i.test(id) ? await repo.findOne({ where: { id } }) : null;

    if (!account || account.userId !== userId) throw new NotFoundException('account not found');

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(GitAccountEntity).delete({ id });
      await this.audit.record(manager, {
        actor: this.actorOf(req, userId),
        action: 'git.account.unlink',
        target: `git/account/${id}`,
        details: { provider: account.provider, login: account.login },
      });
    });
  }

  /** The audit actor: the signed-in user natively; through a fleet the service credential on behalf of the person. */
  private actorOf(req: RequestWithUser | undefined, userId: string) {
    return fleetIdentityOf(req) ? actorFromRequest(req) : { type: 'user' as const, id: userId };
  }
}
