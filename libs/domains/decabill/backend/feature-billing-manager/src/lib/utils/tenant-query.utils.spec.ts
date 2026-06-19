import { runWithTenantId } from '@forepath/shared/backend';

import { applyServiceTypeTenantFilter, applyUserTenantFilter, getRequiredTenantId } from './tenant-query.utils';

describe('tenant-query.utils', () => {
  it('getRequiredTenantId defaults to default outside async context', () => {
    expect(getRequiredTenantId()).toBe('default');
  });

  it('getRequiredTenantId reads bound tenant id', () => {
    runWithTenantId('tenant-x', () => {
      expect(getRequiredTenantId()).toBe('tenant-x');
    });
  });

  it('applyUserTenantFilter adds tenant predicate', () => {
    const qb = { andWhere: jest.fn().mockReturnThis() };

    runWithTenantId('tenant-y', () => {
      applyUserTenantFilter(qb as never, 'u');
    });

    expect(qb.andWhere).toHaveBeenCalledWith('u.tenant_id = :tenantId', { tenantId: 'tenant-y' });
  });

  it('applyServiceTypeTenantFilter adds tenant predicate', () => {
    const qb = { andWhere: jest.fn().mockReturnThis() };

    runWithTenantId('tenant-z', () => {
      applyServiceTypeTenantFilter(qb as never, 'st');
    });

    expect(qb.andWhere).toHaveBeenCalledWith('st.tenant_id = :tenantId', { tenantId: 'tenant-z' });
  });
});
