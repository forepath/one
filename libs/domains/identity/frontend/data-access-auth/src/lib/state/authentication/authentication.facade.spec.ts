import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  checkAuthentication,
  loadUsers,
  lockUser,
  login,
  logout,
  register,
  unlockUser,
} from './authentication.actions';
import { AuthenticationFacade } from './authentication.facade';

describe('AuthenticationFacade', () => {
  let facade: AuthenticationFacade;
  let store: jest.Mocked<Store>;
  const createFacadeWithMock = (mockSelectReturn: unknown): AuthenticationFacade => {
    const mockStore = {
      select: jest.fn().mockReturnValue(of(mockSelectReturn)),
      dispatch: jest.fn(),
    } as unknown as jest.Mocked<Store>;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AuthenticationFacade,
        {
          provide: Store,
          useValue: mockStore,
        },
      ],
    });

    return TestBed.inject(AuthenticationFacade);
  };

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as unknown as jest.Mocked<Store>;

    TestBed.configureTestingModule({
      providers: [
        AuthenticationFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(AuthenticationFacade);
  });

  describe('State Observables', () => {
    it('should expose isAuthenticated$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.isAuthenticated$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose isNotAuthenticated$ observable', (done) => {
      // isNotAuthenticated$ is a derived selector, so we need to mock it directly
      const mockStore = {
        select: jest.fn((_) => {
          // Mock selectIsNotAuthenticated to return false (since it's !isAuthenticated)
          return of(false);
        }),
        dispatch: jest.fn(),
      } as unknown as jest.Mocked<Store>;

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AuthenticationFacade,
          {
            provide: Store,
            useValue: mockStore,
          },
        ],
      });

      const testFacade = TestBed.inject(AuthenticationFacade);

      testFacade.isNotAuthenticated$.subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should expose authenticationType$ observable', (done) => {
      const testFacade = createFacadeWithMock('api-key');

      testFacade.authenticationType$.subscribe((result) => {
        expect(result).toBe('api-key');
        done();
      });
    });

    it('should expose loading$ observable', (done) => {
      const testFacade = createFacadeWithMock(false);

      testFacade.loading$.subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should expose error$ observable', (done) => {
      const testFacade = createFacadeWithMock('Error message');

      testFacade.error$.subscribe((result) => {
        expect(result).toBe('Error message');
        done();
      });
    });
  });

  describe('login', () => {
    it('should dispatch login action without apiKey', () => {
      facade.login();

      expect(store.dispatch).toHaveBeenCalledWith(login({}));
    });

    it('should dispatch login action with apiKey', () => {
      facade.login('test-api-key');

      expect(store.dispatch).toHaveBeenCalledWith(login({ apiKey: 'test-api-key' }));
    });

    it('should dispatch login action with email and password for users auth', () => {
      facade.login(undefined, 'user@example.com', 'password123');

      expect(store.dispatch).toHaveBeenCalledWith(login({ email: 'user@example.com', password: 'password123' }));
    });
  });

  describe('logout', () => {
    it('should dispatch logout action', () => {
      facade.logout();

      expect(store.dispatch).toHaveBeenCalledWith(logout({ invalidateAllSessions: false }));
    });
  });

  describe('checkAuthentication', () => {
    it('should dispatch checkAuthentication action', () => {
      facade.checkAuthentication();

      expect(store.dispatch).toHaveBeenCalledWith(checkAuthentication());
    });
  });

  describe('users auth', () => {
    it('should dispatch register action', () => {
      facade.register('user@example.com', 'password123');

      expect(store.dispatch).toHaveBeenCalledWith(register({ email: 'user@example.com', password: 'password123' }));
    });

    it('should dispatch loadUsers action', () => {
      facade.loadUsers();

      expect(store.dispatch).toHaveBeenCalledWith(loadUsers({ limit: undefined, offset: undefined }));
    });

    it('should dispatch lockUser action', () => {
      facade.lockUser('user-1');

      expect(store.dispatch).toHaveBeenCalledWith(lockUser({ id: 'user-1' }));
    });

    it('should dispatch unlockUser action', () => {
      facade.unlockUser('user-1');

      expect(store.dispatch).toHaveBeenCalledWith(unlockUser({ id: 'user-1' }));
    });
  });
});
