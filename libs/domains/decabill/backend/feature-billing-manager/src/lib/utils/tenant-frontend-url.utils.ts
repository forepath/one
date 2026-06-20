import { DEFAULT_TENANT } from '@forepath/shared/backend';

const DEFAULT_FRONTEND_BASE_URL = 'http://localhost:4500';
const DEFAULT_SUCCESS_RETURN_PATH = '/invoices?payment=success';
const DEFAULT_CANCEL_RETURN_PATH = '/invoices?payment=cancel';

export type StripeCheckoutReturnType = 'success' | 'cancel';

export interface TenantFrontendUrlEnv {
  billingFrontendUrl?: string;
  tenantFrontendUrls?: string;
  stripeCheckoutSuccessUrl?: string;
  stripeCheckoutCancelUrl?: string;
}

export function parseTenantFrontendUrlMap(
  envValue: string | undefined = process.env['TENANT_FRONTEND_URLS'],
): Readonly<Record<string, string>> {
  if (!envValue?.trim()) {
    return {};
  }

  const map: Record<string, string> = {};

  for (const segment of envValue.split(',')) {
    const trimmed = segment.trim();
    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const tenantId = trimmed.slice(0, separatorIndex).trim();
    const url = trimmed.slice(separatorIndex + 1).trim();

    if (tenantId.length > 0 && url.length > 0) {
      map[tenantId] = normalizeBaseUrl(url);
    }
  }

  return map;
}

export function resolveTenantFrontendBaseUrl(
  tenantId: string,
  env: TenantFrontendUrlEnv = readTenantFrontendUrlEnv(),
): string {
  const override = parseTenantFrontendUrlMap(env.tenantFrontendUrls)[tenantId];

  if (override) {
    return override;
  }

  if (env.billingFrontendUrl?.trim()) {
    return normalizeBaseUrl(env.billingFrontendUrl);
  }

  const fromLegacySuccessUrl = extractOrigin(env.stripeCheckoutSuccessUrl);

  if (fromLegacySuccessUrl) {
    return fromLegacySuccessUrl;
  }

  return DEFAULT_FRONTEND_BASE_URL;
}

export function buildStripeCheckoutReturnUrl(
  tenantId: string,
  returnType: StripeCheckoutReturnType,
  params: { subscriptionId: string; invoiceRefId: string },
  env: TenantFrontendUrlEnv = readTenantFrontendUrlEnv(),
): string {
  const baseUrl = resolveTenantFrontendBaseUrl(tenantId, env);
  const returnPath =
    returnType === 'success'
      ? extractReturnPath(env.stripeCheckoutSuccessUrl, DEFAULT_SUCCESS_RETURN_PATH)
      : extractReturnPath(env.stripeCheckoutCancelUrl, DEFAULT_CANCEL_RETURN_PATH);
  const template = joinBaseUrlAndPath(baseUrl, returnPath);

  return appendCheckoutReturnQueryParams(template, params);
}

function readTenantFrontendUrlEnv(): TenantFrontendUrlEnv {
  return {
    billingFrontendUrl: process.env['BILLING_FRONTEND_URL'],
    tenantFrontendUrls: process.env['TENANT_FRONTEND_URLS'],
    stripeCheckoutSuccessUrl: process.env['STRIPE_CHECKOUT_SUCCESS_URL'],
    stripeCheckoutCancelUrl: process.env['STRIPE_CHECKOUT_CANCEL_URL'],
  };
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function extractOrigin(url: string | undefined): string | undefined {
  if (!url?.trim()) {
    return undefined;
  }

  try {
    return normalizeBaseUrl(new URL(url.trim()).origin);
  } catch {
    return undefined;
  }
}

function extractReturnPath(url: string | undefined, fallbackPath: string): string {
  if (!url?.trim()) {
    return fallbackPath;
  }

  try {
    const parsed = new URL(url.trim());

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallbackPath;
  }
}

function joinBaseUrlAndPath(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${baseUrl}${normalizedPath}`;
}

function appendCheckoutReturnQueryParams(
  template: string,
  params: { subscriptionId: string; invoiceRefId: string },
): string {
  let url = template;

  for (const [key, value] of Object.entries(params)) {
    url = url.replace(`{${key}}`, encodeURIComponent(value));
  }

  const separator = url.includes('?') ? '&' : '?';

  return `${url}${separator}subscriptionId=${encodeURIComponent(params.subscriptionId)}&invoiceRefId=${encodeURIComponent(params.invoiceRefId)}`;
}

export function resolveDefaultTenantFrontendBaseUrl(env: TenantFrontendUrlEnv = readTenantFrontendUrlEnv()): string {
  return resolveTenantFrontendBaseUrl(DEFAULT_TENANT, env);
}
