import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';

import {
  atlassianFetchJson,
  buildBasicAuthHeader,
  confluenceRestApiRoot,
  normalizeAtlassianBaseUrl,
} from './atlassian-rest.util';

/** OAuth 2.0 token endpoint for Atlassian service account client credentials. */
export const ATLASSIAN_OAUTH_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';

/** Atlassian API gateway used with OAuth access tokens (`/ex/{product}/{cloudId}`). */
export const ATLASSIAN_API_GATEWAY_ORIGIN = 'https://api.atlassian.com';

const AUTH_FETCH_TIMEOUT_MS = 15_000;
/** Refresh access tokens this long before they expire. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;
/** Fallback lifetime when the token response has no usable `expires_in`. */
const DEFAULT_TOKEN_LIFETIME_S = 3_600;
const CLOUD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Where and how to call Atlassian REST APIs for one connection.
 * - `jiraApiBase`: prefix for `/rest/api/3/...` and `/rest/agile/1.0/...`
 * - `confluenceApiBase`: prefix for Confluence `/rest/api/...` (Cloud: `.../wiki`)
 * - `confluenceOriginBase`: prefix for pagination links that start with `/wiki/...`
 */
export interface AtlassianRequestContext {
  authType: 'app' | 'token';
  jiraApiBase: string;
  confluenceApiBase: string;
  confluenceOriginBase: string;
  authorizationHeader: string;
}

/** Error whose message is safe to show to admins (never contains credentials or upstream bodies). */
export class AtlassianAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtlassianAuthError';
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

type AtlassianAuthConnection = Pick<
  AtlassianSiteConnectionEntity,
  | 'id'
  | 'baseUrl'
  | 'updatedAt'
  | 'authType'
  | 'accountEmail'
  | 'apiToken'
  | 'oauthClientId'
  | 'oauthClientSecret'
  | 'cloudId'
>;

/**
 * Resolves the request context (API bases + `Authorization` header) for an Atlassian connection.
 *
 * - `token`: site base URL + HTTP Basic (`accountEmail:apiToken`).
 * - `app`: OAuth 2.0 client credentials of an Atlassian service account. Access tokens are cached in memory until
 *   one minute before expiry, keyed by connection id + `updatedAt` (credential changes invalidate the cache). The cloud
 *   id is resolved once via `GET {site}/_edge/tenant_info` and persisted in `cloud_id`.
 */
@Injectable()
export class AtlassianAuthService {
  private readonly logger = new Logger(AtlassianAuthService.name);
  private readonly tokenCache = new Map<string, CachedToken>();

  constructor(
    @InjectRepository(AtlassianSiteConnectionEntity)
    private readonly repo: Repository<AtlassianSiteConnectionEntity>,
  ) {}

  async resolve(connection: AtlassianAuthConnection): Promise<AtlassianRequestContext> {
    const siteBase = normalizeAtlassianBaseUrl(connection.baseUrl);

    if ((connection.authType ?? 'token') === 'token') {
      if (!connection.accountEmail || !connection.apiToken) {
        throw new AtlassianAuthError('Connection is missing account email or API token');
      }

      return {
        authType: 'token',
        jiraApiBase: siteBase,
        confluenceApiBase: confluenceRestApiRoot(siteBase),
        confluenceOriginBase: siteBase,
        authorizationHeader: buildBasicAuthHeader(connection.accountEmail, connection.apiToken),
      };
    }

    if (!connection.oauthClientId || !connection.oauthClientSecret) {
      throw new AtlassianAuthError('Connection is missing OAuth client id or client secret');
    }

    const cloudId = await this.resolveCloudId(connection, siteBase);
    const accessToken = await this.getAccessToken(connection);
    const confluenceOriginBase = `${ATLASSIAN_API_GATEWAY_ORIGIN}/ex/confluence/${cloudId}`;

    return {
      authType: 'app',
      jiraApiBase: `${ATLASSIAN_API_GATEWAY_ORIGIN}/ex/jira/${cloudId}`,
      confluenceApiBase: `${confluenceOriginBase}/wiki`,
      confluenceOriginBase,
      authorizationHeader: `Bearer ${accessToken}`,
    };
  }

