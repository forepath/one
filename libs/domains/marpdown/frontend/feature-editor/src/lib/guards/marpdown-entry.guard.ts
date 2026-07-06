import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { hasMarpdownAuthenticatedSession } from './marpdown-auth.utils';

export const marpdownEntryRedirectGuard: CanActivateFn = () => {
  const router = inject(Router);

  return hasMarpdownAuthenticatedSession()
    ? router.createUrlTree(['/presentations'])
    : router.createUrlTree(['/editor']);
};
