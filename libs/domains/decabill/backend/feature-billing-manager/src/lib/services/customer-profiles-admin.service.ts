import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminCustomerProfileListItemDto,
  CreateAdminCustomerProfileDto,
  PaginatedAdminCustomerProfilesResponseDto,
} from '../dto/admin-customer-profile.dto';
import type { CustomerProfileDto } from '../dto/customer-profile.dto';
import type { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { CustomerProfilesService } from './customer-profiles.service';

@Injectable()
export class CustomerProfilesAdminService {
  constructor(
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly usersRepository: UsersRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
  ) {}

  async list(limit: number, offset: number): Promise<PaginatedAdminCustomerProfilesResponseDto> {
    const { items, total } = await this.customerProfilesRepository.findAll(limit, offset);
    const userIds = [...new Set(items.map((item) => item.userId))];
    const userEmailById = new Map<string, string>();

    await Promise.all(
      userIds.map(async (userId) => {
        const user = await this.usersRepository.findByIdForTenant(userId);

        if (user?.email) {
          userEmailById.set(userId, user.email);
        }
      }),
    );

    return {
      items: items.map((profile) => this.mapListItem(profile, userEmailById.get(profile.userId))),
      total,
      limit,
      offset,
    };
  }

  async getById(id: string): Promise<CustomerProfileResponseDto & { userEmail?: string; isComplete: boolean }> {
    const profile = await this.customerProfilesRepository.findByIdOrThrow(id);
    const user = await this.usersRepository.findByIdForTenant(profile.userId);

    return {
      ...this.mapResponse(profile),
      userEmail: user?.email,
      isComplete: this.customerProfilesService.isProfileComplete(profile),
    };
  }

  async create(dto: CreateAdminCustomerProfileDto): Promise<CustomerProfileResponseDto> {
    const user = await this.usersRepository.findByIdForTenant(dto.userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.customerProfilesRepository.findByUserId(dto.userId);

    if (existing) {
      throw new BadRequestException('Customer profile already exists for user');
    }

    const { userId, ...profileFields } = dto;
    const profile = await this.customerProfilesRepository.create({
      userId,
      ...profileFields,
    });

    return this.mapResponse(profile);
  }

  async update(id: string, dto: CustomerProfileDto): Promise<CustomerProfileResponseDto> {
    const profile = await this.customerProfilesRepository.findByIdOrThrow(id);
    const updated = await this.customerProfilesRepository.update(id, this.sanitizeUpdate(dto));

    return this.mapResponse(updated);
  }

  async delete(id: string): Promise<void> {
    const profile = await this.customerProfilesRepository.findByIdOrThrow(id);
    const invoiceCount = await this.invoicesRepository.countByUserId(profile.userId);

    if (invoiceCount > 0) {
      throw new BadRequestException('Cannot delete profile for user with invoices');
    }

    const subscriptions = await this.subscriptionsRepository.findAllByUser(profile.userId, 1, 0);

    if (subscriptions.length > 0) {
      throw new BadRequestException('Cannot delete profile for user with subscriptions');
    }

    await this.customerProfilesRepository.delete(id);
  }

  private sanitizeUpdate(dto: CustomerProfileDto): Partial<CustomerProfileEntity> {
    const { ...fields } = dto;

    return fields;
  }

  private mapListItem(profile: CustomerProfileEntity, userEmail?: string): AdminCustomerProfileListItemDto {
    return {
      id: profile.id,
      userId: profile.userId,
      userEmail,
      firstName: profile.firstName,
      lastName: profile.lastName,
      company: profile.company,
      email: profile.email,
      country: profile.country,
      isComplete: this.customerProfilesService.isProfileComplete(profile),
      stripeCustomerId: profile.stripeCustomerId,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private mapResponse(row: CustomerProfileEntity): CustomerProfileResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      postalCode: row.postalCode,
      city: row.city,
      state: row.state,
      country: row.country,
      email: row.email,
      phone: row.phone,
      stripeCustomerId: row.stripeCustomerId,
      autoBillingEnabled: row.autoBillingEnabled ?? false,
      hasPaymentMethodOnFile: Boolean(row.defaultPaymentMethodExternalId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
