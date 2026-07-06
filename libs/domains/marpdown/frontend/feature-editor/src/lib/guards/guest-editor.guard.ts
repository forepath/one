import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { hasMarpdownAuthenticatedSession } from './marpdown-auth.utils';

export const guestEditorGuard: CanActivateFn = () => {
  if (hasMarpdownAuthenticatedSession()) {
    return inject(Router).createUrlTree(['/presentations']);
  }

  return true;
};
