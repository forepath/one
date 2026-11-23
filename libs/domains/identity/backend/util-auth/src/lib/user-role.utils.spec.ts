import { UserRole } from './entities/user.entity';
import {
  ADMINISTRATIVE_USER_ROLES,
  canManageUserAccount,
  isAdministrativeRole,
  normalizeConsoleUserRole,
  resolveUserRoleFromRoles,
} from './user-role.utils';

describe('user-role.utils', () => {
  describe('isAdministrativeRole', () => {
    it('is true for admins and managers only', () => {
      expect(isAdministrativeRole(UserRole.ADMIN)).toBe(true);
      expect(isAdministrativeRole(UserRole.MANAGER)).toBe(true);
      expect(isAdministrativeRole(UserRole.USER)).toBe(false);
      expect(isAdministrativeRole(UserRole.CONTROLLER)).toBe(false);
      expect(isAdministrativeRole(undefined)).toBe(false);
      expect(isAdministrativeRole(null)).toBe(false);
      expect(isAdministrativeRole('Admin')).toBe(false);
    });

    it('matches ADMINISTRATIVE_USER_ROLES', () => {
      expect([...ADMINISTRATIVE_USER_ROLES].sort()).toEqual([UserRole.ADMIN, UserRole.MANAGER].sort());
    });
  });

  describe('resolveUserRoleFromRoles', () => {
    it('picks the highest console role', () => {
      expect(resolveUserRoleFromRoles(['user', 'manager', 'admin'])).toBe(UserRole.ADMIN);
      expect(resolveUserRoleFromRoles(['manager', 'user'])).toBe(UserRole.MANAGER);
      expect(resolveUserRoleFromRoles(['user'])).toBe(UserRole.USER);
    });

    it('fails closed to user for unknown, empty or missing roles', () => {
      expect(resolveUserRoleFromRoles(['controller'])).toBe(UserRole.USER);
      expect(resolveUserRoleFromRoles(['MANAGER', 'Admin'])).toBe(UserRole.USER);
      expect(resolveUserRoleFromRoles([])).toBe(UserRole.USER);
      expect(resolveUserRoleFromRoles(undefined)).toBe(UserRole.USER);
      expect(resolveUserRoleFromRoles(null)).toBe(UserRole.USER);
      expect(resolveUserRoleFromRoles('admin' as unknown as string[])).toBe(UserRole.USER);
    });
  });

  describe('normalizeConsoleUserRole', () => {
    it('keeps console roles and maps anything else to user', () => {
      expect(normalizeConsoleUserRole('admin')).toBe(UserRole.ADMIN);
      expect(normalizeConsoleUserRole('manager')).toBe(UserRole.MANAGER);
      expect(normalizeConsoleUserRole('user')).toBe(UserRole.USER);
      expect(normalizeConsoleUserRole('controller')).toBe(UserRole.USER);
      expect(normalizeConsoleUserRole(undefined)).toBe(UserRole.USER);
    });
  });

  describe('canManageUserAccount', () => {
    it('lets admins manage every account', () => {
      for (const target of [UserRole.USER, UserRole.MANAGER, UserRole.ADMIN, UserRole.CONTROLLER]) {
        expect(canManageUserAccount(UserRole.ADMIN, target)).toBe(true);
      }
    });

    it('lets managers manage regular users only', () => {
      expect(canManageUserAccount(UserRole.MANAGER, UserRole.USER)).toBe(true);
      expect(canManageUserAccount(UserRole.MANAGER, UserRole.MANAGER)).toBe(false);
      expect(canManageUserAccount(UserRole.MANAGER, UserRole.ADMIN)).toBe(false);
      expect(canManageUserAccount(UserRole.MANAGER, UserRole.CONTROLLER)).toBe(false);
      expect(canManageUserAccount(UserRole.MANAGER, undefined)).toBe(false);
    });

    it('denies regular users and unknown actors', () => {
      expect(canManageUserAccount(UserRole.USER, UserRole.USER)).toBe(false);
      expect(canManageUserAccount(undefined, UserRole.USER)).toBe(false);
      expect(canManageUserAccount('controller', UserRole.USER)).toBe(false);
    });
  });
});
