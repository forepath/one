import { isBillingApiRequest } from './billing-api-request.utils';

describe('isBillingApiRequest', () => {
  const billingApiUrl = 'http://localhost:3200/api';

  it('matches exact billing API URLs', () => {
    expect(isBillingApiRequest('http://localhost:3200/api/subscriptions', billingApiUrl)).toBe(true);
  });

  it('matches billing API URLs when base has trailing slash', () => {
    expect(isBillingApiRequest('http://localhost:3200/api/backorders', 'http://localhost:3200/api/')).toBe(true);
  });

  it('does not match unrelated hosts', () => {
    expect(isBillingApiRequest('http://localhost:3100/api/subscriptions', billingApiUrl)).toBe(false);
  });

  it('returns false when billing API URL is missing', () => {
    expect(isBillingApiRequest('http://localhost:3200/api/subscriptions', undefined)).toBe(false);
  });
});
