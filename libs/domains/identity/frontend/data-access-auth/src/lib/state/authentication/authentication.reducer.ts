import { createReducer, on } from '@ngrx/store';

import {
  changePassword,
  changePasswordFailure,
  changePasswordSuccess,
  checkAuthentication,
  checkAuthenticationFailure,
  checkAuthenticationSuccess,
  clearError,
  clearSuccessMessage,
  confirmEmail,
  confirmEmailFailure,
  confirmEmailSuccess,
  createUser,
  createUserFailure,
  createUserSuccess,
  deleteUser,
  deleteUserFailure,
  deleteUserSuccess,
  lockUser,
  lockUserFailure,
  lockUserSuccess,
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
  on(loginFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
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
