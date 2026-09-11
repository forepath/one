import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import type { IdentityAuthEnvironment, Login2faMethod } from '@forepath/identity/frontend';
import {
  AuthenticationFacade,
  IDENTITY_AUTH_ENVIRONMENT,
  isAuthMarketingPanelVisible,
  loginSuccess,
  PENDING_LOGIN_PASSWORD_STORAGE_KEY,
} from '@forepath/identity/frontend';
import { Actions, ofType } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { take, tap } from 'rxjs/operators';

import { IdentityOtpInputComponent } from '../otp-input/otp-input.component';

@Component({
  selector: 'identity-auth-login-2fa',
  imports: [CommonModule, ReactiveFormsModule, RouterModule, IdentityOtpInputComponent],
  styleUrls: ['./login-2fa.component.scss'],
  templateUrl: './login-2fa.component.html',
  standalone: true,
})
export class IdentityLogin2faComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  protected readonly authFacade = inject(AuthenticationFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  form!: FormGroup;
  formSubmitted = false;
  email = '';
  method: Login2faMethod = 'email';
  missingPassword = false;

  loading$: Observable<boolean> = this.authFacade.loading$;
  error$: Observable<string | null> = this.authFacade.error$;

  protected readonly authMarketing = this.environment.authMarketing;
  protected readonly showAuthMarketingPanel = isAuthMarketingPanelVisible(this.environment.authLayout);

  get isUsersAuth(): boolean {
    return this.environment.authentication.type === 'users';
  }

  get isTotpMethod(): boolean {
    return this.method === 'totp';
  }

  ngOnInit(): void {
    this.email = this.route.snapshot.queryParamMap.get('email') ?? '';
    const methodParam = this.route.snapshot.queryParamMap.get('method');

    this.method = methodParam === 'totp' ? 'totp' : 'email';

    // Challenge redirect is not a failure; clear any leftover message from login.
    this.authFacade.clearError();

    const password = sessionStorage.getItem(PENDING_LOGIN_PASSWORD_STORAGE_KEY) ?? '';

    this.missingPassword = !password;

    const codePattern = this.isTotpMethod ? /^\d{6}$/ : /^[A-Z0-9]{6}$/;

    this.form = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(codePattern)]],
    });

    this.actions$
      .pipe(
        ofType(loginSuccess),
        take(1),
        takeUntilDestroyed(this.destroyRef),
        tap(() => {
          sessionStorage.removeItem(PENDING_LOGIN_PASSWORD_STORAGE_KEY);
        }),
      )
      .subscribe();
  }

  onSubmit(): void {
    this.formSubmitted = true;

    if (!this.form.valid || this.missingPassword) {
      Object.keys(this.form.controls).forEach((key) => {
        this.form.get(key)?.markAsTouched();
      });

      return;
    }

    const password = sessionStorage.getItem(PENDING_LOGIN_PASSWORD_STORAGE_KEY) ?? '';
    let code = String(this.form.get('code')?.value ?? '');

    if (!this.isTotpMethod) {
      code = code.toUpperCase();
    }

    this.authFacade.login(undefined, this.email, password, code);
  }

  onCancel(): void {
    sessionStorage.removeItem(PENDING_LOGIN_PASSWORD_STORAGE_KEY);
    this.authFacade.clearError();
    void this.router.navigate(['/login']);
  }
}
