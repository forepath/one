import {
  buildStripeCheckoutReturnUrl,
  parseTenantFrontendUrlMap,
  resolveDefaultTenantFrontendBaseUrl,
  resolveTenantFrontendBaseUrl,
} from './tenant-frontend-url.utils';

describe('tenant-frontend-url.utils', () => {
  const env = {
    billingFrontendUrl: 'http://localhost:4500',
    tenantFrontendUrls: 'acme=https://billing.acme.com,corp=https://billing.corp.example',
    stripeCheckoutSuccessUrl: 'http://legacy.example/invoices?payment=success',
    stripeCheckoutCancelUrl: 'http://legacy.example/invoices?payment=cancel',
  };

  it('parseTenantFrontendUrlMap parses tenant=url pairs', () => {
    expect(parseTenantFrontendUrlMap('acme=https://billing.acme.com,corp=https://billing.corp.example')).toEqual({
      acme: 'https://billing.acme.com',
      corp: 'https://billing.corp.example',
    });
    expect(parseTenantFrontendUrlMap('invalid-segment,=missing-tenant,acme=https://billing.acme.com/')).toEqual({
      acme: 'https://billing.acme.com',
    });
    expect(parseTenantFrontendUrlMap(undefined)).toEqual({});
  });

  it('resolveTenantFrontendBaseUrl uses per-tenant override', () => {
    expect(resolveTenantFrontendBaseUrl('acme', env)).toBe('https://billing.acme.com');
    expect(resolveTenantFrontendBaseUrl('default', env)).toBe('http://localhost:4500');
  });

  it('resolveTenantFrontendBaseUrl falls back to legacy success url origin', () => {
    expect(
      resolveTenantFrontendBaseUrl('default', {
        stripeCheckoutSuccessUrl: 'https://billing.example/invoices?payment=success',
      }),
    ).toBe('https://billing.example');
  });

  it('buildStripeCheckoutReturnUrl composes tenant-specific return urls', () => {
    const successUrl = buildStripeCheckoutReturnUrl(
      'acme',
      'success',
      { subscriptionId: 'sub-1', invoiceRefId: 'inv-1' },
      env,
    );

    expect(successUrl).toBe(
      'https://billing.acme.com/invoices?payment=success&subscriptionId=sub-1&invoiceRefId=inv-1',
    );

    const cancelUrl = buildStripeCheckoutReturnUrl(
      'corp',
      'cancel',
      { subscriptionId: '', invoiceRefId: 'inv-2' },
      env,
    );

    expect(cancelUrl).toBe('https://billing.corp.example/invoices?payment=cancel&subscriptionId=&invoiceRefId=inv-2');
  });

  it('resolveTenantFrontendBaseUrl ignores invalid legacy success urls', () => {
    expect(
      resolveTenantFrontendBaseUrl('default', {
        stripeCheckoutSuccessUrl: 'not-a-valid-url',
      }),
    ).toBe('http://localhost:4500');
  });

  it('buildStripeCheckoutReturnUrl uses fallback paths for invalid configured urls', () => {
    const url = buildStripeCheckoutReturnUrl(
      'default',
      'success',
      { subscriptionId: 'sub-1', invoiceRefId: 'inv-1' },
      {
        billingFrontendUrl: 'https://billing.example',
        stripeCheckoutSuccessUrl: 'not-a-valid-url',
      },
    );

    expect(url).toBe('https://billing.example/invoices?payment=success&subscriptionId=sub-1&invoiceRefId=inv-1');
  });

  it('resolveDefaultTenantFrontendBaseUrl resolves default tenant base url', () => {
    expect(resolveDefaultTenantFrontendBaseUrl(env)).toBe('http://localhost:4500');
  });
});
