import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminSupplierProfileDetailDto,
  AdminSupplierProfileListItemDto,
  CreateAdminSupplierProfileDto,
  PaginatedAdminSupplierProfilesResponseDto,
  SupplierProfileFieldsDto,
} from '../dto/admin-supplier-profile.dto';
import type { SupplierProfileEntity } from '../entities/supplier-profile.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { DatevCreditorAccountsRepository } from '../repositories/datev-creditor-accounts.repository';
import { SupplierInvoicesRepository } from '../repositories/supplier-invoices.repository';
import { SupplierProfilesRepository } from '../repositories/supplier-profiles.repository';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

import { SupplierProfilesService } from './supplier-profiles.service';

@Injectable()
export class SupplierProfilesAdminService {
  constructor(
    private readonly supplierProfilesRepository: SupplierProfilesRepository,
    private readonly supplierProfilesService: SupplierProfilesService,
    private readonly supplierInvoicesRepository: SupplierInvoicesRepository,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly datevCreditorAccountsRepository: DatevCreditorAccountsRepository,
  ) {}

  async list(limit: number, offset: number, search?: string): Promise<PaginatedAdminSupplierProfilesResponseDto> {
    const { items, total } = await this.supplierProfilesRepository.findAll(limit, offset, search);

    return {
      items: items.map((profile) => this.mapListItem(profile)),
      total,
      limit,
      offset,
    };
  }

  async getById(id: string): Promise<AdminSupplierProfileDetailDto> {
    const profile = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const creditor = await this.datevCreditorAccountsRepository.findByTenantAndSupplierId(
      getRequiredTenantId(),
      profile.id,
    );

    return this.mapDetail(profile, creditor?.creditorNumber ?? null);
  }

  async create(dto: CreateAdminSupplierProfileDto): Promise<AdminSupplierProfileDetailDto> {
    const profile = await this.supplierProfilesService.create(dto);

    this.billingNotificationPublisher.publishSupplierProfileCreated({
      profileId: profile.id,
      supplierNumber: profile.supplierNumber,
    });

    return this.mapDetail(profile, null);
  }

  async update(id: string, dto: SupplierProfileFieldsDto): Promise<AdminSupplierProfileDetailDto> {
    const updated = await this.supplierProfilesService.update(id, dto);

    this.billingNotificationPublisher.publishSupplierProfileUpdated({
      profileId: updated.id,
      supplierNumber: updated.supplierNumber,
    });

    const creditor = await this.datevCreditorAccountsRepository.findByTenantAndSupplierId(
      getRequiredTenantId(),
      updated.id,
    );

    return this.mapDetail(updated, creditor?.creditorNumber ?? null);
  }

  async delete(id: string): Promise<void> {
    const profile = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const invoiceCount = await this.supplierInvoicesRepository.countBySupplierId(profile.id);

    if (invoiceCount > 0) {
      throw new BadRequestException('Cannot delete supplier with invoices');
    }

    await this.supplierProfilesRepository.delete(id);

    this.billingNotificationPublisher.publishSupplierProfileDeleted({
      profileId: profile.id,
      supplierNumber: profile.supplierNumber,
    });
  }

  async addCustomData(id: string, key: string, value: string): Promise<AdminSupplierProfileDetailDto> {
    this.assertCustomDataKey(key);
    const profile = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const customData = this.normalizeCustomData(profile.customData);

    if (Object.prototype.hasOwnProperty.call(customData, key)) {
      throw new ConflictException('Custom data key already exists');
    }

    const updated = await this.supplierProfilesRepository.update(id, {
      customData: { ...customData, [key]: value },
    });

    this.billingNotificationPublisher.publishSupplierProfileCustomDataAdded({
      profileId: updated.id,
      key,
    });

    return await this.getById(updated.id);
  }

  async updateCustomData(id: string, key: string, value: string): Promise<AdminSupplierProfileDetailDto> {
    this.assertCustomDataKey(key);
    const profile = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const customData = this.normalizeCustomData(profile.customData);

    if (!Object.prototype.hasOwnProperty.call(customData, key)) {
      throw new NotFoundException('Custom data key not found');
    }

    const updated = await this.supplierProfilesRepository.update(id, {
      customData: { ...customData, [key]: value },
    });

    this.billingNotificationPublisher.publishSupplierProfileCustomDataUpdated({
      profileId: updated.id,
      key,
    });

    return await this.getById(updated.id);
  }

  async deleteCustomData(id: string, key: string): Promise<AdminSupplierProfileDetailDto> {
    this.assertCustomDataKey(key);
    const profile = await this.supplierProfilesRepository.findByIdOrThrow(id);
    const customData = this.normalizeCustomData(profile.customData);

    if (!Object.prototype.hasOwnProperty.call(customData, key)) {
      throw new NotFoundException('Custom data key not found');
    }

    const next = { ...customData };

    delete next[key];

    await this.supplierProfilesRepository.update(id, { customData: next });

    this.billingNotificationPublisher.publishSupplierProfileCustomDataDeleted({
      profileId: profile.id,
      key,
    });

    return await this.getById(id);
  }

  async revalidateVatId(id: string): Promise<AdminSupplierProfileDetailDto> {
    const updated = await this.supplierProfilesService.revalidateVatId(id);

    return await this.getById(updated.id);
  }

  async markVatIdValidated(id: string): Promise<AdminSupplierProfileDetailDto> {
    const updated = await this.supplierProfilesService.markVatIdValidatedByAdmin(id);

    return await this.getById(updated.id);
  }

  private assertCustomDataKey(key: string): void {
    if (!key || key.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(key)) {
      throw new BadRequestException('Invalid custom data key');
    }
  }

  private normalizeCustomData(value: Record<string, string> | null | undefined): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, string> = {};

    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') {
        result[key] = entry;
      } else if (entry != null) {
        result[key] = String(entry);
      }
    }

    return result;
  }

  private mapListItem(profile: SupplierProfileEntity): AdminSupplierProfileListItemDto {
    return {
      id: profile.id,
      supplierNumber: profile.supplierNumber,
      firstName: profile.firstName,
      lastName: profile.lastName,
      company: profile.company,
      email: profile.email,
      country: profile.country,
      isComplete: this.supplierProfilesService.isProfileComplete(profile),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private mapDetail(profile: SupplierProfileEntity, datevCreditorNumber: number | null): AdminSupplierProfileDetailDto {
    return {
      id: profile.id,
      supplierNumber: profile.supplierNumber,
      numberScope: profile.numberScope,
      datevCreditorNumber,
      firstName: profile.firstName,
      lastName: profile.lastName,
      company: profile.company,
      customerType: profile.customerType ?? undefined,
      vatId: profile.vatId,
      vatIdValidationStatus: profile.vatIdValidationStatus,
      vatIdValidatedAt: profile.vatIdValidatedAt,
      vatIdValidationSource: profile.vatIdValidationSource,
      addressLine1: profile.addressLine1,
      addressLine2: profile.addressLine2,
      postalCode: profile.postalCode,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      email: profile.email,
      phone: profile.phone,
      isComplete: this.supplierProfilesService.isProfileComplete(profile),
      customData: this.normalizeCustomData(profile.customData),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
