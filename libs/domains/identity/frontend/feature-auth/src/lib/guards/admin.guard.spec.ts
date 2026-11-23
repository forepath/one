import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of } from 'rxjs';

import { adminGuard } from './admin.guard';

describe('adminGuard', () => {
  let mockRouter: jest.Mocked<Router>;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;
  const setupTestBed = (canAccess: boolean): Injector => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthenticationFacade,
          useValue: {
            checkAuthentication: jest.fn(),
            canAccessUserManager$: of(canAccess),
          },
        },
        {
          provide: Router,
          useValue: mockRouter,
        },
      ],
    });

    return TestBed.inject(Injector);
  };

  beforeEach(() => {
    mockRouter = {
      createUrlTree: jest.fn(),
    } as unknown as jest.Mocked<Router>;

    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = {} as RouterStateSnapshot;

    jest.clearAllMocks();
  });

  it('should allow access when canAccessUserManager is true', (done) => {
    const injector = setupTestBed(true);

    runInInjectionContext(injector, () => {
      const result = adminGuard(mockRoute, mockState);

      if (typeof result === 'object' && 'subscribe' in result) {
        result.subscribe((res) => {
          expect(res).toBe(true);
          expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
          done();
        });
      } else {
        expect(result).toBe(true);
        done();
      }
    });
  });

  it('should redirect to the role home (/) when canAccessUserManager is false', (done) => {
    const mockUrlTree = {} as UrlTree;

    mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);
    const injector = setupTestBed(false);

    runInInjectionContext(injector, () => {
      const result = adminGuard(mockRoute, mockState);

      if (typeof result === 'object' && 'subscribe' in result) {
        result.subscribe((res) => {
          expect(res).toBe(mockUrlTree);
          expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
          done();
        });
      } else {
        expect(result).toBe(mockUrlTree);
        done();
      }
    });
  });
});
