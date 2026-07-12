import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, output, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthenticationFacade } from '@forepath/identity/frontend';

import { hideAuthModal, showAuthModal } from './auth-modal.util';

export interface LogoutConfirmResult {
  invalidateAllSessions: boolean;
}

@Component({
  selector: 'identity-logout-confirm-modal',
  imports: [CommonModule],
  templateUrl: './logout-confirm-modal.component.html',
  standalone: true,
})
export class IdentityLogoutConfirmModalComponent {
  private readonly authenticationFacade = inject(AuthenticationFacade);

  readonly confirmed = output<LogoutConfirmResult>();

  @ViewChild('modal', { static: true }) private readonly modalRef!: ElementRef<HTMLDivElement>;

  readonly logoutAllSessions = signal(false);

  private readonly authenticationType = toSignal(this.authenticationFacade.authenticationType$, {
    initialValue: null,
  });

  open(): void {
    this.logoutAllSessions.set(false);
    showAuthModal(this.modalRef);
  }

  onConfirm(): void {
    hideAuthModal(this.modalRef);
    this.confirmed.emit({
      invalidateAllSessions: this.showLogoutAllSessionsOption() && this.logoutAllSessions(),
    });
  }

  showLogoutAllSessionsOption(): boolean {
    return this.authenticationType() === 'users';
  }

  modalTitle(): string {
    switch (this.authenticationType()) {
      case 'users':
        return $localize`:@@identityLogoutConfirm-usersTitle:Log out?`;
      case 'keycloak':
        return $localize`:@@identityLogoutConfirm-keycloakTitle:Log out?`;
      default:
        return $localize`:@@identityLogoutConfirm-defaultTitle:Log out?`;
    }
  }

  modalMessage(): string {
    switch (this.authenticationType()) {
      case 'users':
        return $localize`:@@identityLogoutConfirm-usersMessage:You will be signed out of this browser only. Other devices and browsers will stay signed in unless you choose to sign out everywhere below.`;
      case 'keycloak':
        return $localize`:@@identityLogoutConfirm-keycloakMessage:You will be signed out of this browser. If you use single sign-on, other applications may also require you to sign in again.`;
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
