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
  const manualInvoiceService = {
    createDraft: jest.fn(),
    getDetail: jest.fn(),
    updateDraft: jest.fn(),
    issueDraft: jest.fn(),
    deleteDraft: jest.fn(),
  };
  const statisticsQueryService = { getSummary: jest.fn(), getByProduct: jest.fn() };
  const auditLogService = { listForInvoice: jest.fn() };
  const invoiceService = { getPdfBuffer: jest.fn(), getVoidPdfBuffer: jest.fn() };
  const invoicesRepository = { findById: jest.fn() };
  const controller = new AdminBillingController(
    billingAdminService as never,
    adminBillNowService as never,
    invoiceAdminService as never,
    manualInvoiceService as never,
    statisticsQueryService as never,
    auditLogService as never,
    invoiceService as never,
    invoicesRepository as never,
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

  it('createManualInvoice delegates to manual invoice service', async () => {
    manualInvoiceService.createDraft.mockResolvedValue({ id: 'inv-1' });

    await controller.createManualInvoice(
      { userId: 'user-1', lineItems: [{ description: 'Test', quantity: 1, unitPriceNet: 10 }] },
      { user: { id: 'admin-1', roles: ['admin'] } } as never,
    );

    expect(manualInvoiceService.createDraft).toHaveBeenCalledWith(
      { userId: 'user-1', lineItems: [{ description: 'Test', quantity: 1, unitPriceNet: 10 }] },
      'admin-1',
    );
  });
});
