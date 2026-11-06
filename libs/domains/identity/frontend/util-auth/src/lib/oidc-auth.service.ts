import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

import { IDENTITY_AUTH_ENVIRONMENT, type OidcAuthenticationConfig } from './auth-environment';
import { sanitizeAppRedirectPath } from './redirect-path.utils';

/** Console path the provider redirects back to after sign-in (register `<console>/login/oidc/callback`). */
export const OIDC_CALLBACK_PATH = 'login/oidc/callback';

/** Login page query flag set when external sign-in failed; suppresses the automatic redirect to the IdP. */
export const SSO_ERROR_QUERY_PARAM = 'sso_error';

const DEFAULT_OIDC_SCOPE = 'openid profile email';

interface OidcSigninState {
  returnUrl?: string;
}

/** App base URL: the `<base href>` (e.g. `/de/` for localized builds), else the origin root. */
function documentBaseUri(): string {
  const base = globalThis.document?.querySelector('base[href]');

  return base ? globalThis.document.baseURI : `${globalThis.location.origin}/`;
}

/**
 * Generic OpenID Connect sign-in for the console (Authorization Code + PKCE via oidc-client-ts).
 * Tokens are kept in sessionStorage (per tab, not shared with other origins/tabs) and renewed with the refresh
 * token when the provider issues one. Inactive (no-op) unless `authentication.type` is `oidc` in the browser.
 */
@Injectable({ providedIn: 'root' })
export class OidcAuthService {
  private readonly environment = inject(IDENTITY_AUTH_ENVIRONMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private manager: UserManager | null = null;
  private user: User | null = null;
  private initialized: Promise<void> | null = null;

  /** True when the console uses OIDC and runs in a browser. */
  isEnabled(): boolean {
    return this.environment.authentication.type === 'oidc' && isPlatformBrowser(this.platformId);
  }

  /**
   * Completes a pending sign-in redirect (when the browser is on {@link OIDC_CALLBACK_PATH}) and loads the stored
   * session. Runs once during app initialization, before the router's first navigation.
   */
  initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.doInitialize();
    }

    return this.initialized;
  }

  isLoggedIn(): boolean {
    return !!this.user && !this.user.expired;
  }

  /** Identity claims of the current session (display only — authorization decisions come from the API). */
  getProfile(): { sub: string; email?: string } | null {
    if (!this.user) {
      return null;
    }

    const email = this.user.profile.email;

    return { sub: this.user.profile.sub, email: typeof email === 'string' ? email : undefined };
  }

  /** Current access token, renewed silently when expired; null when there is no usable session. */
  async getToken(): Promise<string | null> {
    const manager = this.getManager();

    if (!manager) {
      return null;
    }

    await this.initialize();

    let user = this.user ?? (await manager.getUser());

    if (user?.expired) {
      try {
        user = await manager.signinSilent();
      } catch {
        await manager.removeUser();
        user = null;
      }
    }

    this.user = user;

    return user && !user.expired ? user.access_token : null;
  }

  /** Redirects to the provider's sign-in page; returns to `returnUrl` (app-relative path) afterwards. */
  async login(returnUrl?: string): Promise<void> {
    const manager = this.getManager();

    if (!manager) {
      return;
    }

    const state: OidcSigninState = { returnUrl: sanitizeAppRedirectPath(returnUrl, '/') };

    await manager.signinRedirect({ state });
  }

  /** Ends the local session and the provider session (RP-initiated logout). */
  async logout(): Promise<void> {
    const manager = this.getManager();

    if (!manager) {
      return;
    }

    const user = this.user ?? (await manager.getUser());

    this.user = null;

    if (!user) {
      await manager.removeUser();

      return;
    }

    try {
      await manager.signoutRedirect({ id_token_hint: user.id_token });
    } catch {
      // Provider without end_session_endpoint: at least drop the local session.
      await manager.removeUser();
    }
  }

  private async doInitialize(): Promise<void> {
    const manager = this.getManager();

    if (!manager) {
      return;
    }

    manager.events.addUserLoaded((user) => {
      this.user = user;
    });
    manager.events.addUserUnloaded(() => {
      this.user = null;
    });

    if (this.isOnCallbackPath()) {
      try {
        const user = await manager.signinRedirectCallback();
        const state = (user.state ?? {}) as OidcSigninState;

        this.user = user;
        this.replaceLocation(sanitizeAppRedirectPath(state.returnUrl, '/'));
      } catch {
        this.replaceLocation(`/login?${SSO_ERROR_QUERY_PARAM}=oidc`);
      }

      return;
    }

    try {
      await manager.clearStaleState();
      this.user = await manager.getUser();
    } catch {
      this.user = null;
    }
  }

  private getManager(): UserManager | null {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.manager) {
      const config = this.environment.authentication as OidcAuthenticationConfig;
      const store = new WebStorageStateStore({ store: globalThis.sessionStorage });

      this.manager = new UserManager({
        authority: config.issuer,
        client_id: config.clientId,
        redirect_uri: new URL(OIDC_CALLBACK_PATH, documentBaseUri()).href,
        post_logout_redirect_uri: config.postLogoutRedirectUri ?? documentBaseUri(),
        response_type: 'code',
        scope: config.scope ?? DEFAULT_OIDC_SCOPE,
        userStore: store,
        stateStore: store,
        automaticSilentRenew: true,
        loadUserInfo: false,
        monitorSession: false,
      });
    }

    return this.manager;
  }

  private isOnCallbackPath(): boolean {
    const callbackPath = new URL(OIDC_CALLBACK_PATH, documentBaseUri()).pathname;

    return globalThis.location.pathname.replace(/\/+$/, '') === callbackPath.replace(/\/+$/, '');
  }

  /** Replaces the callback URL (code/state) with the app path before the router starts. */
  private replaceLocation(appPath: string): void {
    const target = new URL(appPath.replace(/^\//, ''), documentBaseUri());

    globalThis.history.replaceState(null, '', `${target.pathname}${target.search}${target.hash}`);
  }
}
