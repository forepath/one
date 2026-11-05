import { parsePatScope } from '@forepath/identity/backend';

import { BILLING_PAT_SCOPES } from './billing-pat.scopes';

describe('BILLING_PAT_SCOPES', () => {
  const expectedScopes = [
    'catalog:read',
    'catalog:admin',
    'subscriptions:read',
    'subscriptions:write',
    'subscriptions:admin',
    'invoices:read',
    'invoices:write',
    'invoices:admin',
    'customer_profile:read',
    'customer_profile:write',
    'customer_profile:admin',
    'supplier_profile:admin',
    'supplier_invoices:admin',
    'usage:read',
    'usage:admin',
    'promotions:read',
    'promotions:write',
    'promotions:admin',
    'offers:read',
    'offers:write',
    'offers:admin',
    'projects:read',
    'projects:admin',
    'milestones:read',
    'milestones:admin',
    'time_entries:read',
    'time_entries:admin',
    'tickets:read',
    'tickets:write',
    'tickets:admin',
    'attachments:read',
    'attachments:admin',
    'billing:admin',
    'files:admin',
    'datev:admin',
    'websocket:billing:read',
    'websocket:projects:read',
    'users:admin',
    'webhooks:admin',
    'updates:admin',
  ];

  it('has unique entries', () => {
    expect(new Set(BILLING_PAT_SCOPES).size).toBe(BILLING_PAT_SCOPES.length);
  });

  it('only contains <resource>:read|write|admin scopes', () => {
    expect(BILLING_PAT_SCOPES.filter((scope) => parsePatScope(scope) === undefined)).toEqual([]);
  });

  it('matches the full billing PAT catalog', () => {
    expect(BILLING_PAT_SCOPES).toEqual(expectedScopes);
  });
});
