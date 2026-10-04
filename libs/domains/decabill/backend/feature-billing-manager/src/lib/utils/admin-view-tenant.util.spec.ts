import { ForbiddenException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { resolveAdminViewTenant } from './admin-view-tenant.util';

describe('resolveAdminViewTenant', () => {
  const globalViewsConfig = {
    isGlobalViewsAllowedForTenant: jest.fn(),
  };

  beforeEach(() => {
    globalViewsConfig.isGlobalViewsAllowedForTenant.mockReset();
  });

  it('returns request tenant when viewTenantId omitted', () => {
    runWithTenantId('default', () => {
      expect(resolveAdminViewTenant(globalViewsConfig as never, undefined)).toBe('default');
    });
  });

  it('returns request tenant when viewTenantId matches', () => {
    runWithTenantId('acme', () => {
      expect(resolveAdminViewTenant(globalViewsConfig as never, 'acme')).toBe('acme');
    });
  });

  it('allows foreign viewTenantId when request tenant is allowlisted', () => {
    globalViewsConfig.isGlobalViewsAllowedForTenant.mockReturnValue(true);

    runWithTenantId('default', () => {
      expect(resolveAdminViewTenant(globalViewsConfig as never, 'acme')).toBe('acme');
    });
    expect(globalViewsConfig.isGlobalViewsAllowedForTenant).toHaveBeenCalledWith('default');
  });

  it('rejects foreign viewTenantId when request tenant is not allowlisted', () => {
    globalViewsConfig.isGlobalViewsAllowedForTenant.mockReturnValue(false);

    runWithTenantId('default', () => {
      expect(() => resolveAdminViewTenant(globalViewsConfig as never, 'acme')).toThrow(ForbiddenException);
    });
  });
});
