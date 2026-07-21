import { BILLING_PAT_SCOPES } from './billing-pat.scopes';

describe('BILLING_PAT_SCOPES', () => {
  const expectedScopes = [
    'catalog:write',
    'subscriptions:read',
    'subscriptions:write',
    'invoices:read',
    'invoices:write',
    'invoices:pay',
    'customer_profile:write',
    'customer_profile:admin',
    'usage:read',
    'usage:write',
    'promotions:read',
    'promotions:write',
    'projects:read',
    'projects:write',
    'tickets:read',
    'tickets:write',
    'milestones:write',
    'time_entries:write',
    'billing_admin:read',
    'billing_admin:write',
    'datev:write',
    'users:admin',
    'webhooks:admin',
  ];

  it('has unique entries', () => {
    expect(new Set(BILLING_PAT_SCOPES).size).toBe(BILLING_PAT_SCOPES.length);
  });

  it('matches the full billing PAT catalog', () => {
    expect(BILLING_PAT_SCOPES).toEqual(expectedScopes);
  });
});
