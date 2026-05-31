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

  it('selectCanAccessUserManager requires authenticated admin users or keycloak admin', () => {
    expect(project(selectCanAccessUserManager)).toBe(true);
    expect(selectCanAccessUserManager.projector(true, 'keycloak', true)).toBe(true);
    expect(selectCanAccessUserManager.projector(true, 'users', false)).toBe(false);
    expect(selectCanAccessUserManager.projector(false, 'users', true)).toBe(false);
  });
});
