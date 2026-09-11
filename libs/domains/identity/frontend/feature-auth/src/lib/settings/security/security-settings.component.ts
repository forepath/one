import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  AuthenticationFacade,
  changePasswordSuccess,
  confirmTotpSuccess,
  disableTotpSuccess,
  enableEmail2faSuccess,
  IDENTITY_AUTH_ENVIRONMENT,
  type TotpSetup,
} from '@forepath/identity/frontend';
import { Actions, ofType } from '@ngrx/effects';
import QRCode from 'qrcode';
import { filter } from 'rxjs/operators';

import { IdentityOtpInputComponent } from '../../otp-input/otp-input.component';

function passwordsMatchValidator(control: AbstractControl): ValidationErrors | null {
  const newPassword = control.get('newPassword')?.value;
  const confirmation = control.get('newPasswordConfirmation')?.value;

  if (!newPassword || !confirmation || newPassword === confirmation) {
    return null;
  }

  return { passwordsMismatch: true };
}

@Component({
  selector: 'identity-auth-security-settings',
  imports: [CommonModule, ReactiveFormsModule, IdentityOtpInputComponent],
  templateUrl: './security-settings.component.html',
  styleUrls: ['./security-settings.component.scss'],
  standalone: true,
})
export class IdentitySecuritySettingsComponent implements OnInit {
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly actions$ = inject(Actions);

  readonly status = toSignal(this.authFacade.twoFactorStatus$, { initialValue: null });
  readonly loading = toSignal(this.authFacade.twoFactorLoading$, { initialValue: false });
  readonly error = toSignal(this.authFacade.twoFactorError$, { initialValue: null as string | null });
  readonly successMessage = toSignal(this.authFacade.twoFactorSuccessMessage$, {
    initialValue: null as string | null,
  });
  readonly totpSetup = toSignal(this.authFacade.totpSetup$, { initialValue: null as TotpSetup | null });

  readonly email2faPending = signal(false);
  readonly qrDataUrl = signal<string | null>(null);
  readonly showDisableTotp = signal(false);
  readonly showDisableEmail = signal(false);
  readonly showSetupTotp = signal(false);
  readonly showChangePassword = signal(false);

  emailConfirmForm!: FormGroup;
  emailDisableForm!: FormGroup;
  totpSetupForm!: FormGroup;
  totpConfirmForm!: FormGroup;
  totpDisableForm!: FormGroup;
  changePasswordForm!: FormGroup;

  get isUsersAuth(): boolean {
    return this.environment.authentication.type === 'users';
  }

