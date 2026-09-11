import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  adminClearTotp,
  changePassword,
  checkAuthentication,
  clearError,
  clearSuccessMessage,
  clearTwoFactorMessages,
  confirmEmail,
  confirmTotp,
  createUser,
  deleteUser,
  disableEmail2fa,
  disableTotp,
  enableEmail2fa,
  lockUser,
  loadTwoFactorStatus,
  loadUsers,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  setupTotp,
  unlockUser,
  updateUser,
} from './authentication.actions';
import {
  selectAuthenticationError,
  selectAuthenticationLoading,
  selectAuthenticationType,
  selectCanAccessUserManager,
  selectChangingPassword,
  selectConfirmingEmail,
  selectCreatingUser,
  selectDeletingUser,
  selectIsAdmin,
  selectIsAuthenticated,
  selectIsNotAuthenticated,
  selectLockingUser,
  selectRegistering,
  selectRequestingPasswordReset,
  selectResettingPassword,
  selectSuccessMessage,
  selectTotpSetup,
  selectTwoFactorError,
  selectTwoFactorLoading,
  selectTwoFactorStatus,
  selectTwoFactorSuccessMessage,
  selectUnlockingUser,
  selectUpdatingUser,
  selectUser,
  selectUsers,
  selectUsersError,
  selectUsersLoading,
} from './authentication.selectors';
import type { CreateUserDto, TotpSetup, TwoFactorStatus, UpdateUserDto, UserResponseDto } from './authentication.types';

@Injectable({
  providedIn: 'root',
})
export class AuthenticationFacade {
  private readonly store = inject(Store);

  readonly isAuthenticated$: Observable<boolean> = this.store.select(selectIsAuthenticated);
  readonly isNotAuthenticated$: Observable<boolean> = this.store.select(selectIsNotAuthenticated);
  readonly authenticationType$: Observable<'api-key' | 'keycloak' | 'users' | null> =
    this.store.select(selectAuthenticationType);
  readonly user$: Observable<{ id: string; email: string; role: string } | null> = this.store.select(selectUser);
  readonly isAdmin$: Observable<boolean> = this.store.select(selectIsAdmin);
  readonly canAccessUserManager$: Observable<boolean> = this.store.select(selectCanAccessUserManager);
  readonly canAccessBillingAdministration$: Observable<boolean> = this.canAccessUserManager$;
  readonly loading$: Observable<boolean> = this.store.select(selectAuthenticationLoading);
  readonly error$: Observable<string | null> = this.store.select(selectAuthenticationError);
  readonly successMessage$: Observable<string | null> = this.store.select(selectSuccessMessage);

  readonly registering$: Observable<boolean> = this.store.select(selectRegistering);
  readonly confirmingEmail$: Observable<boolean> = this.store.select(selectConfirmingEmail);
  readonly requestingPasswordReset$: Observable<boolean> = this.store.select(selectRequestingPasswordReset);
  readonly resettingPassword$: Observable<boolean> = this.store.select(selectResettingPassword);
  readonly changingPassword$: Observable<boolean> = this.store.select(selectChangingPassword);

  readonly users$: Observable<UserResponseDto[]> = this.store.select(selectUsers);
  readonly usersLoading$: Observable<boolean> = this.store.select(selectUsersLoading);
  readonly usersError$: Observable<string | null> = this.store.select(selectUsersError);
  readonly creatingUser$: Observable<boolean> = this.store.select(selectCreatingUser);
  readonly updatingUser$: Observable<boolean> = this.store.select(selectUpdatingUser);
  readonly deletingUser$: Observable<boolean> = this.store.select(selectDeletingUser);
  readonly lockingUser$: Observable<boolean> = this.store.select(selectLockingUser);
  readonly unlockingUser$: Observable<boolean> = this.store.select(selectUnlockingUser);

  readonly twoFactorStatus$: Observable<TwoFactorStatus | null> = this.store.select(selectTwoFactorStatus);
  readonly twoFactorLoading$: Observable<boolean> = this.store.select(selectTwoFactorLoading);
  readonly twoFactorError$: Observable<string | null> = this.store.select(selectTwoFactorError);
  readonly twoFactorSuccessMessage$: Observable<string | null> = this.store.select(selectTwoFactorSuccessMessage);
  readonly totpSetup$: Observable<TotpSetup | null> = this.store.select(selectTotpSetup);

  login(apiKey?: string, email?: string, password?: string, code?: string): void {
    this.store.dispatch(login({ apiKey, email, password, code }));
  }

  logout(invalidateAllSessions = false): void {
    this.store.dispatch(logout({ invalidateAllSessions }));
  }

  checkAuthentication(): void {
    this.store.dispatch(checkAuthentication());
  }

  register(email: string, password: string): void {
    this.store.dispatch(register({ email, password }));
  }

  confirmEmail(email: string, code: string): void {
    this.store.dispatch(confirmEmail({ email, code }));
  }

  requestPasswordReset(email: string): void {
    this.store.dispatch(requestPasswordReset({ email }));
  }

  resetPassword(email: string, code: string, newPassword: string): void {
    this.store.dispatch(resetPassword({ email, code, newPassword }));
  }

  changePassword(currentPassword: string, newPassword: string, newPasswordConfirmation: string): void {
    this.store.dispatch(
      changePassword({
        currentPassword,
        newPassword,
        newPasswordConfirmation,
      }),
    );
  }

  loadTwoFactorStatus(): void {
    this.store.dispatch(loadTwoFactorStatus());
  }

  enableEmail2fa(code?: string): void {
    this.store.dispatch(enableEmail2fa({ code }));
  }

  disableEmail2fa(currentPassword: string): void {
    this.store.dispatch(disableEmail2fa({ currentPassword }));
  }

  setupTotp(currentPassword: string): void {
    this.store.dispatch(setupTotp({ currentPassword }));
  }

  confirmTotp(code: string): void {
    this.store.dispatch(confirmTotp({ code }));
  }

  disableTotp(code: string): void {
    this.store.dispatch(disableTotp({ code }));
  }

  adminClearTotp(userId: string): void {
    this.store.dispatch(adminClearTotp({ userId }));
  }

  clearTwoFactorMessages(): void {
    this.store.dispatch(clearTwoFactorMessages());
  }

  loadUsers(limit?: number, offset?: number): void {
    this.store.dispatch(loadUsers({ limit, offset }));
  }

  createUser(user: CreateUserDto): void {
    this.store.dispatch(createUser({ user }));
  }

  updateUser(id: string, user: UpdateUserDto): void {
    this.store.dispatch(updateUser({ id, user }));
  }

  deleteUser(id: string): void {
    this.store.dispatch(deleteUser({ id }));
  }

  lockUser(id: string): void {
    this.store.dispatch(lockUser({ id }));
  }

  unlockUser(id: string): void {
    this.store.dispatch(unlockUser({ id }));
  }

  clearError(): void {
    this.store.dispatch(clearError());
  }

  clearSuccessMessage(): void {
    this.store.dispatch(clearSuccessMessage());
  }
}
