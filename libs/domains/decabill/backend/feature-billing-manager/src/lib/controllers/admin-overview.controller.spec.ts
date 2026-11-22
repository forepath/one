import { REQUIRE_SCOPES_KEY, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';

import { AdminOverviewController } from './admin-overview.controller';

describe('AdminOverviewController', () => {
  const adminOverviewService = { getOverview: jest.fn() };
  const controller = new AdminOverviewController(adminOverviewService as never);

  beforeEach(() => jest.clearAllMocks());

  it('is restricted to admins with the billing:admin scope', () => {
    expect(Reflect.getMetadata(USERS_ROLES_KEY, AdminOverviewController)).toEqual([UserRole.ADMIN]);
    expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, AdminOverviewController)).toEqual(['billing:admin']);
  });

  it('passes the query to the service', async () => {
    const response = { scope: 'tenant', tenants: [] };

    adminOverviewService.getOverview.mockResolvedValue(response);

    await expect(controller.getOverview('all', '2026-11-01', '2026-11-30', 'month')).resolves.toBe(response);
    expect(adminOverviewService.getOverview).toHaveBeenCalledWith({
      viewTenantId: 'all',
      from: '2026-11-01',
      to: '2026-11-30',
      groupBy: 'month',
    });
  });
});
