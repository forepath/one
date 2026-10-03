import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import { isBillingApiRequest } from './billing-api-request.utils';

export const BILLING_TENANT_HEADER = 'X-Tenant';
export const DEFAULT_BILLING_TENANT_ID = 'default';

/** Billing console (`billing`) or landing (`landing`) env bags that carry tenant + REST base. */
type BillingTenantEnvironment = {
  billing?: { tenantId?: string; urls?: { restApi?: string } };
  landing?: { tenantId?: string; urls?: { restApi?: string } };
};

function resolveBillingRestApiUrl(environment: BillingTenantEnvironment): string {
  return environment.billing?.urls?.restApi?.trim() || environment.landing?.urls?.restApi?.trim() || '';
}

export function resolveBillingTenantId(environment: BillingTenantEnvironment): string {
  const configured = environment.billing?.tenantId?.trim() || environment.landing?.tenantId?.trim();

  return configured && configured.length > 0 ? configured : DEFAULT_BILLING_TENANT_ID;
}

export function resolveBillingTenantDisplayName(environment: BillingTenantEnvironment): string {
  const tenantId = resolveBillingTenantId(environment);

  return tenantId.charAt(0).toUpperCase() + tenantId.slice(1);
}

/**
 * HTTP interceptor that attaches `X-Tenant` to billing API requests.
 * Resolves REST base + tenant from `billing` (billing console) or `landing` (marketing landings).
 */
export const billingTenantInterceptor: HttpInterceptorFn = (req, next) => {
  const environment = inject<BillingTenantEnvironment>(ENVIRONMENT);
  const apiUrl = resolveBillingRestApiUrl(environment);

  if (!isBillingApiRequest(req.url, apiUrl)) {
    return next(req);
  }

  const tenantId = resolveBillingTenantId(environment);

  return next(req.clone({ setHeaders: { [BILLING_TENANT_HEADER]: tenantId } }));
};

export function getBillingTenantInterceptor(): HttpInterceptorFn {
  return billingTenantInterceptor;
}
