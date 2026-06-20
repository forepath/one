export function normalizeApiBaseUrl(apiUrl: string | undefined): string | null {
  const trimmed = apiUrl?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, '');
}

/**
 * Returns true when the outgoing request targets the configured billing REST API.
 */
export function isBillingApiRequest(requestUrl: string, billingRestApiUrl: string | undefined): boolean {
  const billingBase = normalizeApiBaseUrl(billingRestApiUrl);

  if (!billingBase) {
    return false;
  }

  if (requestUrl.startsWith(billingBase)) {
    return true;
  }

  try {
    const billingUrl = new URL(billingBase);
    const request = new URL(requestUrl, billingUrl.origin);

    if (request.origin !== billingUrl.origin) {
      return false;
    }

    const billingPath = billingUrl.pathname.replace(/\/+$/, '') || '/';

    return request.pathname === billingPath || request.pathname.startsWith(`${billingPath}/`);
  } catch {
    return false;
  }
}
