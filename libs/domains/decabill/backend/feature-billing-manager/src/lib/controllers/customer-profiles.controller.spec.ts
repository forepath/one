import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CustomerType } from '../constants/customer-type.constants';
import { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { CustomerProfilesService } from '../services/customer-profiles.service';

import { CustomerProfilesController } from './customer-profiles.controller';

describe('CustomerProfilesController', () => {
  const customerProfilesService = {
    getByUserId: jest.fn(),
    upsert: jest.fn(),
    revalidateVatId: jest.fn(),
  };
  const paymentProcessorFactory = {
    getProcessor: jest.fn().mockReturnValue({ supportsAutoPayment: () => true }),
  };

  let controller: CustomerProfilesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerProfilesController],
      providers: [
        { provide: CustomerProfilesService, useValue: customerProfilesService },
        { provide: PaymentProcessorFactory, useValue: paymentProcessorFactory },
      ],
    }).compile();

    controller = moduleRef.get(CustomerProfilesController);
  });

  it('returns null when no profile', async () => {
    customerProfilesService.getByUserId.mockResolvedValue(null);

    await expect(controller.get({ user: { id: 'user-1', roles: ['user'] } } as never)).resolves.toBeNull();
  });

  it('maps VAT fields on get', async () => {
    customerProfilesService.getByUserId.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      customerType: CustomerType.BUSINESS,
      vatId: 'DE123456789',
      vatIdValidationStatus: VatIdValidationStatus.VALID,
      vatIdValidatedAt: new Date('2026-07-01T00:00:00Z'),
      vatIdValidationSource: VatIdValidationSource.VIES_SYNC,
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: 'ada@example.com',
      autoBillingEnabled: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    });

    const result = await controller.get({ user: { id: 'user-1', roles: ['user'] } } as never);

    expect(result).toEqual(
      expect.objectContaining({
        customerType: CustomerType.BUSINESS,
        vatId: 'DE123456789',
        vatIdValidationStatus: VatIdValidationStatus.VALID,
        vatIdValidationSource: VatIdValidationSource.VIES_SYNC,
        supportsAutoPayment: true,
      }),
    );
  });

  it('upserts and maps response', async () => {
    customerProfilesService.upsert.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      customerType: CustomerType.CONSUMER,
      vatIdValidationStatus: VatIdValidationStatus.NONE,
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: 'ada@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await controller.upsert(
      { firstName: 'Ada', lastName: 'Lovelace' } as never,
      { user: { id: 'user-1', roles: ['user'] } } as never,
    );

    expect(customerProfilesService.upsert).toHaveBeenCalledWith('user-1', expect.any(Object));
    expect(result.id).toBe('p1');
  });

  it('revalidateVatId maps VAT status fields', async () => {
    customerProfilesService.revalidateVatId.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      customerType: CustomerType.BUSINESS,
      vatId: 'DE123456789',
      vatIdValidationStatus: VatIdValidationStatus.PENDING,
      vatIdValidationSource: VatIdValidationSource.VIES_ASYNC,
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: 'ada@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await controller.revalidateVatId({ user: { id: 'user-1', roles: ['user'] } } as never);

    expect(result.vatIdValidationStatus).toBe(VatIdValidationStatus.PENDING);
  });

  it('throws when unauthenticated', async () => {
    await expect(controller.get({} as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.upsert({} as never, {} as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.revalidateVatId({} as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falls back supportsAutoPayment when processor lookup fails', async () => {
    paymentProcessorFactory.getProcessor.mockImplementation(() => {
      throw new Error('missing processor');
    });
    customerProfilesService.getByUserId.mockResolvedValue({
      id: 'p1',
      userId: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      customerType: CustomerType.CONSUMER,
      vatIdValidationStatus: VatIdValidationStatus.NONE,
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: 'ada@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await controller.get({ user: { id: 'user-1', roles: ['user'] } } as never);

    expect(result?.supportsAutoPayment).toBe(false);
  });
});
