/**
 * Authentication state types for the identity domain.
 */

export type AuthenticationType = 'api-key' | 'keycloak' | 'users';

export type UserRole = 'user' | 'admin';

export interface UserInfo {
  id: string;
  email: string;
  role: UserRole;
}

export interface LoginResponse {
  access_token: string;
  user: UserInfo;
}

export interface RegisterResponse {
  user: UserInfo;
  message: string;
  /** True when the account is already confirmed (e.g. first user bootstrap). */
  emailConfirmed: boolean;
}

export interface UserResponseDto {
  id: string;
  email: string;
  role: UserRole;
  emailConfirmedAt?: string | null;
  lockedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserDto {
  email: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserDto {
  email?: string;
  password?: string;
  role?: UserRole;
}

export interface ListUsersParams {
  limit?: number;
  offset?: number;
}

export interface AuthenticationState {
  isAuthenticated: boolean;
  authenticationType: AuthenticationType | null;
  user: UserInfo | null;
  loading: boolean;
  error: string | null;
  successMessage: string | null;
  // Users auth sub-states
  registering: boolean;
  confirmingEmail: boolean;
  requestingPasswordReset: boolean;
  resettingPassword: boolean;
  changingPassword: boolean;
  // Admin users management
  users: UserResponseDto[];
  usersLoading: boolean;
  usersError: string | null;
  creatingUser: boolean;
  updatingUser: boolean;
  deletingUser: boolean;
  lockingUser: boolean;
  unlockingUser: boolean;
}
