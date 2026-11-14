import { Injectable } from '@nestjs/common';

import { CustomerType } from '../constants/customer-type.constants';
import { VatIdValidationStatus } from '../constants/vat-id-validation.constants';
import type { SupplierProfileFieldsDto } from '../dto/admin-supplier-profile.dto';
import type { SupplierProfileEntity } from '../entities/supplier-profile.entity';
import { SupplierNumberSequencesRepository } from '../repositories/supplier-number-sequences.repository';
import { SupplierProfilesRepository } from '../repositories/supplier-profiles.repository';
import { getRequiredTenantId } from '../utils/tenant-query.utils';
import { normalizeVatId } from '../utils/vat-id.utils';

import { VatIdValidationService } from './vat-id-validation.service';

const REQUIRED_PROFILE_FIELDS: (keyof SupplierProfileEntity)[] = [
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

function inferCustomerType(dto: Partial<SupplierProfileEntity>): CustomerType | null | undefined {
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
export class SupplierProfilesService {
  constructor(
    private readonly supplierProfilesRepository: SupplierProfilesRepository,
    private readonly supplierNumberSequencesRepository: SupplierNumberSequencesRepository,
    private readonly vatIdValidationService: VatIdValidationService,
  ) {}

  isProfileComplete(profile: SupplierProfileEntity | null): boolean {
    if (profile === null) {
      return false;
    }

    return REQUIRED_PROFILE_FIELDS.every((field) => isNonEmptyString(profile[field]));
  }

  async create(dto: SupplierProfileFieldsDto): Promise<SupplierProfileEntity> {
    const prepared = this.prepareProfilePatch(dto, null);
    const allocated = await this.supplierNumberSequencesRepository.nextSupplierNumber();
    const created = await this.supplierProfilesRepository.create({
      ...prepared,
      tenantId: getRequiredTenantId(),
      supplierNumber: allocated.number,
      numberScope: allocated.numberScope,
      customData: {},
      vatIdValidationStatus: prepared.vatIdValidationStatus ?? VatIdValidationStatus.NONE,
    });

    return await this.applyVatValidationIfNeeded(created, null, prepared);
  }

  async update(id: string, dto: SupplierProfileFieldsDto): Promise<SupplierProfileEntity> {
    const existing = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const prepared = this.prepareProfilePatch(dto, existing);
    const updated = await this.supplierProfilesRepository.update(id, prepared);

    return await this.applyVatValidationIfNeeded(updated, existing, prepared);
  }

  async revalidateVatId(id: string): Promise<SupplierProfileEntity> {
    const profile = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const result = await this.vatIdValidationService.validateOnProfileChange({
      profileId: profile.id,
      userId: profile.id,
      vatId: profile.vatId,
      country: profile.country,
    });

    return await this.supplierProfilesRepository.update(profile.id, {
      vatId: result.vatId,
      vatIdValidationStatus: result.status,
      vatIdValidatedAt: result.validatedAt,
      vatIdValidationSource: result.source,
    });
  }

  async markVatIdValidatedByAdmin(id: string): Promise<SupplierProfileEntity> {
    const profile = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const result = this.vatIdValidationService.markValidatedByAdmin(profile.vatId);

    return await this.supplierProfilesRepository.update(profile.id, {
      vatId: result.vatId,
      vatIdValidationStatus: result.status,
      vatIdValidatedAt: result.validatedAt,
      vatIdValidationSource: result.source,
    });
  }

  private prepareProfilePatch(
    dto: SupplierProfileFieldsDto | Partial<SupplierProfileEntity>,
    existing: SupplierProfileEntity | null,
  ): Partial<SupplierProfileEntity> {
    const patch: Partial<SupplierProfileEntity> = { ...dto };
    const inferredType = inferCustomerType({
      ...existing,
      ...dto,
    } as Partial<SupplierProfileEntity>);

    if (inferredType) {
      patch.customerType = inferredType;
    }

    if ('vatId' in dto) {
      patch.vatId = normalizeVatId(dto.vatId as string | null | undefined);
    }

    return patch;
  }

  private async applyVatValidationIfNeeded(
    profile: SupplierProfileEntity,
    previous: SupplierProfileEntity | null,
    patch: Partial<SupplierProfileEntity>,
  ): Promise<SupplierProfileEntity> {
    const vatChanged =
      ('vatId' in patch && (previous?.vatId ?? null) !== (profile.vatId ?? null)) ||
      ('country' in patch && (previous?.country ?? null) !== (profile.country ?? null)) ||
      ('customerType' in patch && (previous?.customerType ?? null) !== (profile.customerType ?? null));

    if (!vatChanged && previous) {
      return profile;
    }

    if (!profile.vatId) {
      if (previous?.vatId) {
        return await this.supplierProfilesRepository.update(profile.id, {
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
      userId: profile.id,
      vatId: profile.vatId,
      country: profile.country,
    });

    return await this.supplierProfilesRepository.update(profile.id, {
      vatId: result.vatId,
      vatIdValidationStatus: result.status,
      vatIdValidatedAt: result.validatedAt,
      vatIdValidationSource: result.source,
    });
  }
}
