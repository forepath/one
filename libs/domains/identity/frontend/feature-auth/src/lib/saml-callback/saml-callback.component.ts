import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AuthService,
  LOGIN_SUCCESS_REDIRECT_TARGET,
  sanitizeAppRedirectPath,
  takeSamlCodeVerifier,
  USERS_JWT_STORAGE_KEY,
} from '@forepath/identity/frontend';
import { FpcAlertComponent } from '@forepath/shared/frontend/ui-components';

type SamlCallbackState = 'exchanging' | 'failed';

/**
 * `/login/saml/callback`: the API redirects here after validating the SAML assertion. Exchanges the one-time code
 * (bound to this tab's PKCE verifier) for the console session JWT and continues to the original page.
 */
@Component({
  selector: 'identity-saml-callback',
  imports: [CommonModule, RouterModule, FpcAlertComponent],
  templateUrl: './saml-callback.component.html',
  standalone: true,
})
export class IdentitySamlCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly defaultTarget = inject(LOGIN_SUCCESS_REDIRECT_TARGET, { optional: true }) ?? ['/clients'];

  readonly state = signal<SamlCallbackState>('exchanging');

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const error = params.get('error');
    // Always consume the verifier so a failed or foreign callback cannot reuse it.
    const codeVerifier = takeSamlCodeVerifier();

    if (error || !code || !codeVerifier) {
      this.state.set('failed');

      return;
    }

    const redirect = sanitizeAppRedirectPath(params.get('redirect'), '/');

    this.authService
      .exchangeSamlCode(code, codeVerifier)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ access_token }) => {
          if (!access_token) {
            this.state.set('failed');

            return;
          }

          localStorage.setItem(USERS_JWT_STORAGE_KEY, access_token);

          // Replace the callback URL (one-time code) in history.
          if (redirect !== '/') {
            void this.router.navigateByUrl(redirect, { replaceUrl: true });
          } else {
            void this.router.navigate(this.defaultTarget, { replaceUrl: true });
          }
        },
        error: () => this.state.set('failed'),
      });
  }
}
