import {
  checkAuthentication,
  checkAuthenticationFailure,
  checkAuthenticationSuccess,
  clearError,
  clearSuccessMessage,
  loadUsers,
  loadUsersBatch,
  loadUsersFailure,
  loadUsersSuccess,
  lockUser,
  lockUserFailure,
  lockUserSuccess,
  login,
  loginFailure,
  loginSuccess,
  logout,
  logoutFailure,
  logoutSuccess,
  unlockUser,
  unlockUserFailure,
  unlockUserSuccess,
} from './authentication.actions';
import { authenticationReducer, initialAuthenticationState } from './authentication.reducer';
import type { AuthenticationState } from './authentication.types';

describe('authenticationReducer', () => {
  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = authenticationReducer(undefined, action as never);

      expect(state).toEqual(initialAuthenticationState);
    });
  });

  describe('login', () => {
    it('should set loading to true and clear error', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        error: 'Previous error',
      };
      const newState = authenticationReducer(state, login({}));

      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });

    it('should set loading to true when apiKey is provided', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
      };
      const newState = authenticationReducer(state, login({ apiKey: 'test-key' }));

      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loginSuccess', () => {
    it('should set isAuthenticated to true and authenticationType', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(state, loginSuccess({ authenticationType: 'api-key' }));

      expect(newState.isAuthenticated).toBe(true);
      expect(newState.authenticationType).toBe('api-key');
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });

    it('should set authenticationType to keycloak', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(state, loginSuccess({ authenticationType: 'keycloak' }));

      expect(newState.isAuthenticated).toBe(true);
      expect(newState.authenticationType).toBe('keycloak');
      expect(newState.loading).toBe(false);
    });

    it('should set user when provided for users authentication', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(
        state,
        loginSuccess({
          authenticationType: 'users',
          user: { id: 'user-1', email: 'test@example.com', role: 'user' },
        }),
      );

      expect(newState.user).toEqual({ id: 'user-1', email: 'test@example.com', role: 'user' });
    });
  });

  describe('loginFailure', () => {
    it('should set error and set loading to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(state, loginFailure({ error: 'Login failed' }));

      expect(newState.error).toBe('Login failed');
      expect(newState.loading).toBe(false);
      expect(newState.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('should set loading to true and clear error', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        isAuthenticated: true,
        authenticationType: 'api-key',
        error: 'Previous error',
      };
      const newState = authenticationReducer(state, logout({}));

      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('logoutSuccess', () => {
    it('should reset authentication state', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        isAuthenticated: true,
        authenticationType: 'api-key',
        loading: true,
      };
      const newState = authenticationReducer(state, logoutSuccess());

      expect(newState.isAuthenticated).toBe(false);
      expect(newState.authenticationType).toBeNull();
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('logoutFailure', () => {
    it('should set error and set loading to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        isAuthenticated: true,
        authenticationType: 'keycloak',
        loading: true,
      };
      const newState = authenticationReducer(state, logoutFailure({ error: 'Logout failed' }));

      expect(newState.error).toBe('Logout failed');
      expect(newState.loading).toBe(false);
      // State should remain authenticated on logout failure
      expect(newState.isAuthenticated).toBe(true);
    });
  });

  describe('checkAuthentication', () => {
    it('should set loading to true and clear error', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        error: 'Previous error',
      };
      const newState = authenticationReducer(state, checkAuthentication());

      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('checkAuthenticationSuccess', () => {
    it('should set isAuthenticated to true and authenticationType when authenticated', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(
        state,
        checkAuthenticationSuccess({ isAuthenticated: true, authenticationType: 'api-key' }),
      );

      expect(newState.isAuthenticated).toBe(true);
      expect(newState.authenticationType).toBe('api-key');
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });

    it('should set isAuthenticated to false when not authenticated', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        isAuthenticated: true,
        authenticationType: 'api-key',
        loading: true,
      };
      const newState = authenticationReducer(state, checkAuthenticationSuccess({ isAuthenticated: false }));

      expect(newState.isAuthenticated).toBe(false);
      expect(newState.authenticationType).toBe('api-key'); // Preserved from previous state
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });

    it('should preserve existing authenticationType when not provided', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        authenticationType: 'keycloak',
        loading: true,
      };
      const newState = authenticationReducer(state, checkAuthenticationSuccess({ isAuthenticated: true }));

      expect(newState.isAuthenticated).toBe(true);
      expect(newState.authenticationType).toBe('keycloak'); // Preserved from previous state
      expect(newState.loading).toBe(false);
    });

    it('should set authenticationType to keycloak when authenticated with keycloak', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(
        state,
        checkAuthenticationSuccess({ isAuthenticated: true, authenticationType: 'keycloak' }),
      );

      expect(newState.isAuthenticated).toBe(true);
      expect(newState.authenticationType).toBe('keycloak');
      expect(newState.loading).toBe(false);
    });

    it('should set user when provided for users authentication', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(
        state,
        checkAuthenticationSuccess({
          isAuthenticated: true,
          authenticationType: 'users',
          user: { id: 'user-1', email: 'test@example.com', role: 'admin' },
        }),
      );

      expect(newState.user).toEqual({ id: 'user-1', email: 'test@example.com', role: 'admin' });
    });
  });

  describe('checkAuthenticationFailure', () => {
    it('should set error and set loading to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        loading: true,
      };
      const newState = authenticationReducer(state, checkAuthenticationFailure({ error: 'Check failed' }));

      expect(newState.error).toBe('Check failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should clear error', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        error: 'Previous error',
      };
      const newState = authenticationReducer(state, clearError());

      expect(newState.error).toBeNull();
    });
  });

  describe('clearSuccessMessage', () => {
    it('should clear successMessage', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        successMessage: 'Registration successful',
      };
      const newState = authenticationReducer(state, clearSuccessMessage());

      expect(newState.successMessage).toBeNull();
    });
  });

  describe('loadUsers', () => {
    it('should clear users, set usersLoading to true and clear usersError', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        users: [{ id: 'u1', email: 'a@b.com', role: 'user', createdAt: '', updatedAt: '' }],
        usersError: 'Previous error',
      };
      const newState = authenticationReducer(state, loadUsers({}));

      expect(newState.users).toEqual([]);
      expect(newState.usersLoading).toBe(true);
      expect(newState.usersError).toBeNull();
    });
  });

  describe('loadUsersBatch', () => {
    it('should set users to accumulatedUsers and keep usersLoading true', () => {
      const accumulatedUsers = [{ id: 'u1', email: 'a@b.com', role: 'user' as const, createdAt: '', updatedAt: '' }];
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        users: [],
        usersLoading: true,
      };
      const newState = authenticationReducer(state, loadUsersBatch({ offset: 10, accumulatedUsers }));

      expect(newState.users).toEqual(accumulatedUsers);
      expect(newState.usersLoading).toBe(true);
      expect(newState.usersError).toBeNull();
    });
  });

  describe('loadUsersSuccess', () => {
    it('should set users and set usersLoading to false', () => {
      const users = [{ id: 'u1', email: 'a@b.com', role: 'user' as const, createdAt: '', updatedAt: '' }];
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        users: [],
        usersLoading: true,
      };
      const newState = authenticationReducer(state, loadUsersSuccess({ users }));

      expect(newState.users).toEqual(users);
      expect(newState.usersLoading).toBe(false);
      expect(newState.usersError).toBeNull();
    });
  });

  describe('loadUsersFailure', () => {
    it('should set usersError and set usersLoading to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        usersLoading: true,
      };
      const newState = authenticationReducer(state, loadUsersFailure({ error: 'Load failed' }));

      expect(newState.usersError).toBe('Load failed');
      expect(newState.usersLoading).toBe(false);
    });
  });

  describe('lockUser', () => {
    it('should set lockingUser to true and clear usersError', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        usersError: 'Previous error',
      };
      const newState = authenticationReducer(state, lockUser({ id: 'u1' }));

      expect(newState.lockingUser).toBe(true);
      expect(newState.usersError).toBeNull();
    });
  });

  describe('lockUserSuccess', () => {
    it('should update the user and set lockingUser to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        lockingUser: true,
        users: [{ id: 'u1', email: 'a@b.com', role: 'user', lockedAt: null, createdAt: '', updatedAt: '' }],
      };
      const updatedUser = {
        id: 'u1',
        email: 'a@b.com',
        role: 'user' as const,
        lockedAt: '2026-01-01T00:00:00Z',
        createdAt: '',
        updatedAt: '',
      };
      const newState = authenticationReducer(state, lockUserSuccess({ user: updatedUser }));

      expect(newState.users).toEqual([updatedUser]);
      expect(newState.lockingUser).toBe(false);
      expect(newState.usersError).toBeNull();
    });
  });

  describe('lockUserFailure', () => {
    it('should set usersError and set lockingUser to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        lockingUser: true,
      };
      const newState = authenticationReducer(state, lockUserFailure({ error: 'Lock failed' }));

      expect(newState.lockingUser).toBe(false);
      expect(newState.usersError).toBe('Lock failed');
    });
  });

  describe('unlockUser', () => {
    it('should set unlockingUser to true and clear usersError', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        usersError: 'Previous error',
      };
      const newState = authenticationReducer(state, unlockUser({ id: 'u1' }));

      expect(newState.unlockingUser).toBe(true);
      expect(newState.usersError).toBeNull();
    });
  });

  describe('unlockUserSuccess', () => {
    it('should update the user and set unlockingUser to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        unlockingUser: true,
        users: [
          {
            id: 'u1',
            email: 'a@b.com',
            role: 'user',
            lockedAt: '2026-01-01T00:00:00Z',
            createdAt: '',
            updatedAt: '',
          },
        ],
      };
      const updatedUser = {
        id: 'u1',
        email: 'a@b.com',
        role: 'user' as const,
        lockedAt: null,
        createdAt: '',
        updatedAt: '',
      };
      const newState = authenticationReducer(state, unlockUserSuccess({ user: updatedUser }));

      expect(newState.users).toEqual([updatedUser]);
      expect(newState.unlockingUser).toBe(false);
      expect(newState.usersError).toBeNull();
    });
  });

  describe('unlockUserFailure', () => {
    it('should set usersError and set unlockingUser to false', () => {
      const state: AuthenticationState = {
        ...initialAuthenticationState,
        unlockingUser: true,
      };
      const newState = authenticationReducer(state, unlockUserFailure({ error: 'Unlock failed' }));

      expect(newState.unlockingUser).toBe(false);
      expect(newState.usersError).toBe('Unlock failed');
    });
  });
});
