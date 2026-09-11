import { createAction, props } from '@ngrx/store';

import type {
  CreateUserDto,
  Login2faMethod,
  TotpSetup,
  TwoFactorStatus,
  UpdateUserDto,
  UserResponseDto,
} from './authentication.types';

/**
 * Unified login action - works for API key, Keycloak, and users authentication
 * For API key: pass the apiKey in the payload
 * For Keycloak: apiKey/email/password ignored, KeycloakService handles it
 * For users: pass email and password (optional code for login 2FA)
 */
export const login = createAction(
  '[Authentication] Login',
  props<{ apiKey?: string; email?: string; password?: string; code?: string }>(),
);

export const loginSuccess = createAction(
  '[Authentication] Login Success',
  props<{ authenticationType: 'api-key' | 'keycloak' | 'users'; user?: { id: string; email: string; role: string } }>(),
);

export const loginFailure = createAction(
  '[Authentication] Login Failure',
  props<{
    error: string;
    confirmEmail?: string;
    login2fa?: { email: string; password: string; method: Login2faMethod };
  }>(),
);

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
  props<{ user: { id: string; email: string; role: string }; message: string; emailConfirmed: boolean }>(),
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

// --- Login 2FA self-service ---

export const loadTwoFactorStatus = createAction('[Authentication] Load Two Factor Status');

export const loadTwoFactorStatusSuccess = createAction(
  '[Authentication] Load Two Factor Status Success',
  props<{ status: TwoFactorStatus }>(),
);

export const loadTwoFactorStatusFailure = createAction(
  '[Authentication] Load Two Factor Status Failure',
  props<{ error: string }>(),
);

export const enableEmail2fa = createAction('[Authentication] Enable Email 2FA', props<{ code?: string }>());

export const enableEmail2faSuccess = createAction(
  '[Authentication] Enable Email 2FA Success',
  props<{ message: string; pending?: boolean }>(),
);

export const enableEmail2faFailure = createAction(
  '[Authentication] Enable Email 2FA Failure',
  props<{ error: string }>(),
);

export const disableEmail2fa = createAction('[Authentication] Disable Email 2FA', props<{ currentPassword: string }>());

export const disableEmail2faSuccess = createAction(
  '[Authentication] Disable Email 2FA Success',
  props<{ message: string }>(),
);

export const disableEmail2faFailure = createAction(
  '[Authentication] Disable Email 2FA Failure',
  props<{ error: string }>(),
);

export const setupTotp = createAction('[Authentication] Setup TOTP', props<{ currentPassword: string }>());

export const setupTotpSuccess = createAction('[Authentication] Setup TOTP Success', props<{ setup: TotpSetup }>());

export const setupTotpFailure = createAction('[Authentication] Setup TOTP Failure', props<{ error: string }>());

export const confirmTotp = createAction('[Authentication] Confirm TOTP', props<{ code: string }>());

export const confirmTotpSuccess = createAction('[Authentication] Confirm TOTP Success', props<{ message: string }>());

export const confirmTotpFailure = createAction('[Authentication] Confirm TOTP Failure', props<{ error: string }>());

export const disableTotp = createAction('[Authentication] Disable TOTP', props<{ code: string }>());

export const disableTotpSuccess = createAction('[Authentication] Disable TOTP Success', props<{ message: string }>());

export const disableTotpFailure = createAction('[Authentication] Disable TOTP Failure', props<{ error: string }>());

export const clearTwoFactorMessages = createAction('[Authentication] Clear Two Factor Messages');

export const adminClearTotp = createAction('[Authentication] Admin Clear TOTP', props<{ userId: string }>());

export const adminClearTotpSuccess = createAction(
  '[Authentication] Admin Clear TOTP Success',
  props<{ message: string; userId: string }>(),
);

export const adminClearTotpFailure = createAction(
  '[Authentication] Admin Clear TOTP Failure',
  props<{ error: string }>(),
);

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
