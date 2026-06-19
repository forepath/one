import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import { AuthenticationFacade, confirmEmailSuccess, IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
import { Actions, ofType } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { take, tap } from 'rxjs/operators';

import { IdentityOtpInputComponent } from '../otp-input/otp-input.component';

@Component({
  selector: 'identity-auth-confirm-email',
  imports: [CommonModule, ReactiveFormsModule, RouterModule, IdentityOtpInputComponent],
  styleUrls: ['./confirm-email.component.scss'],
  templateUrl: './confirm-email.component.html',
  standalone: true,
})
export class IdentityConfirmEmailComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  protected readonly authFacade = inject(AuthenticationFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  form!: FormGroup;
  formSubmitted = false;
  confirmingEmail$: Observable<boolean> = this.authFacade.confirmingEmail$;
  error$: Observable<string | null> = this.authFacade.error$;
  successMessage$: Observable<string | null> = this.authFacade.successMessage$;

  protected readonly authMarketing = this.environment.authMarketing;

  get isUsersAuth(): boolean {
    return this.environment.authentication.type === 'users';
  }

  ngOnInit(): void {
    const emailFromQuery = this.route.snapshot.queryParamMap.get('email') ?? '';
    const codeFromQuery = (this.route.snapshot.queryParamMap.get('code') ?? '').toUpperCase();

    this.form = this.fb.group({
      email: [emailFromQuery, [Validators.required, Validators.email]],
      code: [codeFromQuery, [Validators.required, Validators.pattern(/^[A-Z0-9]{6}$/)]],
    });

    this.actions$
      .pipe(
        ofType(confirmEmailSuccess),
        take(1),
        takeUntilDestroyed(this.destroyRef),
        tap(() => {
          this.formSubmitted = false;
          this.form.reset({
            email: this.route.snapshot.queryParamMap.get('email') ?? '',
            code: '',
          });
        }),
      )
      .subscribe();

    if (this.isUsersAuth && emailFromQuery && /^[A-Z0-9]{6}$/.test(codeFromQuery)) {
      this.authFacade.confirmEmail(emailFromQuery, codeFromQuery);
    }
  }

  onSubmit(): void {
    this.formSubmitted = true;

    if (this.form.valid) {
      const email = this.form.get('email')?.value;
      const code = this.form.get('code')?.value;

      this.authFacade.confirmEmail(email, code);
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
