import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { BillingCapabilitiesFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { combineLatest, filter, map, take } from 'rxjs';

/** Accounting pages need the `accountingEnabled` capability (BILLING_ACCOUNTING_ENABLED + country profile). */
export const accountingEnabledGuard: CanActivateFn = () => {
  const facade = inject(BillingCapabilitiesFacade);
  const router = inject(Router);

  facade.loadCapabilities();

  return combineLatest([facade.accountingEnabled$, facade.loading$]).pipe(
    filter(([, loading]) => !loading),
    take(1),
    map(([enabled]) => (enabled ? true : router.createUrlTree(['/administration/billing']))),
  );
};

/**
 * Entity-wide accounting pages (VAT returns, fixed assets) need `accountingGlobalAccess`
 * (tenant on TENANTS_ALLOW_GLOBAL_VIEWS); tenant-scoped admins go to the accounting overview.
 */
export const accountingGlobalAccessGuard: CanActivateFn = () => {
  const facade = inject(BillingCapabilitiesFacade);
  const router = inject(Router);

  facade.loadCapabilities();

  return combineLatest([facade.accountingGlobalAccess$, facade.loading$]).pipe(
    filter(([, loading]) => !loading),
    take(1),
    map(([global]) => (global ? true : router.createUrlTree(['/administration/accounting']))),
  );
};
