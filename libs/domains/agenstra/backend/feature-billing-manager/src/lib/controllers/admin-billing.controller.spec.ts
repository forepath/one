import 'reflect-metadata';

import { KEYCLOAK_ROLES_KEY, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';

import { AdminBillingController } from './admin-billing.controller';

describe('AdminBillingController', () => {
  const billingAdminService = { getGlobalSummary: jest.fn() };
  const adminBillNowService = { queueBillNow: jest.fn() };
  const invoiceAdminService = {
    listInvoices: jest.fn(),
    voidInvoice: jest.fn(),
    markPaidManual: jest.fn(),
    markUnpaidManual: jest.fn(),
  };
  const statisticsQueryService = { getSummary: jest.fn(), getByProduct: jest.fn() };
  const auditLogService = { listForInvoice: jest.fn() };
  const controller = new AdminBillingController(
    billingAdminService as never,
    adminBillNowService as never,
    invoiceAdminService as never,
    statisticsQueryService as never,
    auditLogService as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('has admin role guards on controller', () => {
    const keycloakRoles = Reflect.getMetadata(KEYCLOAK_ROLES_KEY, AdminBillingController);
    const usersRoles = Reflect.getMetadata(USERS_ROLES_KEY, AdminBillingController);

    expect(keycloakRoles).toContain(UserRole.ADMIN);
    expect(usersRoles).toContain(UserRole.ADMIN);
  });

  it('getSummary delegates to billing admin service', async () => {
    billingAdminService.getGlobalSummary.mockResolvedValue({ activeSubscriptionsCount: 1 });

    const result = await controller.getSummary();

    expect(result.activeSubscriptionsCount).toBe(1);
  });

  it('billNow passes admin user id', async () => {
    adminBillNowService.queueBillNow.mockResolvedValue({
      queued: true,
      requestId: 'req-1',
      userCount: 2,
    });

    await controller.billNow({}, { user: { id: 'admin-1', roles: ['admin'] } } as never);

    expect(adminBillNowService.queueBillNow).toHaveBeenCalledWith('admin-1', {});
  });
});
