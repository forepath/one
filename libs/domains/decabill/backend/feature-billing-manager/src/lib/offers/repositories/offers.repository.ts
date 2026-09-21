import { UserEntity } from '@forepath/identity/backend';
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { hydrateEntitiesBySearchIds } from '../../search/billing-search-hydrate.util';
import { applyBillingSearchIlike } from '../../search/billing-search-ilike.util';
import { BillingSearchIndexService } from '../../search/billing-search-index.service';
import { applyUserTenantFilter, getRequiredTenantId } from '../../utils/tenant-query.utils';
import { OfferStatus, HISTORY_OFFER_STATUSES, PENDING_OFFER_STATUSES } from '../constants/offer-status.constants';
import { OfferEntity } from '../entities/offer.entity';

export interface AdminOfferListParams {
  limit: number;
  offset: number;
  search?: string;
  userId?: string;
}

@Injectable()
export class OffersRepository {
  constructor(
    @InjectRepository(OfferEntity)
    private readonly repository: Repository<OfferEntity>,
    @Optional() private readonly billingSearchIndexService?: BillingSearchIndexService,
  ) {}

  async findByIdOrThrow(id: string, withLines = false): Promise<OfferEntity> {
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .where('offer.id = :id', { id });

    applyUserTenantFilter(qb, 'user');

    if (withLines) {
      qb.leftJoinAndSelect('offer.lineItems', 'lineItems').orderBy('lineItems.position', 'ASC');
    }

    const entity = await qb.getOne();

    if (!entity) {
      throw new NotFoundException(`Offer with ID ${id} not found`);
    }

    return entity;
  }

  async create(data: Partial<OfferEntity>): Promise<OfferEntity> {
    const entity = this.repository.create(data);

    return await this.repository.save(entity);
  }

  async update(id: string, data: Partial<OfferEntity>): Promise<OfferEntity> {
    await this.findByIdOrThrow(id);
    await this.repository.update(id, data);

    return await this.findByIdOrThrow(id, true);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }

  async findAllForAdmin(params: AdminOfferListParams): Promise<{ items: OfferEntity[]; total: number }> {
    if (params.search?.trim() && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('offers', params.search.trim(), {
        tenantId: getRequiredTenantId(),
        limit: params.limit,
        offset: params.offset,
        extraFilters: params.userId ? { userId: params.userId } : undefined,
      });
      const hydrated = await hydrateEntitiesBySearchIds(this.repository, lookup);

      if (hydrated) {
        return hydrated;
      }
    }

    const qb = this.repository.createQueryBuilder('offer').leftJoin(UserEntity, 'user', 'user.id = offer.user_id');

    applyUserTenantFilter(qb, 'user');

    if (params.userId) {
      qb.andWhere('offer.userId = :userId', { userId: params.userId });
    }

    if (params.search?.trim()) {
      applyBillingSearchIlike(qb, 'offers', 'offer', params.search, {
        userEmail: 'user.email',
      });
    }

    const total = await qb.getCount();
    const items = await qb.orderBy('offer.createdAt', 'DESC').take(params.limit).skip(params.offset).getMany();

    return { items, total };
  }

  async findPendingByUserId(userId: string, search?: string): Promise<OfferEntity[]> {
    return await this.findByUserIdAndStatuses(userId, PENDING_OFFER_STATUSES, search, (qb) => {
      qb.andWhere('(offer.expires_at IS NULL OR offer.expires_at > NOW())');
    });
  }

  async findHistoryByUserId(userId: string, search?: string): Promise<OfferEntity[]> {
    return await this.findByUserIdAndStatuses(userId, HISTORY_OFFER_STATUSES, search);
  }

