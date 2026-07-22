import { BadRequestException } from '@nestjs/common';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { CustomerType } from '../constants/customer-type.constants';
import { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';

import { CustomerProfilesService } from './customer-profiles.service';

describe('CustomerProfilesService', () => {
  const createCompleteProfile = (): CustomerProfileEntity =>
    ({
      id: 'cp-1',
      userId: 'user-1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      addressLine1: '123 Main St',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      vatIdValidationStatus: VatIdValidationStatus.NONE,
    }) as CustomerProfileEntity;

  const vatIdValidationService = {
    validateOnProfileChange: jest.fn().mockResolvedValue({
      status: VatIdValidationStatus.NONE,
      source: null,
      validatedAt: null,
      vatId: null,
    }),
    markValidatedByAdmin: jest.fn(),
    validateAsync: jest.fn(),
  };

  const createService = (repository: any) => new CustomerProfilesService(repository, vatIdValidationService as never);

  beforeEach(() => {
    jest.clearAllMocks();
    vatIdValidationService.validateOnProfileChange.mockResolvedValue({
      status: VatIdValidationStatus.NONE,
      source: null,
      validatedAt: null,
      vatId: null,
    });
  });

  it('creates profile when missing', async () => {
    const repository = {
      findByUserId: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'p1', userId: 'user-1', vatIdValidationStatus: VatIdValidationStatus.NONE }),
      update: jest.fn().mockImplementation((_id, patch) => Promise.resolve({ id: 'p1', userId: 'user-1', ...patch })),
    } as any;
    const service = createService(repository);
    const result = await service.upsert('user-1', { firstName: 'Jane' });

    expect(result.id).toBe('p1');
  });

  it('infers business customer type from company and validates VAT on create', async () => {
    const repository = {
      findByUserId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'p1',
        userId: 'user-1',
        company: 'Acme',
        customerType: CustomerType.BUSINESS,
        vatId: 'DE123456789',
        country: 'DE',
      }),
      update: jest.fn().mockImplementation((_id, patch) => Promise.resolve({ id: 'p1', userId: 'user-1', ...patch })),
    } as any;
    vatIdValidationService.validateOnProfileChange.mockResolvedValue({
      status: VatIdValidationStatus.VALID,
      source: VatIdValidationSource.VIES_SYNC,
      validatedAt: new Date('2026-07-01T00:00:00Z'),
      vatId: 'DE123456789',
    });
    const service = createService(repository);

    await service.upsert('user-1', {
      company: 'Acme',
      vatId: 'de123456789',
      country: 'DE',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerType: CustomerType.BUSINESS,
        vatId: 'DE123456789',
      }),
    );
    expect(vatIdValidationService.validateOnProfileChange).toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        vatIdValidationStatus: VatIdValidationStatus.VALID,
        vatIdValidationSource: VatIdValidationSource.VIES_SYNC,
      }),
    );
  });

  it('clears VAT validation when vatId is removed', async () => {
    const existing = {
      ...createCompleteProfile(),
      vatId: 'DE123456789',
      vatIdValidationStatus: VatIdValidationStatus.VALID,
    };
    const repository = {
      findByUserId: jest.fn().mockResolvedValue(existing),
      update: jest
        .fn()
        .mockResolvedValueOnce({ ...existing, vatId: null })
        .mockResolvedValueOnce({
          ...existing,
          vatId: null,
          vatIdValidationStatus: VatIdValidationStatus.NONE,
          vatIdValidatedAt: null,
          vatIdValidationSource: null,
        }),
    } as any;
    const service = createService(repository);

    await service.upsert('user-1', { vatId: null });

    expect(repository.update).toHaveBeenLastCalledWith(
      'cp-1',
      expect.objectContaining({
        vatId: null,
        vatIdValidationStatus: VatIdValidationStatus.NONE,
      }),
    );
  });

  it('revalidateVatId updates profile from validation service', async () => {
    const profile = { ...createCompleteProfile(), vatId: 'DE123456789' };
    const repository = {
      findByUserId: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockResolvedValue({ ...profile, vatIdValidationStatus: VatIdValidationStatus.VALID }),
    } as any;
    vatIdValidationService.validateOnProfileChange.mockResolvedValue({
      status: VatIdValidationStatus.VALID,
      source: VatIdValidationSource.VIES_SYNC,
      validatedAt: new Date('2026-07-02T00:00:00Z'),
      vatId: 'DE123456789',
    });
    const service = createService(repository);

    await service.revalidateVatId('user-1');

    expect(repository.update).toHaveBeenCalledWith(
      'cp-1',
      expect.objectContaining({
        vatIdValidationStatus: VatIdValidationStatus.VALID,
        vatId: 'DE123456789',
      }),
    );
  });

  it('revalidateVatId throws when profile missing', async () => {
    const repository = { findByUserId: jest.fn().mockResolvedValue(null) } as any;
    const service = createService(repository);

    await expect(service.revalidateVatId('user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('markVatIdValidatedByAdmin persists admin validation', async () => {
    const profile = { ...createCompleteProfile(), vatId: 'FR12345678901' };
    const repository = {
      findByIdOrThrow: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockResolvedValue({ ...profile, vatIdValidationStatus: VatIdValidationStatus.VALID }),
    } as any;
    vatIdValidationService.markValidatedByAdmin.mockReturnValue({
      status: VatIdValidationStatus.VALID,
      source: VatIdValidationSource.ADMIN,
      validatedAt: new Date('2026-07-03T00:00:00Z'),
      vatId: 'FR12345678901',
    });
    const service = createService(repository);

    await service.markVatIdValidatedByAdmin('cp-1');

    expect(vatIdValidationService.markValidatedByAdmin).toHaveBeenCalledWith('FR12345678901');
    expect(repository.update).toHaveBeenCalledWith(
      'cp-1',
      expect.objectContaining({
        vatIdValidationStatus: VatIdValidationStatus.VALID,
        vatIdValidationSource: VatIdValidationSource.ADMIN,
      }),
    );
  });

  describe('isProfileComplete', () => {
    it('returns false when profile is null', () => {
      const repository = { findByUserId: jest.fn(), create: jest.fn(), update: jest.fn() } as any;
      const service = createService(repository);

      expect(service.isProfileComplete(null)).toBe(false);
    });

    it('returns false when a required field is null', () => {
      const repository = { findByUserId: jest.fn(), create: jest.fn(), update: jest.fn() } as any;
      const service = createService(repository);
      const profile = createCompleteProfile();

      delete profile.city;

      expect(service.isProfileComplete(profile)).toBe(false);
    });

    it('returns true when all required fields are present', () => {
      const repository = { findByUserId: jest.fn(), create: jest.fn(), update: jest.fn() } as any;
      const service = createService(repository);

      expect(service.isProfileComplete(createCompleteProfile())).toBe(true);
    });
  });
});
