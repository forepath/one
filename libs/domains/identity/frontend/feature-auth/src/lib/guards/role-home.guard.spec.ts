import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { firstValueFrom, isObservable, of } from 'rxjs';

import { roleHomeGuard } from './role-home.guard';

describe('roleHomeGuard', () => {
  const targets = { admin: ['/overview'], user: ['/clients'] };
  let router: { createUrlTree: jest.Mock };
  let checkAuthentication: jest.Mock;

  function run(canAccessAdmin: boolean) {
    router = { createUrlTree: jest.fn((commands: string[]) => ({ commands }) as unknown as UrlTree) };
    checkAuthentication = jest.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthenticationFacade,
          useValue: { checkAuthentication, canAccessUserManager$: of(canAccessAdmin) },
        },
        { provide: Router, useValue: router },
      ],
    });

    const result = runInInjectionContext(TestBed.inject(Injector), () =>
      roleHomeGuard(targets)({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    if (!isObservable(result)) throw new Error('expected an observable');

    return firstValueFrom(result);
  }

  it('sends admins and managers to the admin overview', async () => {
    await expect(run(true)).resolves.toEqual({ commands: ['/overview'] });
    expect(checkAuthentication).toHaveBeenCalled();
  });

  it('sends everybody else (incl. signed-out users) to the user overview', async () => {
    await expect(run(false)).resolves.toEqual({ commands: ['/clients'] });
  });
});
