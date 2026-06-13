import { UserEntity } from '@forepath/identity/backend';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  BILLED_INVOICE_STATUSES,
  InvoiceStatus,
  OPEN_OVERDUE_INVOICE_STATUSES,
} from '../constants/invoice-status.constants';
import { InvoiceEntity } from '../entities/invoice.entity';

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
    return await this.repository.find({
      where: { userId, subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  async findLatestBySubscription(subscriptionId: string): Promise<InvoiceEntity | null> {
    return await this.repository.findOne({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByIdAndSubscriptionId(id: string, subscriptionId: string): Promise<InvoiceEntity | null> {
    return await this.repository.findOne({
      where: { id, subscriptionId },
    });
  }

  async findById(id: string): Promise<InvoiceEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<InvoiceEntity> {
    const entity = await this.findById(id);

    if (!entity) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    return entity;
  }

  async findByIdWithLineItems(id: string): Promise<InvoiceEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['lineItems'],
    });
  }

  async findBatchForOverdueCheck(batchSize: number, offset: number): Promise<InvoiceEntity[]> {
    return await this.repository.find({
      where: { status: In([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID]) },
      order: { createdAt: 'ASC' },
      take: batchSize,
      skip: offset,
    });
  }

  async findOpenOverdueByUserId(userId: string): Promise<InvoiceEntity[]> {
    return await this.repository.find({
      where: { userId, status: In(OPEN_OVERDUE_INVOICE_STATUSES) },
      relations: ['subscription'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOpenOverdueSummaryByUserId(userId: string): Promise<OpenOverdueSummary> {
    const result = await this.repository
      .createQueryBuilder('inv')
      .where('inv.userId = :userId', { userId })
      .andWhere('inv.status IN (:...statuses)', { statuses: OPEN_OVERDUE_INVOICE_STATUSES })
      .select('COUNT(inv.id)', 'count')
      .addSelect('COALESCE(SUM(inv.balance_due), 0)', 'total')
      .getRawOne<{ count: string; total: string }>();
    const count = result?.count != null ? parseInt(String(result.count), 10) : 0;
    const totalBalance = result?.total != null ? parseFloat(String(result.total)) : 0;

    return { count, totalBalance };
  }

  async findGlobalOpenOverdueSummary(): Promise<OpenOverdueSummary> {
    const result = await this.repository
      .createQueryBuilder('inv')
      .where('inv.status IN (:...statuses)', { statuses: OPEN_OVERDUE_INVOICE_STATUSES })
      .select('COUNT(inv.id)', 'count')
      .addSelect('COALESCE(SUM(inv.balance_due), 0)', 'total')
      .getRawOne<{ count: string; total: string }>();
    const count = result?.count != null ? parseInt(String(result.count), 10) : 0;
    const totalBalance = result?.total != null ? parseFloat(String(result.total)) : 0;

    return { count, totalBalance };
  }

  async findAllForAdmin(params: AdminInvoiceListParams): Promise<{ items: InvoiceEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.subscription', 'subscription')
      .leftJoin(UserEntity, 'user', 'user.id = inv.user_id');

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
      .where('inv.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES })
      .andWhere('inv.issued_at IS NOT NULL')
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to });

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
      .where('inv.status = :status', { status: InvoiceStatus.PAID })
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to });

    if (userId) {
      qb.andWhere('inv.userId = :userId', { userId });
    }

    return await qb.getCount();
  }

  async sumByPlanInPeriod(from: Date, to: Date, userId?: string): Promise<TurnoverByPlanRow[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('inv.subscription', 'subscription')
      .innerJoin('subscription.plan', 'plan')
      .where('inv.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES })
      .andWhere('inv.issued_at IS NOT NULL')
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to });

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
}

/** @deprecated Use InvoicesRepository */
export { InvoicesRepository as InvoiceRefsRepository };
