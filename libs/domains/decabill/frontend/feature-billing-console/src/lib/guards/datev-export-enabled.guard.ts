import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { BillingCapabilitiesFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { combineLatest, filter, map, take } from 'rxjs';

export const datevExportEnabledGuard: CanActivateFn = () => {
  const facade = inject(BillingCapabilitiesFacade);
  const router = inject(Router);

  facade.loadCapabilities();

  return combineLatest([facade.capabilities$, facade.loading$]).pipe(
    filter(([, loading]) => !loading),
    take(1),
    map(([capabilities]) =>
      capabilities?.datevExportEnabled ? true : router.createUrlTree(['/administration/billing']),
    ),
  );
};
