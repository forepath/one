import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { isObservable, of, type Observable } from 'rxjs';

import { adminOnlyGuard } from './admin-only.guard';

describe('adminOnlyGuard', () => {
  const redirect = {} as UrlTree;
  let mockRouter: jest.Mocked<Router>;
  const run = (canAccessAdminOnly: boolean, canAccessUserManager = true): Promise<boolean | UrlTree> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthenticationFacade,
          useValue: {
            checkAuthentication: jest.fn(),
            canAccessUserManager$: of(canAccessUserManager),
            canAccessAdminOnlyAdministration$: of(canAccessAdminOnly),
          },
        },
        { provide: Router, useValue: mockRouter },
      ],
    });

    const injector = TestBed.inject(Injector);

    return new Promise((resolve) => {
      runInInjectionContext(injector, () => {
        const result = adminOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot);

        if (isObservable(result)) {
          (result as Observable<boolean | UrlTree>).subscribe(resolve);
        } else {
          resolve(result as boolean | UrlTree);
        }
      });
    });
  };

  beforeEach(() => {
    mockRouter = { createUrlTree: jest.fn().mockReturnValue(redirect) } as unknown as jest.Mocked<Router>;
  });

  it('allows admins', async () => {
    await expect(run(true)).resolves.toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects managers (administration access without admin-only features)', async () => {
    await expect(run(false, true)).resolves.toBe(redirect);
    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
  });

  it('redirects regular users', async () => {
    await expect(run(false, false)).resolves.toBe(redirect);
  });
});
