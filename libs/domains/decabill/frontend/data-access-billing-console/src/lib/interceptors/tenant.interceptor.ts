import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { isBillingApiRequest } from './billing-api-request.utils';

export const BILLING_TENANT_HEADER = 'X-Tenant';
export const DEFAULT_BILLING_TENANT_ID = 'default';

export function resolveBillingTenantId(environment: Environment): string {
  const configured = environment.billing.tenantId?.trim();

  return configured && configured.length > 0 ? configured : DEFAULT_BILLING_TENANT_ID;
}

export function resolveBillingTenantDisplayName(environment: Environment): string {
  const tenantId = resolveBillingTenantId(environment);

  return tenantId.charAt(0).toUpperCase() + tenantId.slice(1);
}

/**
 * HTTP interceptor that attaches `X-Tenant` to billing API requests.
 * Uses `environment.billing.tenantId` when set; otherwise sends `default`.
 */
export const billingTenantInterceptor: HttpInterceptorFn = (req, next) => {
  const environment = inject<Environment>(ENVIRONMENT);
  const apiUrl = environment.billing.restApiUrl;

  if (!isBillingApiRequest(req.url, apiUrl)) {
    return next(req);
  }

  const tenantId = resolveBillingTenantId(environment);

  return next(req.clone({ setHeaders: { [BILLING_TENANT_HEADER]: tenantId } }));
};

export function getBillingTenantInterceptor(): HttpInterceptorFn {
  return billingTenantInterceptor;
}
