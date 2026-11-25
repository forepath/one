import { BadRequestException, Injectable, Optional } from '@nestjs/common';

import { CustomerType } from '../constants/customer-type.constants';
import { DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { VatIdValidationStatus } from '../constants/vat-id-validation.constants';
import type { CustomerProfileDto } from '../dto/customer-profile.dto';
import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { buildPostalRecipient } from '../postal-providers/postal-letter.service';
import { PostalProviderFactory } from '../postal-providers/postal-provider.factory';
import { CustomerNumberSequencesRepository } from '../repositories/customer-number-sequences.repository';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { normalizeVatId } from '../utils/vat-id.utils';

import { VatIdValidationService } from './vat-id-validation.service';

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

function inferCustomerType(dto: Partial<CustomerProfileEntity>): CustomerType | null | undefined {
  if (dto.customerType === CustomerType.BUSINESS || dto.customerType === CustomerType.CONSUMER) {
    return dto.customerType;
  }

  if (dto.customerType === null) {
    return null;
  }

  if (isNonEmptyString(dto.company)) {
    return CustomerType.BUSINESS;
  }

  return CustomerType.CONSUMER;
}

@Injectable()
export class CustomerProfilesService {
  constructor(
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly customerNumberSequencesRepository: CustomerNumberSequencesRepository,
    private readonly vatIdValidationService: VatIdValidationService,
    @Optional() private readonly billingNotificationPublisher?: BillingNotificationPublisher,
    @Optional() private readonly postalProviders?: PostalProviderFactory,
  ) {}

  /** Letters can be chosen as preferred delivery (the tenant's default postal provider is configured). */
  isPostalDeliveryAvailable(): boolean {
    return this.postalProviders?.getDefaultConfiguredProvider() != null;
  }

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

  async upsert(
    userId: string,
    dto: CustomerProfileDto | Partial<CustomerProfileEntity>,
  ): Promise<CustomerProfileEntity> {
    const existing = await this.customerProfilesRepository.findByUserId(userId);
    const prepared = this.prepareProfilePatch(dto, existing);

    this.assertDeliveryPreference(prepared, existing);

    if (existing) {
      const updated = await this.customerProfilesRepository.update(existing.id, prepared);
      const result = await this.applyVatValidationIfNeeded(updated, existing, prepared);

      this.billingNotificationPublisher?.publishCustomerProfile('customer_profile.updated', result);

      return result;
    }

    const allocated = await this.customerNumberSequencesRepository.nextCustomerNumber();
    const created = await this.customerProfilesRepository.create({
      userId,
      ...prepared,
      customerNumber: allocated.number,
      numberScope: allocated.numberScope,
      vatIdValidationStatus: prepared.vatIdValidationStatus ?? VatIdValidationStatus.NONE,
    });
    const result = await this.applyVatValidationIfNeeded(created, null, prepared);

    this.billingNotificationPublisher?.publishCustomerProfile('customer_profile.created', result);

    return result;
  }

  async revalidateVatId(userId: string): Promise<CustomerProfileEntity> {
    const profile = await this.customerProfilesRepository.findByUserId(userId);

    if (!profile) {
      throw new BadRequestException('Customer profile not found');
    }

    const result = await this.vatIdValidationService.validateOnProfileChange({
      profileId: profile.id,
      userId,
      vatId: profile.vatId,
      country: profile.country,
    });

    return await this.customerProfilesRepository.update(profile.id, {
      vatId: result.vatId,
      vatIdValidationStatus: result.status,
      vatIdValidatedAt: result.validatedAt,
      vatIdValidationSource: result.source,
    });
  }

  async markVatIdValidatedByAdmin(profileId: string): Promise<CustomerProfileEntity> {
    const profile = await this.customerProfilesRepository.findByIdOrThrow(profileId);
    const result = this.vatIdValidationService.markValidatedByAdmin(profile.vatId);

    return await this.customerProfilesRepository.update(profile.id, {
      vatId: result.vatId,
      vatIdValidationStatus: result.status,
      vatIdValidatedAt: result.validatedAt,
      vatIdValidationSource: result.source,
    });
  }

  async updateStripeCustomerId(userId: string, stripeCustomerId: string): Promise<CustomerProfileEntity> {
    const profile = await this.customerProfilesRepository.findByUserId(userId);

    if (!profile) {
      throw new BadRequestException('Customer profile not found');
    }

    return await this.customerProfilesRepository.update(profile.id, { stripeCustomerId });
  }

  /**
   * `letter` as preferred delivery is offered only while the tenant has a postal provider (checked when it is chosen,
   * so a later configuration change never blocks saving other fields) and needs a complete postal address (checked on
   * every save while it is preferred).
   */
  private assertDeliveryPreference(
    patch: Partial<CustomerProfileEntity>,
    existing: CustomerProfileEntity | null,
  ): void {
    const next = patch.preferredDeliveryChannel ?? existing?.preferredDeliveryChannel ?? DocumentDeliveryChannel.EMAIL;

    if (next !== DocumentDeliveryChannel.LETTER) {
      return;
    }

    if (existing?.preferredDeliveryChannel !== DocumentDeliveryChannel.LETTER && !this.isPostalDeliveryAvailable()) {
      throw new BadRequestException('Delivery by letter is not available');
    }

    if (!buildPostalRecipient({ ...existing, ...patch } as CustomerProfileEntity)) {
      throw new BadRequestException(
        'Delivery by letter needs a complete postal address (name, street, postal code, city and country)',
      );
    }
  }

  private prepareProfilePatch(
    dto: CustomerProfileDto | Partial<CustomerProfileEntity>,
    existing: CustomerProfileEntity | null,
  ): Partial<CustomerProfileEntity> {
    const patch: Partial<CustomerProfileEntity> = { ...dto };
    const inferredType = inferCustomerType({
      ...existing,
      ...dto,
    } as Partial<CustomerProfileEntity>);

    if (inferredType) {
      patch.customerType = inferredType;
    }

    if ('vatId' in dto) {
      patch.vatId = normalizeVatId(dto.vatId as string | null | undefined);
    }

    return patch;
  }

  private async applyVatValidationIfNeeded(
    profile: CustomerProfileEntity,
    previous: CustomerProfileEntity | null,
    patch: Partial<CustomerProfileEntity>,
  ): Promise<CustomerProfileEntity> {
    const vatChanged =
      ('vatId' in patch && (previous?.vatId ?? null) !== (profile.vatId ?? null)) ||
      ('country' in patch && (previous?.country ?? null) !== (profile.country ?? null)) ||
      ('customerType' in patch && (previous?.customerType ?? null) !== (profile.customerType ?? null));

    if (!vatChanged && previous) {
      return profile;
    }

    if (!profile.vatId) {
      if (previous?.vatId) {
        return await this.customerProfilesRepository.update(profile.id, {
          vatId: null,
          vatIdValidationStatus: VatIdValidationStatus.NONE,
          vatIdValidatedAt: null,
          vatIdValidationSource: null,
        });
      }

      return profile;
    }

    const result = await this.vatIdValidationService.validateOnProfileChange({
      profileId: profile.id,
      userId: profile.userId,
      vatId: profile.vatId,
      country: profile.country,
    });

    return await this.customerProfilesRepository.update(profile.id, {
      vatId: result.vatId,
      vatIdValidationStatus: result.status,
      vatIdValidatedAt: result.validatedAt,
      vatIdValidationSource: result.source,
    });
  }
}