  ngOnInit(): void {
    this.emailConfirmForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{6}$/)]],
    });
    this.emailDisableForm = this.fb.group({
      currentPassword: ['', [Validators.required]],
    });
    this.totpSetupForm = this.fb.group({
      currentPassword: ['', [Validators.required]],
    });
    this.totpConfirmForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
    this.totpDisableForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
    this.changePasswordForm = this.fb.group(
      {
        currentPassword: ['', [Validators.required]],
        newPassword: ['', [Validators.required, Validators.minLength(8)]],
        newPasswordConfirmation: ['', [Validators.required, Validators.minLength(8)]],
      },
      { validators: passwordsMatchValidator },
    );

    if (this.isUsersAuth) {
      this.authFacade.loadTwoFactorStatus();
    }

    this.destroyRef.onDestroy(() => {
      this.authFacade.clearTwoFactorMessages();
    });

    this.actions$.pipe(ofType(enableEmail2faSuccess), takeUntilDestroyed(this.destroyRef)).subscribe(({ pending }) => {
      if (pending) {
        this.email2faPending.set(true);
      } else {
        this.email2faPending.set(false);
        this.emailConfirmForm.reset({ code: '' });
      }
    });

    this.actions$.pipe(ofType(confirmTotpSuccess), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.totpConfirmForm.reset({ code: '' });
      this.totpSetupForm.reset({ currentPassword: '' });
      this.showSetupTotp.set(false);
      this.qrDataUrl.set(null);
    });

    this.actions$.pipe(ofType(disableTotpSuccess), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.showDisableTotp.set(false);
      this.totpDisableForm.reset({ code: '' });
    });

    this.actions$.pipe(ofType(changePasswordSuccess), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.showChangePassword.set(false);
      this.changePasswordForm.reset({
        currentPassword: '',
        newPassword: '',
        newPasswordConfirmation: '',
      });
    });

    this.authFacade.totpSetup$
      .pipe(
        filter((setup): setup is TotpSetup => !!setup),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((setup) => {
        this.showSetupTotp.set(false);
        void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then((url) => {
          this.qrDataUrl.set(url);
        });
      });
  }

  onEnableEmail2fa(): void {
    this.authFacade.clearTwoFactorMessages();
    this.authFacade.enableEmail2fa();
  }

  onConfirmEmail2fa(): void {
    if (this.emailConfirmForm.invalid) {
      this.emailConfirmForm.markAllAsTouched();

      return;
    }

    const code = String(this.emailConfirmForm.get('code')?.value ?? '').toUpperCase();

    this.authFacade.enableEmail2fa(code);
  }

  onShowDisableEmail(): void {
    if (this.status()?.forceEnabled) {
      return;
    }

    this.showDisableEmail.set(true);
    this.authFacade.clearTwoFactorMessages();
  }

  onDisableEmail2fa(): void {
    if (this.status()?.forceEnabled) {
      return;
    }

    if (this.emailDisableForm.invalid) {
      this.emailDisableForm.markAllAsTouched();

      return;
    }

    const currentPassword = String(this.emailDisableForm.get('currentPassword')?.value ?? '');

    this.authFacade.disableEmail2fa(currentPassword);
    this.showDisableEmail.set(false);
    this.email2faPending.set(false);
    this.emailDisableForm.reset({ currentPassword: '' });
  }

  onShowChangePassword(): void {
    this.showChangePassword.set(true);
    this.authFacade.clearTwoFactorMessages();
  }

  onChangePassword(): void {
    if (this.changePasswordForm.invalid) {
      this.changePasswordForm.markAllAsTouched();

      return;
    }

    const currentPassword = String(this.changePasswordForm.get('currentPassword')?.value ?? '');
    const newPassword = String(this.changePasswordForm.get('newPassword')?.value ?? '');
    const newPasswordConfirmation = String(this.changePasswordForm.get('newPasswordConfirmation')?.value ?? '');

    this.authFacade.clearTwoFactorMessages();
    this.authFacade.changePassword(currentPassword, newPassword, newPasswordConfirmation);
  }

  onShowSetupTotp(): void {
    this.showSetupTotp.set(true);
    this.authFacade.clearTwoFactorMessages();
  }

  onSetupTotp(): void {
    if (this.totpSetupForm.invalid) {
      this.totpSetupForm.markAllAsTouched();

      return;
    }

    const currentPassword = String(this.totpSetupForm.get('currentPassword')?.value ?? '');

    this.authFacade.clearTwoFactorMessages();
    this.qrDataUrl.set(null);
    this.authFacade.setupTotp(currentPassword);
  }

  onConfirmTotp(): void {
    if (this.totpConfirmForm.invalid) {
      this.totpConfirmForm.markAllAsTouched();

      return;
    }

    const code = String(this.totpConfirmForm.get('code')?.value ?? '');

    this.authFacade.confirmTotp(code);
  }

  onShowDisableTotp(): void {
    this.showDisableTotp.set(true);
    this.authFacade.clearTwoFactorMessages();
  }

  onDisableTotp(): void {
    if (this.totpDisableForm.invalid) {
      this.totpDisableForm.markAllAsTouched();

      return;
    }

    const code = String(this.totpDisableForm.get('code')?.value ?? '');

    this.authFacade.disableTotp(code);
  }
}
