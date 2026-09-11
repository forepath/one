import { createReducer, on } from '@ngrx/store';

import {
  adminClearTotp,
  adminClearTotpFailure,
  adminClearTotpSuccess,
  changePassword,
  changePasswordFailure,
  changePasswordSuccess,
  checkAuthentication,
  checkAuthenticationFailure,
  checkAuthenticationSuccess,
  clearError,
  clearSuccessMessage,
  clearTwoFactorMessages,
  confirmEmail,
  confirmEmailFailure,
  confirmEmailSuccess,
  confirmTotp,
  confirmTotpFailure,
  confirmTotpSuccess,
  createUser,
  createUserFailure,
  createUserSuccess,
  deleteUser,
  deleteUserFailure,
  deleteUserSuccess,
  disableEmail2fa,
  disableEmail2faFailure,
  disableEmail2faSuccess,
  disableTotp,
  disableTotpFailure,
  disableTotpSuccess,
  enableEmail2fa,
  enableEmail2faFailure,
  enableEmail2faSuccess,
  lockUser,
  lockUserFailure,
  lockUserSuccess,
  loadTwoFactorStatus,
  loadTwoFactorStatusFailure,
  loadTwoFactorStatusSuccess,
  loadUsers,
  loadUsersBatch,
  loadUsersFailure,
  loadUsersSuccess,
  login,
  loginFailure,
  loginSuccess,
  logout,
  logoutFailure,
  logoutSuccess,
  register,
  registerFailure,
  registerSuccess,
  requestPasswordReset,
  requestPasswordResetFailure,
  requestPasswordResetSuccess,
  resetPassword,
  resetPasswordFailure,
  resetPasswordSuccess,
  setupTotp,
  setupTotpFailure,
  setupTotpSuccess,
  unlockUser,
  unlockUserFailure,
  unlockUserSuccess,
  updateUser,
  updateUserFailure,
  updateUserSuccess,
} from './authentication.actions';
import type { AuthenticationState, UserInfo } from './authentication.types';

export type { AuthenticationState };

const setUser = (user?: { id: string; email: string; role: string }): UserInfo | null =>
  user ? { id: user.id, email: user.email, role: user.role as UserInfo['role'] } : null;

export const initialAuthenticationState: AuthenticationState = {
  isAuthenticated: false,
  authenticationType: null,
  user: null,
  loading: false,
  error: null,
  successMessage: null,
  registering: false,
  confirmingEmail: false,
  requestingPasswordReset: false,
  resettingPassword: false,
  changingPassword: false,
  users: [],
  usersLoading: false,
  usersError: null,
  creatingUser: false,
  updatingUser: false,
  deletingUser: false,
  lockingUser: false,
  unlockingUser: false,
  twoFactorStatus: null,
  twoFactorLoading: false,
  twoFactorError: null,
  twoFactorSuccessMessage: null,
  totpSetup: null,
};

