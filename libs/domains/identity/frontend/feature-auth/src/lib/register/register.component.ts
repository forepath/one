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
import { RouterModule } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import { AuthenticationFacade, registerSuccess } from '@forepath/identity/frontend';
import { IDENTITY_AUTH_ENVIRONMENT, isAuthMarketingPanelVisible } from '@forepath/identity/frontend';
import { Actions, ofType } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { take, tap } from 'rxjs/operators';

@Component({
  selector: 'identity-auth-register',
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  styleUrls: ['./register.component.scss'],
  templateUrl: './register.component.html',
  standalone: true,
})
export class IdentityRegisterComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  protected readonly authFacade = inject(AuthenticationFacade);
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  registerForm!: FormGroup;
  registering$: Observable<boolean> = this.authFacade.registering$;
  error$: Observable<string | null> = this.authFacade.error$;
  successMessage$: Observable<string | null> = this.authFacade.successMessage$;

  /** Shown on the registration form when both URLs are configured (e.g. from {@code cookieConsent}). */
  protected readonly termsUrl = this.environment.termsUrl;
  protected readonly privacyPolicyUrl = this.environment.privacyPolicyUrl;
  protected readonly registerDescription = this.environment.authMarketing.registerDescription;
  protected readonly showAuthMarketingPanel = isAuthMarketingPanelVisible(this.environment.authLayout);

  get isUsersAuth(): boolean {
    return this.environment.authentication.type === 'users';
  }

  ngOnInit(): void {
    this.registerForm = this.fb.group(
      {
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(8)]],
        passwordConfirmation: ['', [Validators.required]],
      },
      {
        validators: this.passwordMatchValidator,
      },
    );

    this.actions$
      .pipe(
        ofType(registerSuccess),
        take(1),
        takeUntilDestroyed(this.destroyRef),
        tap(() => this.registerForm.reset()),
      )
      .subscribe();
  }

  private passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
    const password = group.get('password')?.value;
    const passwordConfirmation = group.get('passwordConfirmation')?.value;

    if (password && passwordConfirmation && password !== passwordConfirmation) {
      return { passwordMismatch: true };
    }

    return null;
  }

  onSubmit(): void {
    if (this.registerForm.valid) {
      const email = this.registerForm.get('email')?.value;
      const password = this.registerForm.get('password')?.value;

      this.authFacade.register(email, password);
    } else {
      Object.keys(this.registerForm.controls).forEach((key) => {
        this.registerForm.get(key)?.markAsTouched();
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
