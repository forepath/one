import { UserRole } from './entities/user.entity';

/**
 * Roles with access to the administration UI / API: admins and managers.
 * Managers may do everything admins can, except the routes reserved to {@link UserRole.ADMIN}
 * (tenant / system settings, identity apps) and managing the accounts of managers and admins.
 */
export const ADMINISTRATIVE_USER_ROLES: readonly UserRole[] = [UserRole.ADMIN, UserRole.MANAGER];

/** Stable message when a manager targets an account they may not manage. */
export const USER_ACCOUNT_MANAGEMENT_FORBIDDEN_MESSAGE = 'Managers can only manage accounts of regular users';

/** Stable message when a manager tries to grant a role other than `user`. */
export const USER_ROLE_ASSIGNMENT_FORBIDDEN_MESSAGE = 'Managers can only assign the user role';

/** Whether the role has administrative (admin or manager) access. */
export function isAdministrativeRole(role: string | null | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

/**
 * Highest console role among JWT / request role claims (admin > manager > user).
 * Unknown values (e.g. `controller`) map to {@link UserRole.USER} so they never gain administrative access.
 */
export function resolveUserRoleFromRoles(roles: readonly unknown[] | null | undefined): UserRole {
  if (!Array.isArray(roles)) {
    return UserRole.USER;
  }

  if (roles.includes(UserRole.ADMIN)) {
    return UserRole.ADMIN;
  }

  if (roles.includes(UserRole.MANAGER)) {
    return UserRole.MANAGER;
  }

  return UserRole.USER;
}

/** Normalize a stored user role to a console role (admin, manager or user; anything else is user). */
export function normalizeConsoleUserRole(role: string | null | undefined): UserRole {
  return resolveUserRoleFromRoles(role ? [role] : []);
}

/**
 * Whether an actor may manage (edit, lock, delete, reset 2FA, …) an account with `targetRole`.
 * Admins may manage every account; managers only the accounts of regular users.
 */
export function canManageUserAccount(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
): boolean {
  if (actorRole === UserRole.ADMIN) {
    return true;
  }

  if (actorRole === UserRole.MANAGER) {
    return targetRole === UserRole.USER;
  }

  return false;
}
