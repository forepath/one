import {
  selectAuthenticationError,
  selectAuthenticationLoading,
  selectAuthenticationType,
  selectCanAccessAdminOnlyAdministration,
  selectCanAccessUserManager,
  selectHasAdministrativeRole,
  selectChangingPassword,
  selectConfirmingEmail,
  selectCreatingUser,
  selectDeletingUser,
  selectIsAdmin,
  selectIsManager,
  selectIsAuthenticated,
  selectIsNotAuthenticated,
  selectLockingUser,
  selectRegistering,
  selectRequestingPasswordReset,
  selectResettingPassword,
  selectSuccessMessage,
  selectUnlockingUser,
  selectUpdatingUser,
  selectUser,
  selectUsers,
  selectUsersError,
  selectUsersLoading,
} from './authentication.selectors';
import type { AuthenticationState } from './authentication.types';

describe('authentication selectors', () => {
  const baseState: AuthenticationState = {
    isAuthenticated: true,
    authenticationType: 'users',
    user: { id: '1', email: 'admin@example.com', role: 'admin' },
    loading: false,
    error: null,
    successMessage: 'ok',
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
    confirmingUserEmail: false,
  };
  const project = (selector: (state: { authentication: AuthenticationState }) => unknown) =>
    selector({ authentication: baseState });

  it('selects basic authentication state fields', () => {
    expect(project(selectIsAuthenticated)).toBe(true);
    expect(project(selectAuthenticationType)).toBe('users');
    expect(project(selectUser)).toEqual(baseState.user);
    expect(project(selectAuthenticationLoading)).toBe(false);
    expect(project(selectAuthenticationError)).toBeNull();
    expect(project(selectSuccessMessage)).toBe('ok');
    expect(project(selectIsNotAuthenticated)).toBe(false);
  });

  it('selects users auth sub-state fields', () => {
    expect(project(selectRegistering)).toBe(false);
    expect(project(selectConfirmingEmail)).toBe(false);
    expect(project(selectRequestingPasswordReset)).toBe(false);
    expect(project(selectResettingPassword)).toBe(false);
    expect(project(selectChangingPassword)).toBe(false);
  });

  it('selects admin user management fields', () => {
    expect(project(selectUsers)).toEqual([]);
    expect(project(selectUsersLoading)).toBe(false);
    expect(project(selectUsersError)).toBeNull();
    expect(project(selectCreatingUser)).toBe(false);
    expect(project(selectUpdatingUser)).toBe(false);
    expect(project(selectDeletingUser)).toBe(false);
    expect(project(selectLockingUser)).toBe(false);
    expect(project(selectUnlockingUser)).toBe(false);
  });

  it('selectIsAdmin is true for admin users', () => {
    expect(project(selectIsAdmin)).toBe(true);
    expect(selectIsAdmin.projector({ id: '2', email: 'user@example.com', role: 'user' })).toBe(false);
  });

  const withUser = (
    role: 'user' | 'manager' | 'admin',
    authenticationType: AuthenticationState['authenticationType'] = 'users',
  ) =>
    ({
      authentication: { ...baseState, authenticationType, user: { id: '9', email: `${role}@example.com`, role } },
    }) as { authentication: AuthenticationState };

  it('selectIsManager / selectHasAdministrativeRole distinguish managers from admins and users', () => {
    expect(selectIsManager(withUser('manager'))).toBe(true);
    expect(selectIsManager(withUser('admin'))).toBe(false);
    expect(selectIsAdmin(withUser('manager'))).toBe(false);
    expect(selectHasAdministrativeRole(withUser('manager'))).toBe(true);
    expect(selectHasAdministrativeRole(withUser('admin'))).toBe(true);
    expect(selectHasAdministrativeRole(withUser('user'))).toBe(false);
  });

  it('selectCanAccessUserManager requires an authenticated admin or manager (users, oidc or saml)', () => {
    expect(project(selectCanAccessUserManager)).toBe(true);
    expect(selectCanAccessUserManager(withUser('manager'))).toBe(true);
    expect(selectCanAccessUserManager(withUser('manager', 'oidc'))).toBe(true);
    expect(selectCanAccessUserManager(withUser('admin', 'saml'))).toBe(true);
    expect(selectCanAccessUserManager(withUser('user'))).toBe(false);
    expect(selectCanAccessUserManager(withUser('admin', 'api-key'))).toBe(false);
    expect(
      selectCanAccessUserManager({ authentication: { ...withUser('admin').authentication, isAuthenticated: false } }),
    ).toBe(false);
  });

  it('selectCanAccessAdminOnlyAdministration is limited to admins (never managers)', () => {
    expect(selectCanAccessAdminOnlyAdministration(withUser('admin'))).toBe(true);
    expect(selectCanAccessAdminOnlyAdministration(withUser('admin', 'oidc'))).toBe(true);
    expect(selectCanAccessAdminOnlyAdministration(withUser('manager'))).toBe(false);
    expect(selectCanAccessAdminOnlyAdministration(withUser('user'))).toBe(false);
    expect(selectCanAccessAdminOnlyAdministration(withUser('admin', 'mtls'))).toBe(false);
  });
});
