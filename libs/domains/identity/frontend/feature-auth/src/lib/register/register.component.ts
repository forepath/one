import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
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
import { AuthenticationFacade, AuthService, registerSuccess } from '@forepath/identity/frontend';
import { IDENTITY_AUTH_ENVIRONMENT, isAuthMarketingPanelVisible } from '@forepath/identity/frontend';
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
import { Observable, of } from 'rxjs';
import { catchError, take, tap } from 'rxjs/operators';

@Component({
  selector: 'identity-auth-register',
  imports: [
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
  private readonly authService = inject(AuthService);

  /**
   * True while the deployment requires the one-time admin claim token for its first account (opt-in through
   * `IdentityAuthEnvironment.adminClaimStatusUrl`, e.g. Loadweaver Cloud); then the claim-token field is shown.
   */
  protected readonly adminClaimRequired = signal(false);

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
    this.authFacade.clearError();
    this.authFacade.clearSuccessMessage();

    this.registerForm = this.fb.group(
      {
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(8)]],
        passwordConfirmation: ['', [Validators.required]],
        adminClaimToken: [''],
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
        tap(() => {
          this.registerForm.reset();
          // The first account exists now: no further registration needs the claim.
          this.setAdminClaimRequired(false);
        }),
      )
      .subscribe();

    this.loadAdminClaimStatus();
  }

  private loadAdminClaimStatus(): void {
    const url = this.environment.adminClaimStatusUrl;

    if (!url || !this.isUsersAuth) {
      return;
    }

    this.authService
      .getAdminClaimStatus(url)
      .pipe(
        take(1),
        catchError(() => of({ claimRequired: false })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ claimRequired }) => this.setAdminClaimRequired(claimRequired === true));
  }

  private setAdminClaimRequired(required: boolean): void {
    const control = this.registerForm.get('adminClaimToken');

    this.adminClaimRequired.set(required);
    control?.setValidators(required ? [Validators.required, Validators.maxLength(256)] : []);
    control?.updateValueAndValidity();
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
      const adminClaimToken = this.adminClaimRequired()
        ? String(this.registerForm.get('adminClaimToken')?.value ?? '').trim()
        : '';

      if (adminClaimToken) {
        this.authFacade.register(email, password, adminClaimToken);
      } else {
        this.authFacade.register(email, password);
      }
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
