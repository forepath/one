import { createAction, props } from '@ngrx/store';

import type { CreateUserDto, UpdateUserDto, UserResponseDto } from './authentication.types';

/**
 * Unified login action - works for API key, Keycloak, and users authentication
 * For API key: pass the apiKey in the payload
 * For Keycloak: apiKey/email/password ignored, KeycloakService handles it
 * For users: pass email and password
 */
export const login = createAction(
  '[Authentication] Login',
  props<{ apiKey?: string; email?: string; password?: string }>(),
);

export const loginSuccess = createAction(
  '[Authentication] Login Success',
  props<{ authenticationType: 'api-key' | 'keycloak' | 'users'; user?: { id: string; email: string; role: string } }>(),
);

export const loginFailure = createAction('[Authentication] Login Failure', props<{ error: string }>());

export const clearError = createAction('[Authentication] Clear Error');

/**
 * Unified logout action - works for all authentication types
 */
export const logout = createAction('[Authentication] Logout', props<{ invalidateAllSessions?: boolean }>());

export const logoutSuccess = createAction('[Authentication] Logout Success');

export const logoutFailure = createAction('[Authentication] Logout Failure', props<{ error: string }>());

/**
 * Check authentication status
 */
export const checkAuthentication = createAction('[Authentication] Check Authentication');

export const checkAuthenticationSuccess = createAction(
  '[Authentication] Check Authentication Success',
  props<{
    isAuthenticated: boolean;
    authenticationType?: 'api-key' | 'keycloak' | 'users';
    user?: { id: string; email: string; role: string };
  }>(),
);

export const checkAuthenticationFailure = createAction(
  '[Authentication] Check Authentication Failure',
  props<{ error: string }>(),
);

// --- Users auth (non-admin) ---

export const register = createAction('[Authentication] Register', props<{ email: string; password: string }>());

export const registerSuccess = createAction(
  '[Authentication] Register Success',
  props<{ user: { id: string; email: string; role: string }; message: string }>(),
);

export const registerFailure = createAction('[Authentication] Register Failure', props<{ error: string }>());

export const confirmEmail = createAction('[Authentication] Confirm Email', props<{ email: string; code: string }>());

export const confirmEmailSuccess = createAction('[Authentication] Confirm Email Success');

export const confirmEmailFailure = createAction('[Authentication] Confirm Email Failure', props<{ error: string }>());

export const requestPasswordReset = createAction('[Authentication] Request Password Reset', props<{ email: string }>());

export const requestPasswordResetSuccess = createAction(
  '[Authentication] Request Password Reset Success',
  props<{ email: string }>(),
);

export const requestPasswordResetFailure = createAction(
  '[Authentication] Request Password Reset Failure',
  props<{ error: string }>(),
);

export const resetPassword = createAction(
  '[Authentication] Reset Password',
  props<{ email: string; code: string; newPassword: string }>(),
);

export const resetPasswordSuccess = createAction('[Authentication] Reset Password Success');

export const resetPasswordFailure = createAction('[Authentication] Reset Password Failure', props<{ error: string }>());

export const changePassword = createAction(
  '[Authentication] Change Password',
  props<{ currentPassword: string; newPassword: string; newPasswordConfirmation: string }>(),
);

export const changePasswordSuccess = createAction('[Authentication] Change Password Success');

export const changePasswordFailure = createAction(
  '[Authentication] Change Password Failure',
  props<{ error: string }>(),
);

export const clearSuccessMessage = createAction('[Authentication] Clear Success Message');

// --- Admin users management ---

export const loadUsers = createAction('[Admin] Load Users', props<{ limit?: number; offset?: number }>());

export const loadUsersSuccess = createAction('[Admin] Load Users Success', props<{ users: UserResponseDto[] }>());

export const loadUsersFailure = createAction('[Admin] Load Users Failure', props<{ error: string }>());

export const loadUsersBatch = createAction(
  '[Admin] Load Users Batch',
  props<{ offset: number; accumulatedUsers: UserResponseDto[] }>(),
);

export const createUser = createAction('[Admin] Create User', props<{ user: CreateUserDto }>());

export const createUserSuccess = createAction('[Admin] Create User Success', props<{ user: UserResponseDto }>());

export const createUserFailure = createAction('[Admin] Create User Failure', props<{ error: string }>());

export const updateUser = createAction('[Admin] Update User', props<{ id: string; user: UpdateUserDto }>());

export const updateUserSuccess = createAction('[Admin] Update User Success', props<{ user: UserResponseDto }>());

export const updateUserFailure = createAction('[Admin] Update User Failure', props<{ error: string }>());

export const deleteUser = createAction('[Admin] Delete User', props<{ id: string }>());

export const deleteUserSuccess = createAction('[Admin] Delete User Success', props<{ id: string }>());

export const deleteUserFailure = createAction('[Admin] Delete User Failure', props<{ error: string }>());

export const lockUser = createAction('[Admin] Lock User', props<{ id: string }>());

export const lockUserSuccess = createAction('[Admin] Lock User Success', props<{ user: UserResponseDto }>());

export const lockUserFailure = createAction('[Admin] Lock User Failure', props<{ error: string }>());

export const unlockUser = createAction('[Admin] Unlock User', props<{ id: string }>());

export const unlockUserSuccess = createAction('[Admin] Unlock User Success', props<{ user: UserResponseDto }>());

export const unlockUserFailure = createAction('[Admin] Unlock User Failure', props<{ error: string }>());
