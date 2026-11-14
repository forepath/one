import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import type { IdentityAuthEnvironment, UsersAuthenticationConfig } from '@forepath/identity/frontend';
import { AuthenticationFacade, loginSuccess } from '@forepath/identity/frontend';
import {
  IDENTITY_AUTH_ENVIRONMENT,
  SSO_ERROR_QUERY_PARAM,
  usesExternalSignIn,
  usesStaticCredential,
} from '@forepath/identity/frontend';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { take, tap } from 'rxjs/operators';

import { IdentityAuthLegalLinksComponent } from '../auth-legal-links/auth-legal-links.component';
import { IdentityAuthMarkStackComponent } from '../auth-mark-stack/auth-mark-stack.component';
import { IdentityAuthMascotComponent } from '../auth-mascot/auth-mascot.component';

@Component({
  selector: 'identity-auth-login',
  imports: [
    IdentityAuthMascotComponent,
    IdentityAuthLegalLinksComponent,
    IdentityAuthMarkStackComponent,
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcSectionRowComponent,
    FpcSectionColumnComponent,
  ],
  styleUrls: ['./login.component.scss'],
  templateUrl: './login.component.html',
  standalone: true,
})
export class IdentityLoginComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  protected readonly authFacade = inject(AuthenticationFacade);
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  loginForm!: FormGroup;
  loading$: Observable<boolean> = this.authFacade.loading$;
  error$: Observable<string | null> = this.authFacade.error$;
  successMessage$: Observable<string | null> = this.authFacade.successMessage$;
  /** Set when a personal access token is pasted into the password field. */
  patRejectedError: string | null = null;

  /**
   * Whether the current authentication type is user-based (email/password)
   */
  get isUsersAuth(): boolean {
    return this.environment.authentication.type === 'users';
  }

  /**
   * Whether sign-in happens at an external identity provider (OIDC or SAML): no credentials are entered here.
   */
  get isExternalAuth(): boolean {
    return usesExternalSignIn(this.environment.authentication.type);
  }

  /** Set when the previous external sign-in attempt failed (the guard then does not redirect automatically). */
  get ssoFailed(): boolean {
    return !!this.route?.snapshot.queryParamMap.get(SSO_ERROR_QUERY_PARAM);
  }

  /**
   * Whether the current authentication type is API key
   */
  get isApiKeyAuth(): boolean {
    return this.environment.authentication.type === 'api-key';
  }

  /**
   * Whether the current authentication type is client certificate (mtls): the user selects a certificate file.
   */
  get isMtlsAuth(): boolean {
    return this.environment.authentication.type === 'mtls';
  }

  /**
   * Whether signup is disabled (users auth only). When true, the "Create an account" link is hidden.
   */
  get isSignupDisabled(): boolean {
    return (
      this.environment.authentication.type === 'users' &&
      (this.environment.authentication as UsersAuthenticationConfig).disableSignup === true
    );
  }

  /**
   * Whether the controller API hostname should be displayed (api-key / mtls).
   * Only shown when controllerApiUrl is provided in the environment.
   */
  get showApiBaseHostname(): boolean {
    return usesStaticCredential(this.environment.authentication.type) && !!this.environment.controllerApiUrl;
  }

  /**
   * Get the API base hostname from the environment configuration.
   * Extracts only the hostname and port (without protocol or path).
   */
  get apiBaseHostname(): string {
    const apiUrl = this.environment.controllerApiUrl;

    if (!apiUrl) return '';

    try {
      const url = new URL(apiUrl);

      return url.host;
    } catch {
      // Fallback if URL parsing fails - try to extract hostname manually
      const match = apiUrl.match(/\/\/([^/]+)/);

      return match ? match[1] : apiUrl;
    }
  }

  ngOnInit(): void {
    // Drop leftover errors from other auth screens; keep success (e.g. after reset/confirm).
    this.patRejectedError = null;
    this.authFacade.clearError();

    if (this.isUsersAuth) {
      this.loginForm = this.fb.group({
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required]],
      });
    } else if (this.isExternalAuth) {
      this.loginForm = this.fb.group({});
    } else if (this.isMtlsAuth) {
      this.loginForm = this.fb.group({
        certificate: [null as File | null, [Validators.required]],
        privateKey: [null as File | null],
      });
    } else {
      this.loginForm = this.fb.group({
        apiKey: ['', [Validators.required]],
      });
    }

    this.actions$
      .pipe(
        ofType(loginSuccess),
        take(1),
        takeUntilDestroyed(this.destroyRef),
        tap(() => this.loginForm.reset()),
      )
      .subscribe();
  }

  /** Stores the file selected in a certificate / private key input (mtls). */
  onCertificateFileSelected(event: Event, controlName: 'certificate' | 'privateKey'): void {
    const input = event.target as HTMLInputElement | null;
    const control = this.loginForm.get(controlName);

    control?.setValue(input?.files?.[0] ?? null);
    control?.markAsTouched();
  }

  onSubmit(): void {
    if (this.isExternalAuth) {
      // Redirects to the identity provider (OIDC) or the API's SAML sign-in endpoint.
      this.authFacade.login();

      return;
    }

    if (this.loginForm.valid) {
      if (this.isUsersAuth) {
        const email = this.loginForm.get('email')?.value;
        const password = this.loginForm.get('password')?.value as string;

        if (typeof password === 'string' && password.startsWith('fp_pat_')) {
          this.patRejectedError = $localize`:@@featureLogin-patNotAllowed:Personal access tokens cannot be used to sign in to the console. Use your account password instead.`;
          this.authFacade.clearError();

          return;
        }

        this.patRejectedError = null;
        this.authFacade.login(undefined, email, password);
      } else if (this.isMtlsAuth) {
        const certificate = this.loginForm.get('certificate')?.value as File;
        const privateKey = (this.loginForm.get('privateKey')?.value as File | null) ?? undefined;

        this.authFacade.loginWithCertificate(certificate, privateKey);
      } else {
        this.patRejectedError = null;
        const apiKey = this.loginForm.get('apiKey')?.value;

        this.authFacade.login(apiKey);
      }
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.loginForm.controls).forEach((key) => {
        this.loginForm.get(key)?.markAsTouched();
      });
    }
  }
}
