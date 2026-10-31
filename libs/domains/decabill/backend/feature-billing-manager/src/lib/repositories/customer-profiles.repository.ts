import { UserEntity } from '@forepath/identity/backend';
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { hydrateEntitiesBySearchIds } from '../search/billing-search-hydrate.util';
import { applyBillingSearchIlike } from '../search/billing-search-ilike.util';
import { BillingSearchIndexService } from '../search/billing-search-index.service';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class CustomerProfilesRepository {
  constructor(
    @InjectRepository(CustomerProfileEntity)
    private readonly repository: Repository<CustomerProfileEntity>,
    @Optional() private readonly billingSearchIndexService?: BillingSearchIndexService,
  ) {}

  async findByUserId(userId: string): Promise<CustomerProfileEntity | null> {
    return await this.repository
      .createQueryBuilder('profile')
      .innerJoin('users', 'user', 'user.id = profile.user_id')
      .where('profile.user_id = :userId', { userId })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();
  }

  /** Profiles of several users in the current tenant (one query; admin list name lookups). */
  async findByUserIds(userIds: string[]): Promise<CustomerProfileEntity[]> {
    if (userIds.length === 0) {
      return [];
    }

    return await this.repository
      .createQueryBuilder('profile')
      .innerJoin('users', 'user', 'user.id = profile.user_id')
      .where('profile.user_id IN (:...userIds)', { userIds })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getMany();
  }

  async findByIdOrThrow(id: string): Promise<CustomerProfileEntity> {
    const entity = await this.repository
      .createQueryBuilder('profile')
      .innerJoin('users', 'user', 'user.id = profile.user_id')
      .where('profile.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Customer profile with ID ${id} not found`);
    }

    return entity;
  }

  async findAll(
    limit: number,
    offset: number,
    search?: string,
  ): Promise<{ items: CustomerProfileEntity[]; total: number }> {
    if (search?.trim() && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('customer-profiles', search.trim(), {
        tenantId: getRequiredTenantId(),
        limit,
        offset,
      });
      const hydrated = await hydrateEntitiesBySearchIds(this.repository, lookup);

      if (hydrated) {
        return hydrated;
      }
    }

    const qb = this.repository
      .createQueryBuilder('profile')
      .leftJoin(UserEntity, 'user', 'user.id = profile.user_id')
      // List responses never expose customData; skip hydrate/decrypt for that column.
      .select([
        'profile.id',
        'profile.userId',
        'profile.customerNumber',
        'profile.numberScope',
        'profile.firstName',
        'profile.lastName',
        'profile.company',
        'profile.customerType',
        'profile.vatId',
        'profile.vatIdValidationStatus',
        'profile.vatIdValidatedAt',
        'profile.vatIdValidationSource',
        'profile.addressLine1',
        'profile.addressLine2',
        'profile.postalCode',
        'profile.city',
        'profile.state',
        'profile.country',
        'profile.email',
        'profile.phone',
        'profile.stripeCustomerId',
        'profile.autoBillingEnabled',
        'profile.defaultPaymentMethodExternalId',
        'profile.trustScore',
        'profile.trustLevel',
        'profile.trustScoreUpdatedAt',
        'profile.createdAt',
        'profile.updatedAt',
      ])
      .orderBy('profile.updatedAt', 'DESC');

    applyUserTenantFilter(qb, 'user');

    if (search?.trim()) {
      applyBillingSearchIlike(qb, 'customer-profiles', 'profile', search);
    }

    const total = await qb.getCount();
    const items = await qb.take(limit).skip(offset).getMany();

    return { items, total };
  }

  async create(dto: Partial<CustomerProfileEntity>): Promise<CustomerProfileEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<CustomerProfileEntity>): Promise<CustomerProfileEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }
}
