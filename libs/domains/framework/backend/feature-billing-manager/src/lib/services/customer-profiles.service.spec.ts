import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

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
    }) as CustomerProfileEntity;

  it('creates profile when missing', async () => {
    const repository = {
      findByUserId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'p1' }),
      update: jest.fn(),
    } as any;
    const service = new CustomerProfilesService(repository);
    const result = await service.upsert('user-1', { firstName: 'Jane' });

    expect(result.id).toBe('p1');
  });

  describe('isProfileComplete', () => {
    it('returns false when profile is null', () => {
      const repository = { findByUserId: jest.fn(), create: jest.fn(), update: jest.fn() } as any;
      const service = new CustomerProfilesService(repository);

      expect(service.isProfileComplete(null)).toBe(false);
    });

    it('returns false when a required field is null', () => {
      const repository = { findByUserId: jest.fn(), create: jest.fn(), update: jest.fn() } as any;
      const service = new CustomerProfilesService(repository);
      const profile = createCompleteProfile();

      profile.firstName = undefined;
      expect(service.isProfileComplete(profile)).toBe(false);
    });

    it('returns false when a required field is empty string', () => {
      const repository = { findByUserId: jest.fn(), create: jest.fn(), update: jest.fn() } as any;
      const service = new CustomerProfilesService(repository);
      const profile = createCompleteProfile();

      profile.country = '';
      expect(service.isProfileComplete(profile)).toBe(false);
    });

    it('returns true when all required fields are non-empty', () => {
      const repository = { findByUserId: jest.fn(), create: jest.fn(), update: jest.fn() } as any;
      const service = new CustomerProfilesService(repository);

      expect(service.isProfileComplete(createCompleteProfile())).toBe(true);
    });
  });
});
