import { requireTenantIdForEnqueue, resolveBillingJobTenantId } from './resolve-billing-job-tenant-id';

describe('resolveBillingJobTenantId', () => {
  it('returns explicit tenantId from payload', () => {
    expect(resolveBillingJobTenantId({ tenantId: 'acme' }, { jobName: 'subscription-billing.unit' })).toBe('acme');
  });

  it('falls back to default and warns when tenantId is missing', () => {
    const warn = jest.fn();

    expect(resolveBillingJobTenantId({}, { jobName: 'subscription-billing.unit', jobId: 'job-1' }, { warn })).toBe(
      'default',
    );

    expect(warn).toHaveBeenCalledWith(
      'Billing job "subscription-billing.unit" (job-1) missing tenantId; using "default" for legacy backlog compatibility',
    );
  });
});

describe('requireTenantIdForEnqueue', () => {
  it('returns tenantId when present', () => {
    expect(requireTenantIdForEnqueue('subscription-billing.unit', { tenantId: 'acme' })).toBe('acme');
  });

  it('throws when tenantId is missing', () => {
    expect(() => requireTenantIdForEnqueue('subscription-billing.unit', {})).toThrow(
      'Cannot enqueue subscription-billing.unit without tenantId',
    );
  });
});
