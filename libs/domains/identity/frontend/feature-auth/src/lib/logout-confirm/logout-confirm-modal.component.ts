import { CommonModule } from '@angular/common';
import { Component, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { FpcConfirmDialogComponent, FpcFormCheckComponent } from '@forepath/shared/frontend/ui-components';

export interface LogoutConfirmResult {
  invalidateAllSessions: boolean;
}

@Component({
  selector: 'identity-logout-confirm-modal',
  imports: [CommonModule, FpcConfirmDialogComponent, FpcFormCheckComponent],
  templateUrl: './logout-confirm-modal.component.html',
  standalone: true,
})
export class IdentityLogoutConfirmModalComponent {
  private readonly authenticationFacade = inject(AuthenticationFacade);

  readonly confirmed = output<LogoutConfirmResult>();

  readonly dialogOpen = signal(false);
  readonly logoutAllSessions = signal(false);

  readonly confirmLabel = $localize`:@@identityLogoutConfirm-confirm:Log out`;

  private readonly authenticationType = toSignal(this.authenticationFacade.authenticationType$, {
    initialValue: null,
  });

  open(): void {
    this.logoutAllSessions.set(false);
    this.dialogOpen.set(true);
  }

  onConfirm(): void {
    this.confirmed.emit({
      invalidateAllSessions: this.showLogoutAllSessionsOption() && this.logoutAllSessions(),
    });
  }

  showLogoutAllSessionsOption(): boolean {
    // users / saml sessions are app JWTs: "sign out everywhere" bumps the account's token version at the API.
    const type = this.authenticationType();

    return type === 'users' || type === 'saml';
  }

  modalTitle(): string {
    switch (this.authenticationType()) {
      case 'users':
      case 'saml':
        return $localize`:@@identityLogoutConfirm-usersTitle:Log out?`;
      case 'oidc':
        return $localize`:@@identityLogoutConfirm-oidcTitle:Log out?`;
      default:
        return $localize`:@@identityLogoutConfirm-defaultTitle:Log out?`;
    }
  }

  modalMessage(): string {
    switch (this.authenticationType()) {
      case 'users':
        return $localize`:@@identityLogoutConfirm-usersMessage:You will be signed out of this browser only. Other devices and browsers will stay signed in unless you choose to sign out everywhere below.`;
      case 'saml':
        return $localize`:@@identityLogoutConfirm-samlMessage:You will be signed out of this browser only. Your single sign-on session at your identity provider stays active unless you sign out there.`;
      case 'oidc':
        return $localize`:@@identityLogoutConfirm-oidcMessage:You will be signed out of this browser. If you use single sign-on, other applications may also require you to sign in again.`;
      default:
        return $localize`:@@identityLogoutConfirm-defaultMessage:Are you sure you want to log out?`;
    }
  }

  logoutAllSessionsLabel(): string {
    return $localize`:@@identityLogoutConfirm-logoutAllSessionsLabel:Also sign out all other devices and browsers`;
  }

  logoutAllSessionsHint(): string {
    return $localize`:@@identityLogoutConfirm-logoutAllSessionsHint:For security, this ends every active session for your account.`;
  }
}