  /** Drops cached access tokens of a connection (e.g. after it was updated or deleted). */
  invalidate(connectionId: string): void {
    for (const key of this.tokenCache.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        this.tokenCache.delete(key);
      }
    }
  }

  private cacheKey(connection: AtlassianAuthConnection): string {
    const updatedAt = connection.updatedAt instanceof Date ? connection.updatedAt.getTime() : 0;

    return `${connection.id}:${updatedAt}`;
  }

  private async getAccessToken(connection: AtlassianAuthConnection): Promise<string> {
    const key = this.cacheKey(connection);
    const cached = this.tokenCache.get(key);

    if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return cached.accessToken;
    }

    this.invalidate(connection.id);

    let res: Awaited<ReturnType<typeof atlassianFetchJson>>;

    try {
      res = await atlassianFetchJson(ATLASSIAN_OAUTH_TOKEN_URL, {
        method: 'POST',
        timeoutMs: AUTH_FETCH_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: connection.oauthClientId,
          client_secret: connection.oauthClientSecret,
        }),
      });
    } catch (e: unknown) {
      throw new AtlassianAuthError(`Atlassian OAuth token request failed (${networkErrorKind(e)})`);
    }

    if (!res.ok) {
      const code = oauthErrorCode(res.json);

      throw new AtlassianAuthError(
        `Atlassian OAuth token request failed (HTTP ${res.status}${code ? `, ${code}` : ''})`,
      );
    }

    const body = (res.json ?? {}) as { access_token?: unknown; expires_in?: unknown };

    if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
      throw new AtlassianAuthError('Atlassian OAuth token response did not contain an access token');
    }

    const lifetimeS =
      typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
        ? body.expires_in
        : DEFAULT_TOKEN_LIFETIME_S;

    this.tokenCache.set(key, { accessToken: body.access_token, expiresAt: Date.now() + lifetimeS * 1000 });

    return body.access_token;
  }

  private async resolveCloudId(connection: AtlassianAuthConnection, siteBase: string): Promise<string> {
    if (connection.cloudId && CLOUD_ID_PATTERN.test(connection.cloudId)) {
      return connection.cloudId;
    }

    let res: Awaited<ReturnType<typeof atlassianFetchJson>>;

    try {
      res = await atlassianFetchJson(`${new URL(siteBase).origin}/_edge/tenant_info`, {
        method: 'GET',
        timeoutMs: AUTH_FETCH_TIMEOUT_MS,
      });
    } catch (e: unknown) {
      throw new AtlassianAuthError(`Could not resolve Atlassian cloud id (${networkErrorKind(e)})`);
    }

    const cloudId = (res.json as { cloudId?: unknown } | null)?.cloudId;

    if (!res.ok || typeof cloudId !== 'string' || !CLOUD_ID_PATTERN.test(cloudId)) {
      throw new AtlassianAuthError(
        res.ok
          ? 'Could not resolve Atlassian cloud id (site is not an Atlassian Cloud site)'
          : `Could not resolve Atlassian cloud id (HTTP ${res.status})`,
      );
    }

    connection.cloudId = cloudId;

    try {
      // Keep `updated_at` unchanged: it keys the token cache and reflects admin edits only.
      await this.repo.update({ id: connection.id }, { cloudId, updatedAt: connection.updatedAt });
    } catch (e: unknown) {
      this.logger.warn(`Could not persist Atlassian cloud id for connection ${connection.id}: ${(e as Error).name}`);
    }

    return cloudId;
  }
}

function networkErrorKind(e: unknown): string {
  return e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network error';
}

/** OAuth error code (`invalid_client`, `access_denied`, ...) when it is a plain identifier; never free text. */
function oauthErrorCode(json: unknown): string | null {
  const code = (json as { error?: unknown } | null)?.error;

  return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : null;
}

/** Bounded, admin-safe message for persisted test results. */
export function sanitizeAtlassianTestMessage(message: string | undefined | null): string | null {
  if (!message) {
    return null;
  }

  const singleLine = message.replace(/[\r\n\t]+/g, ' ').trim();

  return singleLine.length > 512 ? `${singleLine.slice(0, 509)}...` : singleLine || null;
}
