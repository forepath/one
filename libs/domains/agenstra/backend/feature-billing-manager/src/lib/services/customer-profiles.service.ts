import { BadRequestException, Injectable } from '@nestjs/common';

import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';

const REQUIRED_PROFILE_FIELDS: (keyof CustomerProfileEntity)[] = [
  'firstName',
  'lastName',
  'email',
  'addressLine1',
  'postalCode',
  'city',
  'country',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@Injectable()
export class CustomerProfilesService {
  constructor(private readonly customerProfilesRepository: CustomerProfilesRepository) {}

  /**
   * Returns true if the profile exists and all required fields for ordering are non-null and non-empty.
   * Required: firstName, lastName, email, addressLine1, postalCode, city, country.
   */
  isProfileComplete(profile: CustomerProfileEntity | null): boolean {
    if (profile === null) {
      return false;
    }

    return REQUIRED_PROFILE_FIELDS.every((field) => isNonEmptyString(profile[field]));
  }

  async getByUserId(userId: string): Promise<CustomerProfileEntity | null> {
    return await this.customerProfilesRepository.findByUserId(userId);
  }

  async upsert(userId: string, dto: Partial<CustomerProfileEntity>): Promise<CustomerProfileEntity> {
    const existing = await this.customerProfilesRepository.findByUserId(userId);

    if (existing) {
      return await this.customerProfilesRepository.update(existing.id, dto);
    }

    return await this.customerProfilesRepository.create({
      userId,
      ...dto,
    });
  }

  async updateStripeCustomerId(userId: string, stripeCustomerId: string): Promise<CustomerProfileEntity> {
    const profile = await this.customerProfilesRepository.findByUserId(userId);

    if (!profile) {
      throw new BadRequestException('Customer profile not found');
    }

    return await this.customerProfilesRepository.update(profile.id, { stripeCustomerId });
  }
}
