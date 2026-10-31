import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  CreatedGitConnection,
  CreateGitConnectionRequest,
  GitAccount,
  GitAccountAuthorization,
  GitAccountPendingLink,
  GitAccountProvider,
  GitCommit,
  GitConnection,
  GitExportResult,
  GitSopsRecipient,
  GitSyncResult,
  GitTestResult,
  RotatedGitWebhookSecret,
  UpdateGitConnectionRequest,
} from '../types/git.types';
import { gitWebhookUrl } from '../utils/git';
import { ConsoleApi } from './console-api';

/** This console's Git accounts page as an absolute URL (below the base href, e.g. the locale), or null. */
export function gitAccountsReturnUrl(
  base = typeof document !== 'undefined' ? document.baseURI : undefined,
): string | null {
  if (!base) return null;

  try {
    const url = new URL('account/git-accounts', base);

    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

/**
 * GitOps (3.29 / 3.30): Git connections per scope (readers list them, scope admins manage them), their commits, the
 * actions on them, the cluster's SOPS recipient and the caller's linked Git accounts.
 */
@Injectable({ providedIn: 'root' })
export class GitService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  private connection(id: string, suffix = ''): string {
    return this.url(`/git/connections/${encodeURIComponent(id)}${suffix}`);
  }

  list(): Observable<GitConnection[]> {
    return this.http.get<GitConnection[]>(this.url('/git/connections'));
  }

  get(id: string): Observable<GitConnection> {
    return this.http.get<GitConnection>(this.connection(id));
  }

  create(request: CreateGitConnectionRequest): Observable<CreatedGitConnection> {
    return this.http.post<CreatedGitConnection>(this.url('/git/connections'), request);
  }

  update(id: string, request: UpdateGitConnectionRequest): Observable<GitConnection> {
    return this.http.patch<GitConnection>(this.connection(id), request);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(this.connection(id));
  }

  commits(id: string, limit = 50): Observable<GitCommit[]> {
    return this.http.get<GitCommit[]>(this.connection(id, '/commits'), { params: { limit: String(limit) } });
  }

  /** Reading it is audited (`git.connection.webhook-secret`). */
  webhookSecret(id: string): Observable<{ webhookSecret: string }> {
    return this.http.get<{ webhookSecret: string }>(this.connection(id, '/webhook-secret'));
  }

  /** A new webhook secret (audited); the current one stops working immediately. */
  rotateWebhookSecret(id: string): Observable<RotatedGitWebhookSecret> {
    return this.http.post<RotatedGitWebhookSecret>(this.connection(id, '/webhook-secret/rotate'), {});
  }

  resetHostKey(id: string): Observable<GitConnection> {
    return this.http.post<GitConnection>(this.connection(id, '/host-key/reset'), {});
  }

  test(id: string): Observable<GitTestResult> {
    return this.http.post<GitTestResult>(this.connection(id, '/test'), {});
  }

  sync(id: string): Observable<GitSyncResult> {
    return this.http.post<GitSyncResult>(this.connection(id, '/sync'), {});
  }

  /** `force`: replace the resource files already in the path. */
  exportToRepo(id: string, force = false): Observable<GitExportResult> {
    return this.http.post<GitExportResult>(this.connection(id, '/export'), force ? { force: true } : {});
  }

  /**
   * The absolute URL the provider's webhook points at: the cluster's own (public) API — in fleet mode too, the relay
   * never carries webhook deliveries (3.41).
   */
  webhookUrl(connection: Pick<GitConnection, 'webhookPath'>): string {
    const base = (this.endpoints.fleetMode ? this.endpoints.activeClusterPublicApi() : null) ?? this.apiUrl;

    return gitWebhookUrl(base, connection.webhookPath);
  }

  /** The cluster's public age recipient for SOPS files. */
  sopsRecipient(): Observable<GitSopsRecipient> {
    return this.http.get<GitSopsRecipient>(this.url('/git/sops/recipient'));
  }

  /** The Git accounts linked to the signed-in user. */
  accounts(): Observable<GitAccount[]> {
    return this.http.get<GitAccount[]>(this.url('/git/accounts'));
  }

  /**
   * Starts linking an account: the provider's authorize URL (with a signed state) the browser goes to. In fleet mode
   * (3.41) the cluster's OAuth callback returns to this console's Git accounts page (`returnUrl`; the fleet forwards
   * only its own console origins).
   */
  authorizeAccount(provider: GitAccountProvider): Observable<GitAccountAuthorization> {
    const returnUrl = this.endpoints.fleetMode ? gitAccountsReturnUrl() : null;

    return this.http.post<GitAccountAuthorization>(
      this.url(`/git/accounts/${encodeURIComponent(provider)}/authorize`),
      returnUrl ? { returnUrl } : {},
    );
  }

  /** The account the OAuth callback found (`?confirm=<nonce>`), waiting for the user's confirmation. */
  pendingAccountLink(nonce: string): Observable<GitAccountPendingLink> {
    return this.http.get<GitAccountPendingLink>(this.url(`/git/accounts/pending/${encodeURIComponent(nonce)}`));
  }

  /** Links the pending account (409: linked to another user; 404: expired). */
  confirmAccountLink(nonce: string): Observable<GitAccount> {
    return this.http.post<GitAccount>(this.url('/git/accounts/confirm'), { nonce });
  }

  /** Drops the pending link. */
  cancelAccountLink(nonce: string): Observable<void> {
    return this.http.delete<void>(this.url(`/git/accounts/pending/${encodeURIComponent(nonce)}`));
  }

  unlinkAccount(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/git/accounts/${encodeURIComponent(id)}`));
  }
}
