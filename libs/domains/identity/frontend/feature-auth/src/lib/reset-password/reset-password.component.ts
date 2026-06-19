import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import { AuthenticationFacade, IDENTITY_AUTH_ENVIRONMENT, resetPasswordSuccess } from '@forepath/identity/frontend';
import { Actions, ofType } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { take, tap } from 'rxjs/operators';

import { IdentityOtpInputComponent } from '../otp-input/otp-input.component';

@Component({
  selector: 'identity-auth-reset-password',
  imports: [CommonModule, RouterModule, ReactiveFormsModule, IdentityOtpInputComponent],
  styleUrls: ['./reset-password.component.scss'],
  templateUrl: './reset-password.component.html',
  standalone: true,
})
export class IdentityResetPasswordComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  protected readonly authFacade = inject(AuthenticationFacade);
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  form!: FormGroup;
  formSubmitted = false;
  resettingPassword$: Observable<boolean> = this.authFacade.resettingPassword$;
  error$: Observable<string | null> = this.authFacade.error$;
  successMessage$: Observable<string | null> = this.authFacade.successMessage$;

  protected readonly authMarketing = this.environment.authMarketing;

  get isUsersAuth(): boolean {
    return this.environment.authentication.type === 'users';
  }

  ngOnInit(): void {
    const emailFromQuery = this.route.snapshot.queryParamMap.get('email') ?? '';

    this.form = this.fb.group(
      {
        email: [emailFromQuery, [Validators.required, Validators.email]],
        code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{6}$/)]],
        newPassword: ['', [Validators.required, Validators.minLength(8)]],
        newPasswordConfirmation: ['', [Validators.required]],
      },
      {
        validators: this.passwordMatchValidator,
      },
    );

    this.actions$
      .pipe(
        ofType(resetPasswordSuccess),
        take(1),
        takeUntilDestroyed(this.destroyRef),
        tap(() => {
          this.formSubmitted = false;
          this.form.reset({
            email: this.route.snapshot.queryParamMap.get('email') ?? '',
            code: '',
            newPassword: '',
            newPasswordConfirmation: '',
          });
        }),
      )
      .subscribe();
  }

  private passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
    const password = group.get('newPassword')?.value;
    const passwordConfirmation = group.get('newPasswordConfirmation')?.value;

    if (password && passwordConfirmation && password !== passwordConfirmation) {
      return { passwordMismatch: true };
    }

    return null;
  }

  onSubmit(): void {
    this.formSubmitted = true;

    if (this.form.valid) {
      const email = this.form.get('email')?.value;
      const code = this.form.get('code')?.value;
      const newPassword = this.form.get('newPassword')?.value;

      this.authFacade.resetPassword(email, code, newPassword);
    } else {
      Object.keys(this.form.controls).forEach((key) => {
        this.form.get(key)?.markAsTouched();
      });
    }
  }

  onDismissSuccess(): void {
    this.authFacade.clearSuccessMessage();
  }

  onDismissError(): void {
    this.authFacade.clearError();
  }
}