  private async findByUserIdAndStatuses(
    userId: string,
    statuses: OfferStatus[],
    search?: string,
    extra?: (qb: ReturnType<Repository<OfferEntity>['createQueryBuilder']>) => void,
  ): Promise<OfferEntity[]> {
    const trimmedSearch = search?.trim();

    if (trimmedSearch && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('offers', trimmedSearch, {
        tenantId: getRequiredTenantId(),
        extraFilters: { userId, status: statuses },
      });

      if (lookup) {
        const qb = this.repository
          .createQueryBuilder('offer')
          .innerJoin('users', 'user', 'user.id = offer.user_id')
          .where('offer.id IN (:...ids)', {
            ids: lookup.ids.length ? lookup.ids : ['00000000-0000-0000-0000-000000000000'],
          })
          .andWhere('offer.user_id = :userId', { userId })
          .andWhere('offer.status IN (:...statuses)', { statuses });

        applyUserTenantFilter(qb, 'user');
        extra?.(qb);

        return await qb.orderBy('offer.createdAt', 'DESC').getMany();
      }
    }

    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .where('offer.user_id = :userId', { userId })
      .andWhere('offer.status IN (:...statuses)', { statuses });

    applyUserTenantFilter(qb, 'user');
    extra?.(qb);

    if (trimmedSearch) {
      applyBillingSearchIlike(qb, 'offers', 'offer', trimmedSearch);
    }

    return await qb.orderBy('offer.createdAt', 'DESC').getMany();
  }

  async countByUserAndStatus(userId: string, statuses: OfferStatus[]): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .where('offer.user_id = :userId', { userId })
      .andWhere('offer.status IN (:...statuses)', { statuses });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async countPendingForUser(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .where('offer.user_id = :userId', { userId })
      .andWhere('offer.status = :status', { status: OfferStatus.ARCHIVED })
      .andWhere('(offer.expires_at IS NULL OR offer.expires_at > NOW())');

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async countByStatus(status: OfferStatus, userId?: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .where('offer.status = :status', { status });

    applyUserTenantFilter(qb, 'user');

    if (userId) {
      qb.andWhere('offer.user_id = :userId', { userId });
    }

    return await qb.getCount();
  }

  async sumGrossByStatus(status: OfferStatus, userId?: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .select('COALESCE(SUM(offer.total_gross), 0)', 'total')
      .where('offer.status = :status', { status });

    applyUserTenantFilter(qb, 'user');

    if (userId) {
      qb.andWhere('offer.user_id = :userId', { userId });
    }

    const row = await qb.getRawOne<{ total: string }>();

    return Number(row?.total ?? 0);
  }

  async countByTimestampField(params: {
    field: 'accepted_at' | 'declined_at' | 'expired_at' | 'revoked_at' | 'archived_at';
    from: Date;
    to: Date;
    userId?: string;
  }): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .where(`offer.${params.field} IS NOT NULL`)
      .andWhere(`offer.${params.field} >= :from`, { from: params.from })
      .andWhere(`offer.${params.field} <= :to`, { to: params.to });

    applyUserTenantFilter(qb, 'user');

    if (params.userId) {
      qb.andWhere('offer.user_id = :userId', { userId: params.userId });
    }

    return await qb.getCount();
  }

  async countTransitionSeries(params: {
    field: 'archived_at' | 'accepted_at' | 'declined_at';
    from: Date;
    to: Date;
    groupBy: 'day' | 'month';
    userId?: string;
  }): Promise<Array<{ period: string; count: number }>> {
    const periodExpr =
      params.groupBy === 'month'
        ? `to_char(date_trunc('month', offer.${params.field}), 'YYYY-MM-01')`
        : `to_char(offer.${params.field}, 'YYYY-MM-DD')`;
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .select(periodExpr, 'period')
      .addSelect('COUNT(*)', 'count')
      .where(`offer.${params.field} IS NOT NULL`)
      .andWhere(`offer.${params.field} >= :from`, { from: params.from })
      .andWhere(`offer.${params.field} <= :to`, { to: params.to });

    applyUserTenantFilter(qb, 'user');

    if (params.userId) {
      qb.andWhere('offer.user_id = :userId', { userId: params.userId });
    }

    qb.groupBy('period').orderBy('period', 'ASC');

    const rows = await qb.getRawMany<{ period: string; count: string }>();

    return rows.map((row) => ({ period: row.period, count: Number(row.count ?? 0) }));
  }

  async findArchivedExpired(before: Date): Promise<OfferEntity[]> {
    const qb = this.repository
      .createQueryBuilder('offer')
      .innerJoin('users', 'user', 'user.id = offer.user_id')
      .where('offer.status = :status', { status: OfferStatus.ARCHIVED })
      .andWhere('offer.expires_at IS NOT NULL')
      .andWhere('offer.expires_at <= :before', { before });

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }
}
