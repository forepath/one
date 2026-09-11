import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AuthenticationState } from './authentication.types';

export const selectAuthenticationState = createFeatureSelector<AuthenticationState>('authentication');

// Basic state selectors
export const selectIsAuthenticated = createSelector(selectAuthenticationState, (state) => state.isAuthenticated);

export const selectAuthenticationType = createSelector(selectAuthenticationState, (state) => state.authenticationType);

export const selectUser = createSelector(selectAuthenticationState, (state) => state.user);

export const selectAuthenticationLoading = createSelector(selectAuthenticationState, (state) => state.loading);

export const selectAuthenticationError = createSelector(selectAuthenticationState, (state) => state.error);

export const selectSuccessMessage = createSelector(selectAuthenticationState, (state) => state.successMessage);

// Derived selectors
export const selectIsNotAuthenticated = createSelector(selectIsAuthenticated, (isAuthenticated) => !isAuthenticated);

// Users auth sub-state selectors
export const selectRegistering = createSelector(selectAuthenticationState, (state) => state.registering);

export const selectConfirmingEmail = createSelector(selectAuthenticationState, (state) => state.confirmingEmail);

export const selectRequestingPasswordReset = createSelector(
  selectAuthenticationState,
  (state) => state.requestingPasswordReset,
);

export const selectResettingPassword = createSelector(selectAuthenticationState, (state) => state.resettingPassword);

export const selectChangingPassword = createSelector(selectAuthenticationState, (state) => state.changingPassword);

// Admin users selectors
export const selectUsers = createSelector(selectAuthenticationState, (state) => state.users);

export const selectUsersLoading = createSelector(selectAuthenticationState, (state) => state.usersLoading);

export const selectUsersError = createSelector(selectAuthenticationState, (state) => state.usersError);

export const selectCreatingUser = createSelector(selectAuthenticationState, (state) => state.creatingUser);

export const selectUpdatingUser = createSelector(selectAuthenticationState, (state) => state.updatingUser);

export const selectDeletingUser = createSelector(selectAuthenticationState, (state) => state.deletingUser);

export const selectLockingUser = createSelector(selectAuthenticationState, (state) => state.lockingUser);

export const selectUnlockingUser = createSelector(selectAuthenticationState, (state) => state.unlockingUser);

export const selectTwoFactorStatus = createSelector(selectAuthenticationState, (state) => state.twoFactorStatus);

export const selectTwoFactorLoading = createSelector(selectAuthenticationState, (state) => state.twoFactorLoading);

export const selectTwoFactorError = createSelector(selectAuthenticationState, (state) => state.twoFactorError);

export const selectTwoFactorSuccessMessage = createSelector(
  selectAuthenticationState,
  (state) => state.twoFactorSuccessMessage,
);

export const selectTotpSetup = createSelector(selectAuthenticationState, (state) => state.totpSetup);

export const selectIsAdmin = createSelector(selectUser, (user) => user?.role === 'admin');

/**
 * True when the user can access the user manager (admin users/keycloak auth).
 */
export const selectCanAccessUserManager = createSelector(
  selectIsAuthenticated,
  selectAuthenticationType,
  selectIsAdmin,
  (isAuthenticated, authType, isAdmin) =>
    isAuthenticated && (authType === 'users' || authType === 'keycloak') && isAdmin,
);
