import { UserEntity } from '@forepath/identity/backend';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  BILLED_INVOICE_STATUSES,
  InvoiceStatus,
  OPEN_OVERDUE_INVOICE_STATUSES,
} from '../constants/invoice-status.constants';
import { InvoiceEntity } from '../entities/invoice.entity';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

export interface OpenOverdueSummary {
  count: number;
  totalBalance: number;
}

export interface AdminInvoiceListParams {
  userId?: string;
  search?: string;
  limit: number;
  offset: number;
}

/** @deprecated Use AdminInvoiceListParams */
export type AdminOpenOverdueListParams = AdminInvoiceListParams;

export interface TurnoverSeriesRow {
  period: string;
  totalGross: number;
}

export interface TurnoverByPlanRow {
  planId: string;
  planName: string;
  totalGross: number;
}

@Injectable()
export class InvoicesRepository {
  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly repository: Repository<InvoiceEntity>,
  ) {}

  async findBySubscription(userId: string, subscriptionId: string): Promise<InvoiceEntity[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.subscription_id = :subscriptionId', { subscriptionId })
      .orderBy('inv.createdAt', 'DESC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findLatestBySubscription(subscriptionId: string): Promise<InvoiceEntity | null> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.subscription_id = :subscriptionId', { subscriptionId })
      .orderBy('inv.createdAt', 'DESC')
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findLatestBillableBySubscription(subscriptionId: string): Promise<InvoiceEntity | null> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('inv.status IN (:...statuses)', {
        statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
      })
      .andWhere('inv.invoice_number IS NOT NULL')
      .orderBy('inv.createdAt', 'DESC')
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findByIdAndSubscriptionId(id: string, subscriptionId: string): Promise<InvoiceEntity | null> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.id = :id', { id })
      .andWhere('inv.subscription_id = :subscriptionId', { subscriptionId });

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findById(id: string): Promise<InvoiceEntity | null> {
    return await this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();
  }

  async findByIdForUser(invoiceId: string, userId: string): Promise<InvoiceEntity | null> {
    const invoice = await this.findById(invoiceId);

    if (!invoice || invoice.userId !== userId) {
      return null;
    }

    return invoice;
  }

  async findByIdOrThrow(id: string): Promise<InvoiceEntity> {
    const entity = await this.findById(id);

    if (!entity) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    return entity;
  }

  async findByIdWithLineItems(id: string): Promise<InvoiceEntity | null> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .leftJoinAndSelect('inv.lineItems', 'lineItems')
      .where('inv.id = :id', { id });

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findBatchForOverdueCheck(batchSize: number, offset: number): Promise<InvoiceEntity[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.status IN (:...statuses)', { statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] })
      .orderBy('inv.createdAt', 'ASC')
      .take(batchSize)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findOpenOverdueByUserId(userId: string): Promise<InvoiceEntity[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .leftJoinAndSelect('inv.subscription', 'subscription')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.status IN (:...statuses)', { statuses: OPEN_OVERDUE_INVOICE_STATUSES })
      .orderBy('inv.createdAt', 'DESC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findOpenOverdueSummaryByUserId(userId: string): Promise<OpenOverdueSummary> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.status IN (:...statuses)', { statuses: OPEN_OVERDUE_INVOICE_STATUSES });

    applyUserTenantFilter(qb, 'user');

    const result = await qb
      .select('COUNT(inv.id)', 'count')
      .addSelect('COALESCE(SUM(inv.balance_due), 0)', 'total')
      .getRawOne<{ count: string; total: string }>();
    const count = result?.count != null ? parseInt(String(result.count), 10) : 0;
    const totalBalance = result?.total != null ? parseFloat(String(result.total)) : 0;

    return { count, totalBalance };
  }

  async findGlobalOpenOverdueSummary(): Promise<OpenOverdueSummary> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.status IN (:...statuses)', { statuses: OPEN_OVERDUE_INVOICE_STATUSES })
      .select('COUNT(inv.id)', 'count')
      .addSelect('COALESCE(SUM(inv.balance_due), 0)', 'total');

    applyUserTenantFilter(qb, 'user');

    const result = await qb.getRawOne<{ count: string; total: string }>();
    const count = result?.count != null ? parseInt(String(result.count), 10) : 0;
    const totalBalance = result?.total != null ? parseFloat(String(result.total)) : 0;

    return { count, totalBalance };
  }

  async findAllForAdmin(params: AdminInvoiceListParams): Promise<{ items: InvoiceEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.subscription', 'subscription')
      .leftJoin(UserEntity, 'user', 'user.id = inv.user_id');

    applyUserTenantFilter(qb, 'user');

    if (params.userId) {
      qb.andWhere('inv.userId = :userId', { userId: params.userId });
    }

    if (params.search?.trim()) {
      const term = `%${params.search.trim().toLowerCase()}%`;

      qb.andWhere(
        `(LOWER(inv.invoice_number) LIKE :term
          OR LOWER(subscription.number) LIKE :term
          OR LOWER(user.email) LIKE :term
          OR CAST(inv.id AS text) LIKE :term
          OR CAST(inv.user_id AS text) LIKE :term
          OR CAST(user.id AS text) LIKE :term)`,
        { term },
      );
    }

    const total = await qb.getCount();
    const items = await qb.orderBy('inv.createdAt', 'DESC').take(params.limit).skip(params.offset).getMany();

    return { items, total };
  }

  /** @deprecated Use findAllForAdmin */
  async findAllOpenOverdue(params: AdminInvoiceListParams): Promise<{ items: InvoiceEntity[]; total: number }> {
    return await this.findAllForAdmin(params);
  }

  async sumPaidGrossByPeriod(
    from: Date,
    to: Date,
    groupBy: 'day' | 'month',
    userId?: string,
  ): Promise<TurnoverSeriesRow[]> {
    const trunc = groupBy === 'month' ? 'month' : 'day';
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES })
      .andWhere('inv.issued_at IS NOT NULL')
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to });

    applyUserTenantFilter(qb, 'user');

    if (userId) {
      qb.andWhere('inv.userId = :userId', { userId });
    }

    const periodExpr = `DATE_TRUNC('${trunc}', inv.issued_at)`;
    const rows = await qb
      .select(periodExpr, 'period')
      .addSelect('COALESCE(SUM(inv.total_gross), 0)', 'totalGross')
      .groupBy(periodExpr)
      .orderBy(periodExpr, 'ASC')
      .getRawMany<{ period: Date; totalGross: string }>();

    return rows.map((row) => ({
      period: row.period instanceof Date ? row.period.toISOString().slice(0, 10) : String(row.period),
      totalGross: parseFloat(String(row.totalGross)),
    }));
  }

  async countPaidInPeriod(from: Date, to: Date, userId?: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.status = :status', { status: InvoiceStatus.PAID })
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to });

    applyUserTenantFilter(qb, 'user');

    if (userId) {
      qb.andWhere('inv.userId = :userId', { userId });
    }

    return await qb.getCount();
  }

  async sumByPlanInPeriod(from: Date, to: Date, userId?: string): Promise<TurnoverByPlanRow[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .innerJoin('inv.subscription', 'subscription')
      .innerJoin('subscription.plan', 'plan')
      .where('inv.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES })
      .andWhere('inv.issued_at IS NOT NULL')
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to });

    applyUserTenantFilter(qb, 'user');

    if (userId) {
      qb.andWhere('inv.userId = :userId', { userId });
    }

    const rows = await qb
      .select('plan.id', 'planId')
      .addSelect('plan.name', 'planName')
      .addSelect('COALESCE(SUM(inv.total_gross), 0)', 'totalGross')
      .groupBy('plan.id')
      .addGroupBy('plan.name')
      .orderBy('COALESCE(SUM(inv.total_gross), 0)', 'DESC')
      .getRawMany<{ planId: string; planName: string; totalGross: string }>();

    return rows.map((row) => ({
      planId: row.planId,
      planName: row.planName,
      totalGross: parseFloat(String(row.totalGross)),
    }));
  }

  async update(id: string, dto: Partial<InvoiceEntity>): Promise<InvoiceEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async create(dto: Partial<InvoiceEntity>): Promise<InvoiceEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async countByUserId(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.user_id = :userId', { userId });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }

  async findIssuedInPeriod(from: Date, to: Date): Promise<InvoiceEntity[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .leftJoinAndSelect('inv.lineItems', 'lineItems')
      .where('inv.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES })
      .andWhere('inv.issued_at IS NOT NULL')
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to })
      .orderBy('inv.issued_at', 'ASC')
      .addOrderBy('lineItems.position', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findVoidedInPeriod(from: Date, to: Date): Promise<InvoiceEntity[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .leftJoinAndSelect('inv.lineItems', 'lineItems')
      .where('inv.status = :status', { status: InvoiceStatus.VOID })
      .andWhere('inv.voided_at IS NOT NULL')
      .andWhere('inv.voided_at >= :from', { from })
      .andWhere('inv.voided_at <= :to', { to })
      .orderBy('inv.voided_at', 'ASC')
      .addOrderBy('lineItems.position', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }
}

/** @deprecated Use InvoicesRepository */
export { InvoicesRepository as InvoiceRefsRepository };
