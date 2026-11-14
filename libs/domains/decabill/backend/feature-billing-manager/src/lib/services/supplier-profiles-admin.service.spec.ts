import { BadRequestException } from '@nestjs/common';

import { SupplierProfilesAdminService } from './supplier-profiles-admin.service';

describe('SupplierProfilesAdminService', () => {
  const supplierProfilesRepository = {
    findAll: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const supplierProfilesService = {
    isProfileComplete: jest.fn().mockReturnValue(true),
    create: jest.fn(),
    update: jest.fn(),
    revalidateVatId: jest.fn(),
    markVatIdValidatedByAdmin: jest.fn(),
  };
  const supplierInvoicesRepository = { countBySupplierId: jest.fn() };
  const billingNotificationPublisher = {
    publishSupplierProfileCreated: jest.fn(),
    publishSupplierProfileUpdated: jest.fn(),
    publishSupplierProfileDeleted: jest.fn(),
    publishSupplierProfileCustomDataAdded: jest.fn(),
    publishSupplierProfileCustomDataUpdated: jest.fn(),
    publishSupplierProfileCustomDataDeleted: jest.fn(),
  };
  const datevCreditorAccountsRepository = { findByTenantAndSupplierId: jest.fn() };
  const service = new SupplierProfilesAdminService(
    supplierProfilesRepository as never,
    supplierProfilesService as never,
    supplierInvoicesRepository as never,
    billingNotificationPublisher as never,
    datevCreditorAccountsRepository as never,
  );
  const profile = {
    id: 'supplier-1',
    supplierNumber: 'SUP-000001',
    numberScope: '__shared__',
    firstName: 'Acme',
    lastName: 'GmbH',
    email: 'billing@acme.example',
    customData: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    datevCreditorAccountsRepository.findByTenantAndSupplierId.mockResolvedValue(null);
  });

  it('delete rejects supplier with invoices', async () => {
    supplierProfilesRepository.findByIdOrThrow.mockResolvedValue(profile);
    supplierInvoicesRepository.countBySupplierId.mockResolvedValue(2);

    await expect(service.delete('supplier-1')).rejects.toThrow(BadRequestException);
  });

  it('create publishes notification', async () => {
    supplierProfilesService.create.mockResolvedValue(profile);

    await service.create({ company: 'Acme GmbH', email: 'billing@acme.example' });

    expect(billingNotificationPublisher.publishSupplierProfileCreated).toHaveBeenCalledWith({
      profileId: 'supplier-1',
      supplierNumber: 'SUP-000001',
    });
  });
});
