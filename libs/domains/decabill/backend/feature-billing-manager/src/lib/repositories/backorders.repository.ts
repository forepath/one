import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BackorderEntity, BackorderStatus } from '../entities/backorder.entity';
import { hydrateEntitiesBySearchIds } from '../search/billing-search-hydrate.util';
import { applyBillingSearchIlike } from '../search/billing-search-ilike.util';
import { BillingSearchIndexService } from '../search/billing-search-index.service';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class BackordersRepository {
  constructor(
    @InjectRepository(BackorderEntity)
    private readonly repository: Repository<BackorderEntity>,
    @Optional() private readonly billingSearchIndexService?: BillingSearchIndexService,
  ) {}

  async findByIdOrThrow(id: string): Promise<BackorderEntity> {
    const entity = await this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Backorder with ID ${id} not found`);
    }

    return entity;
  }

  /** One page of the user's backorders (newest first); `statuses` narrows it (e.g. only pending / retrying). */
  async findAllByUser(
    userId: string,
    limit = 10,
    offset = 0,
    search?: string,
    statuses?: BackorderStatus[],
  ): Promise<BackorderEntity[]> {
    if (search?.trim() && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('backorders', search.trim(), {
        tenantId: getRequiredTenantId(),
        limit,
        offset,
        extraFilters: statuses?.length ? { userId, status: statuses } : { userId },
      });
      const hydrated = await hydrateEntitiesBySearchIds(this.repository, lookup);

      if (hydrated) {
        return hydrated.items;
      }
    }

    const qb = this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.user_id = :userId', { userId })
      .orderBy('backorder.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    if (statuses?.length) {
      qb.andWhere('backorder.status IN (:...statuses)', { statuses });
    }

    if (search?.trim()) {
      applyBillingSearchIlike(qb, 'backorders', 'backorder', search);
    }

    return await qb.getMany();
  }

  async countFailedByUserId(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.user_id = :userId', { userId })
      .andWhere('backorder.status = :status', { status: BackorderStatus.FAILED });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  /** Pending + retrying — matches customer console “open backorders” KPI. */
  async countOpenByUserId(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.user_id = :userId', { userId })
      .andWhere('backorder.status IN (:...statuses)', {
        statuses: [BackorderStatus.PENDING, BackorderStatus.RETRYING],
      });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async findAllPending(limit = 100, offset = 0): Promise<BackorderEntity[]> {
    const qb = this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.status IN (:...statuses)', { statuses: [BackorderStatus.PENDING, BackorderStatus.RETRYING] })
      .orderBy('backorder.createdAt', 'ASC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async create(dto: Partial<BackorderEntity>): Promise<BackorderEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<BackorderEntity>): Promise<BackorderEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async cancelPendingForUserPlan(userId: string, planId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(BackorderEntity)
      .set({ status: BackorderStatus.CANCELLED })
      .where('user_id = :userId', { userId })
      .andWhere('plan_id = :planId', { planId })
      .andWhere('status IN (:...statuses)', { statuses: [BackorderStatus.PENDING, BackorderStatus.RETRYING] })
      .execute();
  }
}