export const authenticationReducer = createReducer(
  initialAuthenticationState,
  // Login
  on(clearSuccessMessage, (state) => ({
    ...state,
    successMessage: null,
  })),
  on(clearError, (state) => ({
    ...state,
    error: null,
  })),
  on(clearTwoFactorMessages, (state) => ({
    ...state,
    twoFactorError: null,
    twoFactorSuccessMessage: null,
  })),
  on(login, (state) => ({
    ...state,
    loading: true,
    error: null,
    successMessage: null,
  })),
  on(loginSuccess, (state, { authenticationType, user }) => ({
    ...state,
    isAuthenticated: true,
    authenticationType,
    user: setUser(user),
    loading: false,
    error: null,
  })),
  on(loginFailure, (state, { error, login2fa }) => ({
    ...state,
    loading: false,
    // 2FA challenge is expected flow, not a user-facing failure
    error: login2fa ? null : error,
  })),
  // Logout
  on(logout, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(logoutSuccess, () => ({
    ...initialAuthenticationState,
  })),
  on(logoutFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  // Check Authentication
  on(checkAuthentication, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(checkAuthenticationSuccess, (state, { isAuthenticated, authenticationType, user }) => ({
    ...state,
    isAuthenticated,
    authenticationType: authenticationType ?? state.authenticationType,
    user: user ? setUser(user) : state.user,
    loading: false,
    error: null,
  })),
  on(checkAuthenticationFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  // Register
  on(register, (state) => ({
    ...state,
    registering: true,
    error: null,
  })),
  on(registerSuccess, (state, { message }) => ({
    ...state,
    registering: false,
    error: null,
    successMessage: message,
  })),
  on(registerFailure, (state, { error }) => ({
    ...state,
    registering: false,
    error,
  })),
  // Confirm Email
  on(confirmEmail, (state) => ({
    ...state,
    confirmingEmail: true,
    error: null,
  })),
  on(confirmEmailSuccess, (state) => ({
    ...state,
    confirmingEmail: false,
    error: null,
    successMessage: 'Email confirmed successfully. You can now log in.',
  })),
  on(confirmEmailFailure, (state, { error }) => ({
    ...state,
    confirmingEmail: false,
    error,
  })),
  // Request Password Reset
  on(requestPasswordReset, (state) => ({
    ...state,
    requestingPasswordReset: true,
    error: null,
  })),
  on(requestPasswordResetSuccess, (state) => ({
    ...state,
    requestingPasswordReset: false,
    error: null,
    successMessage: 'If an account exists for that email, you will receive a password reset link.',
  })),
  on(requestPasswordResetFailure, (state, { error }) => ({
    ...state,
    requestingPasswordReset: false,
    error,
  })),
  // Reset Password
  on(resetPassword, (state) => ({
    ...state,
    resettingPassword: true,
    error: null,
  })),
  on(resetPasswordSuccess, (state) => ({
    ...state,
    resettingPassword: false,
    error: null,
    successMessage: 'Password reset successfully. You can now log in with your new password.',
  })),
  on(resetPasswordFailure, (state, { error }) => ({
    ...state,
    resettingPassword: false,
    error,
  })),
  // Change Password
  on(changePassword, (state) => ({
    ...state,
    changingPassword: true,
    error: null,
  })),
  on(changePasswordSuccess, (state) => ({
    ...state,
    changingPassword: false,
    error: null,
  })),
  on(changePasswordFailure, (state, { error }) => ({
    ...state,
    changingPassword: false,
    error,
  })),
  // Login 2FA self-service
  on(loadTwoFactorStatus, (state) => ({
    ...state,
    twoFactorLoading: true,
    twoFactorError: null,
  })),
  on(loadTwoFactorStatusSuccess, (state, { status }) => ({
    ...state,
    twoFactorStatus: status,
    twoFactorLoading: false,
    twoFactorError: null,
  })),
  on(loadTwoFactorStatusFailure, (state, { error }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: error,
  })),
  on(enableEmail2fa, (state) => ({
    ...state,
    twoFactorLoading: true,
    twoFactorError: null,
    twoFactorSuccessMessage: null,
  })),
  on(enableEmail2faSuccess, (state, { message }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: null,
    twoFactorSuccessMessage: message,
  })),
  on(enableEmail2faFailure, (state, { error }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: error,
  })),
  on(disableEmail2fa, (state) => ({
    ...state,
    twoFactorLoading: true,
    twoFactorError: null,
    twoFactorSuccessMessage: null,
  })),
  on(disableEmail2faSuccess, (state, { message }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: null,
    twoFactorSuccessMessage: message,
  })),
  on(disableEmail2faFailure, (state, { error }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: error,
  })),
  on(setupTotp, (state) => ({
    ...state,
    twoFactorLoading: true,
    twoFactorError: null,
    twoFactorSuccessMessage: null,
    totpSetup: null,
  })),
  on(setupTotpSuccess, (state, { setup }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: null,
    totpSetup: setup,
  })),
  on(setupTotpFailure, (state, { error }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: error,
  })),
  on(confirmTotp, (state) => ({
    ...state,
    twoFactorLoading: true,
    twoFactorError: null,
    twoFactorSuccessMessage: null,
  })),
  on(confirmTotpSuccess, (state, { message }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: null,
    twoFactorSuccessMessage: message,
    totpSetup: null,
  })),
  on(confirmTotpFailure, (state, { error }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: error,
  })),
  on(disableTotp, (state) => ({
    ...state,
    twoFactorLoading: true,
    twoFactorError: null,
    twoFactorSuccessMessage: null,
  })),
  on(disableTotpSuccess, (state, { message }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: null,
    twoFactorSuccessMessage: message,
  })),
  on(disableTotpFailure, (state, { error }) => ({
    ...state,
    twoFactorLoading: false,
    twoFactorError: error,
  })),
  on(adminClearTotp, (state) => ({
    ...state,
    twoFactorLoading: true,
    usersError: null,
  })),
  on(adminClearTotpSuccess, (state, { userId }) => ({
    ...state,
    twoFactorLoading: false,
    users: state.users.map((u) => (u.id === userId ? { ...u, totpEnabled: false } : u)),
  })),
  on(adminClearTotpFailure, (state, { error }) => ({
    ...state,
    twoFactorLoading: false,
    usersError: error,
  })),
  // Admin: Load Users
  on(loadUsers, (state) => ({
    ...state,
    users: [],
    usersLoading: true,
    usersError: null,
  })),
  on(loadUsersBatch, (state, { accumulatedUsers }) => ({
    ...state,
    users: accumulatedUsers,
    usersLoading: true,
    usersError: null,
  })),
  on(loadUsersSuccess, (state, { users }) => ({
    ...state,
    users,
    usersLoading: false,
    usersError: null,
  })),
  on(loadUsersFailure, (state, { error }) => ({
    ...state,
    usersLoading: false,
    usersError: error,
  })),
  // Admin: Create User
  on(createUser, (state) => ({
    ...state,
    creatingUser: true,
    usersError: null,
  })),
  on(createUserSuccess, (state, { user }) => ({
    ...state,
    users: [...state.users, user],
    creatingUser: false,
    usersError: null,
  })),
  on(createUserFailure, (state, { error }) => ({
    ...state,
    creatingUser: false,
    usersError: error,
  })),
  // Admin: Update User
  on(updateUser, (state) => ({
    ...state,
    updatingUser: true,
    usersError: null,
  })),
  on(updateUserSuccess, (state, { user }) => ({
    ...state,
    users: state.users.map((u) => (u.id === user.id ? user : u)),
    updatingUser: false,
    usersError: null,
  })),
  on(updateUserFailure, (state, { error }) => ({
    ...state,
    updatingUser: false,
    usersError: error,
  })),
  // Admin: Delete User
  on(deleteUser, (state) => ({
    ...state,
    deletingUser: true,
    usersError: null,
  })),
  on(deleteUserSuccess, (state, { id }) => ({
    ...state,
    users: state.users.filter((u) => u.id !== id),
    deletingUser: false,
    usersError: null,
  })),
  on(deleteUserFailure, (state, { error }) => ({
    ...state,
    deletingUser: false,
    usersError: error,
  })),
  // Admin: Lock User
  on(lockUser, (state) => ({
    ...state,
    lockingUser: true,
    usersError: null,
  })),
  on(lockUserSuccess, (state, { user }) => ({
    ...state,
    users: state.users.map((u) => (u.id === user.id ? user : u)),
    lockingUser: false,
    usersError: null,
  })),
  on(lockUserFailure, (state, { error }) => ({
    ...state,
    lockingUser: false,
    usersError: error,
  })),
  // Admin: Unlock User
  on(unlockUser, (state) => ({
    ...state,
    unlockingUser: true,
    usersError: null,
  })),
  on(unlockUserSuccess, (state, { user }) => ({
    ...state,
    users: state.users.map((u) => (u.id === user.id ? user : u)),
    unlockingUser: false,
    usersError: null,
  })),
  on(unlockUserFailure, (state, { error }) => ({
    ...state,
    unlockingUser: false,
    usersError: error,
  })),
);
