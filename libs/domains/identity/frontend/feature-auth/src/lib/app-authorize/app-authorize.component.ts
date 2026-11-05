import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  APP_AUTHORIZATION_2FA_INVALID_CODE,
  APP_AUTHORIZATION_2FA_REQUIRED_CODE,
  AuthenticationFacade,
  AuthService,
  IDENTITY_AUTH_ENVIRONMENT,
  type AppAuthorizationInfoDto,
  type AppAuthorizationRequestDto,
  type AppSecondFactorMethod,
  type IdentityAuthEnvironment,
} from '@forepath/identity/frontend';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormFieldComponent,
  FpcOtpInputComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Navigates the browser to the app (separate for tests). */
export const APP_AUTHORIZE_NAVIGATOR = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

type ScopeLevel = 'read' | 'write' | 'admin';

export interface ScopeView {
  scope: string;
  resource: string;
  level: ScopeLevel | null;
}

function toScopeView(scope: string): ScopeView {
  const match = /^([a-z][a-z0-9_]*):(read|write|admin)$/.exec(scope);

  return match
    ? { scope, resource: match[1].replace(/_/g, ' '), level: match[2] as ScopeLevel }
    : { scope, resource: scope, level: null };
}

/**
 * GitHub-style grant page: shows the app, the scopes the user can grant (and those they cannot),
 * asks for the second factor when required and sends the user back to the app's registered return URL.
 * An existing, up-to-date authorization skips consent and redirects immediately.
 */
@Component({
  selector: 'identity-auth-app-authorize',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormFieldComponent,
    FpcOtpInputComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './app-authorize.component.html',
  styleUrls: ['./app-authorize.component.scss'],
  standalone: true,
})
export class IdentityAppAuthorizeComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly productName = this.environment.productName;

  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly redirecting = signal(false);
  readonly fatalError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly info = signal<AppAuthorizationInfoDto | null>(null);
  /** Second factor the page asks for (known up front for TOTP, after the first approve for email). */
  readonly secondFactor = signal<AppSecondFactorMethod | null>(null);
  readonly codeRequested = signal(false);
  readonly user = toSignal(this.authFacade.user$, { initialValue: null });

  readonly code = signal('');
  private request: AppAuthorizationRequestDto | null = null;

  readonly grantableScopes = computed(() => (this.info()?.grantableScopes ?? []).map(toScopeView));
  readonly ungrantableScopes = computed(() => (this.info()?.ungrantableScopes ?? []).map(toScopeView));
  readonly returnHost = computed(() => {
    const url = this.info()?.app.returnUrl;

    try {
      return url ? new URL(url).host : '';
    } catch {
      return '';
    }
  });
  readonly showCodeInput = computed(
    () => this.secondFactor() === 'totp' || (this.secondFactor() === 'email' && this.codeRequested()),
  );
  readonly canApprove = computed(() => {
    if (!this.info() || this.grantableScopes().length === 0 || this.submitting()) {
      return false;
    }

    return !this.showCodeInput() || this.isCodeComplete();
  });

  ngOnInit(): void {
    this.authFacade.checkAuthentication();

    const params = this.route.snapshot.queryParamMap;
    const appId = params.get('app_id') ?? '';

    if (!UUID_PATTERN.test(appId)) {
      this.loading.set(false);
      this.fatalError.set(
        $localize`:@@featureAppAuthorize-invalidLink:This authorization link is invalid. Return to the app and try again.`,
      );

      return;
    }

    const method = params.get('code_challenge_method');

    this.request = {
      app_id: appId,
      state: params.get('state') ?? undefined,
      code_challenge: params.get('code_challenge') ?? undefined,
      code_challenge_method: method === 'S256' ? 'S256' : undefined,
    };

    this.authService
      .getAppAuthorization(this.request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => {
          this.info.set(info);
          this.secondFactor.set(info.secondFactor);
          this.loading.set(false);

          if (info.alreadyAuthorized) {
            // Up-to-date authorization: no consent needed, go straight back to the app.
            this.decide('approve');
          }
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.fatalError.set(
            error instanceof HttpErrorResponse && (error.status === 404 || error.status === 400)
              ? $localize`:@@featureAppAuthorize-notFound:This app does not exist or the authorization link is invalid.`
              : this.messageOf(error),
          );
        },
      });
  }

  isCodeComplete(): boolean {
    return this.code().trim().length >= 6;
  }

  onApprove(): void {
    if (this.canApprove()) {
      this.decide('approve');
    }
  }

  onDeny(): void {
    this.decide('deny');
  }

  private decide(decision: 'approve' | 'deny'): void {
    const info = this.info();

    if (!info || !this.request || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set(null);

    this.authService
      .decideAppAuthorization({
        appId: info.app.id,
        decision,
        state: this.request.state,
        codeChallenge: this.request.code_challenge,
        codeChallengeMethod: this.request.code_challenge_method,
        ...(decision === 'approve' && this.showCodeInput() && this.code().trim() ? { code: this.code().trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ redirectUrl }) => this.redirect(redirectUrl, info.app.returnUrl),
        error: (error: unknown) => {
          this.submitting.set(false);

          const body = error instanceof HttpErrorResponse ? (error.error as { code?: string; method?: string }) : null;

          if (body?.code === APP_AUTHORIZATION_2FA_REQUIRED_CODE) {
            this.secondFactor.set(body.method === 'totp' ? 'totp' : 'email');
            this.codeRequested.set(true);
            this.code.set('');

            return;
          }

          if (body?.code === APP_AUTHORIZATION_2FA_INVALID_CODE) {
            this.code.set('');
            this.error.set(this.messageOf(error));

            return;
          }

          this.error.set(this.messageOf(error));
        },
      });
  }

  /** Defense in depth: only ever leave for the registered return URL's origin. */
  private redirect(redirectUrl: string, returnUrl: string): void {
    try {
      if (new URL(redirectUrl).origin !== new URL(returnUrl).origin) {
        throw new Error('origin mismatch');
      }
    } catch {
      this.submitting.set(false);
      this.error.set($localize`:@@featureAppAuthorize-redirectBlocked:The app returned an unexpected redirect.`);

      return;
    }

    this.redirecting.set(true);
    APP_AUTHORIZE_NAVIGATOR.assign(redirectUrl);
  }

  private messageOf(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = (error.error as { message?: unknown } | null)?.message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.join(', ');
      }
    }

    return $localize`:@@featureAppAuthorize-unexpectedError:Something went wrong. Please try again.`;
  }

  levelLabel(level: ScopeLevel | null): string {
    switch (level) {
      case 'read':
        return $localize`:@@featureAppAuthorize-levelRead:Read`;
      case 'write':
        return $localize`:@@featureAppAuthorize-levelWrite:Read and write`;
      case 'admin':
        return $localize`:@@featureAppAuthorize-levelAdmin:Administer`;
      default:
        return '';
    }
  }
}
