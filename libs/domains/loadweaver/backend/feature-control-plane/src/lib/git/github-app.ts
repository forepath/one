import { createPrivateKey, sign } from 'node:crypto';

import { clusterGitSchema, type ClusterGit } from '@forepath/loadweaver/shared/util-model';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ResourceEntity } from '../entities/resource.entity';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { GitProviderError, providerFailure, providerRequest, type GitProviderContext } from './providers';

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * The GitHub App JWT (RS256): `iat` 60 s in the past against clock skew, valid 9 minutes (GitHub allows 10), issuer
 * the app id. Only used to ask GitHub for installation tokens.
 */
export function githubAppJwt(appId: number, privateKeyPem: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + 600 - 60, iss: String(appId) }));
  const key = createPrivateKey(privateKeyPem);

  if (key.asymmetricKeyType !== 'rsa') throw new Error('the GitHub App private key must be an RSA key');

  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key);

  return `${header}.${payload}.${base64url(signature)}`;
}

function normalizedBase(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

/** Whether two API base URLs are the same (scheme, host, port, path; trailing slashes ignored). */
export function sameApiBase(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && normalizedBase(a) === normalizedBase(b);
}

/**
 * The API base of the instance Git accounts are linked on (3.30): `Cluster.spec.git.github.apiUrl`, or the GitLab
 * instance's `/api/v4`. Linked provider user ids only mean something on that instance.
 */
export function linkedInstanceApiBase(provider: 'github' | 'gitlab', git: ClusterGit): string {
  return provider === 'github'
    ? normalizedBase(git.github?.apiUrl ?? 'https://api.github.com')
    : `${normalizedBase(git.gitlab?.url ?? 'https://gitlab.com')}/api/v4`;
}

/** The plan bot / account linking settings of the cluster (`Cluster.spec.git`, 3.30). */
@Injectable()
export class GitBotConfigService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async config(): Promise<ClusterGit> {
    const cluster = await this.dataSource.getRepository(ResourceEntity).findOne({ where: { kind: 'Cluster' } });
    const parsed = clusterGitSchema.safeParse((cluster?.spec as { git?: unknown } | undefined)?.git ?? {});

    return parsed.success ? parsed.data : {};
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Tokens are renewed this long before GitHub's expiry (1 hour). */
const RENEW_BEFORE_MS = 5 * 60_000;

/**
 * Installation tokens of the Loadweaver GitHub App (3.30): app JWT → the repository's installation
 * (`GET /repos/{o}/{r}/installation`) → `POST /app/installations/{id}/access_tokens`. Cached per API base and
 * repository until shortly before they expire; never logged or stored.
 */
@Injectable()
export class GitHubAppTokens {
  private readonly logger = new Logger(GitHubAppTokens.name);
  private readonly cache = new Map<string, CachedToken>();

  constructor(
    private readonly config: GitBotConfigService,
    private readonly credentials: PlatformCredentialsService,
  ) {}

  /** Whether the cluster has a GitHub App configured. */
  async configured(): Promise<boolean> {
    const github = (await this.config.config()).github;

    return !!github?.appId && !!github.privateKey;
  }

  /**
   * Where the app's tokens may be used: the cluster's GitHub API (`Cluster.spec.git.github.apiUrl`) and the hosts of
   * its web and API URLs (Git over HTTPS); null without a configured app.
   */
  async appInstance(): Promise<{ apiBase: string; hosts: string[] } | null> {
    const github = (await this.config.config()).github;

    if (!github?.appId || !github.privateKey) return null;

    const hosts = [github.apiUrl, github.webUrl].flatMap((u) => {
      try {
        return [new URL(u).host.toLowerCase()];
      } catch {
        return [];
      }
    });

    return { apiBase: normalizedBase(github.apiUrl), hosts };
  }

  /**
   * An installation token for the repository, or null without a configured app. Minted only against the cluster's
   * configured GitHub API (with its CA), never a connection's API URL / CA: the app JWT must not reach other hosts.
   */
  async installationToken(repoSlug: string): Promise<string | null> {
    const github = (await this.config.config()).github;

    if (!github?.appId || !github.privateKey) return null;

    const ctx: Pick<GitProviderContext, 'apiBase' | 'repo' | 'caCertificate'> = {
      apiBase: normalizedBase(github.apiUrl),
      repo: repoSlug,
      caCertificate: github.caCertificate ?? null,
    };
    const cacheKey = `${ctx.apiBase}|${ctx.repo}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt - RENEW_BEFORE_MS > Date.now()) return cached.token;

    const secret = await this.credentials.providerConfig(github.privateKey);
    const pem = secret['privateKey'] ?? secret['apiToken'] ?? '';
    const jwt = githubAppJwt(github.appId, pem);
    const headers = { authorization: `Bearer ${jwt}`, 'x-github-api-version': '2022-11-28' };
    const [owner, repo] = ctx.repo.split('/');

    if (!owner || !repo) throw new GitProviderError(0, `invalid repository ${ctx.repo}`);

    const installation = await providerRequest(
      ctx,
      'GET',
      `${ctx.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
      headers,
    );

    if (installation.status !== 200 || typeof installation.json?.id !== 'number')
      throw providerFailure(`GitHub App installation for ${ctx.repo}`, installation);

    const issued = await providerRequest(
      ctx,
      'POST',
      `${ctx.apiBase}/app/installations/${installation.json.id}/access_tokens`,
      headers,
      { repositories: [repo] },
    );

    if (issued.status !== 201 || typeof issued.json?.token !== 'string')
      throw providerFailure('GitHub App installation token', issued);

    const expiresAt = Date.parse(String(issued.json.expires_at ?? '')) || Date.now() + 55 * 60_000;

    this.cache.set(cacheKey, { token: issued.json.token, expiresAt });
    this.logger.debug(`GitHub App token for ${ctx.repo} until ${new Date(expiresAt).toISOString()}`);

    return issued.json.token as string;
  }
}
