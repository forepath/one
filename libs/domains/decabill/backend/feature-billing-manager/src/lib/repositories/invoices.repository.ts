import { UserEntity } from '@forepath/identity/backend';
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { AutoPaymentStatus } from '../constants/auto-payment-status.constants';
import {
  BILLED_INVOICE_STATUSES,
  CUSTOMER_VISIBLE_INVOICE_STATUSES,
  HISTORY_INVOICE_STATUSES,
  InvoiceStatus,
  OPEN_OVERDUE_INVOICE_STATUSES,
} from '../constants/invoice-status.constants';
import { InvoiceEntity } from '../entities/invoice.entity';
import { OpenPositionEntity } from '../entities/open-position.entity';
import { BillingSearchIndexService } from '../search/billing-search-index.service';
import type { BillingSearchIdsLookup } from '../search/billing-search.types';
import { applyBillingSearchIlike } from '../search/billing-search-ilike.util';
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

export interface TurnoverByCountryRow {
  countryCode: string;
  totalGross: number;
}

@Injectable()
export class InvoicesRepository {
  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly repository: Repository<InvoiceEntity>,
    @Optional() private readonly billingSearchIndexService?: BillingSearchIndexService,
  ) {}

  async findBySubscription(userId: string, subscriptionId: string): Promise<InvoiceEntity[]> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('inv.status IN (:...statuses)', { statuses: CUSTOMER_VISIBLE_INVOICE_STATUSES })
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

  /**
   * Latest billable invoice that covers this subscription.
   *
   * Accumulated billing-day invoices stamp `subscription_id` with a primary row only, while other
   * subscriptions on the same invoice are linked solely via `billing_open_positions.invoice_ref_id`.
   * Prefer that OP linkage (period charges first) so prepaid partial credits / withdrawals do not
   * fall back to an open-position credit when the stamped subscription differs.
   */
  async findLatestBillableBySubscription(subscriptionId: string): Promise<InvoiceEntity | null> {
    const viaOpenPositions = await this.findLatestBillableCoveringOpenPositions(subscriptionId);

    if (viaOpenPositions) {
      return viaOpenPositions;
    }

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

  private async findLatestBillableCoveringOpenPositions(subscriptionId: string): Promise<InvoiceEntity | null> {
    const viaPeriodCharge = await this.findLatestBillableCoveringOpenPositionsInternal(subscriptionId, true);

    if (viaPeriodCharge) {
      return viaPeriodCharge;
    }

    return await this.findLatestBillableCoveringOpenPositionsInternal(subscriptionId, false);
  }

  private async findLatestBillableCoveringOpenPositionsInternal(
    subscriptionId: string,
    periodChargeOnly: boolean,
  ): Promise<InvoiceEntity | null> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .innerJoin(OpenPositionEntity, 'pos', 'pos.invoiceRefId = inv.id AND pos.subscriptionId = :subscriptionId', {
        subscriptionId,
      })
      .andWhere('inv.status IN (:...statuses)', {
        statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
      })
      .andWhere('inv.invoice_number IS NOT NULL')
      .orderBy('inv.createdAt', 'DESC')
      .take(1);

    if (periodChargeOnly) {
      qb.andWhere('pos.adjustmentNet IS NULL');
    }

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findByIdAndSubscriptionId(id: string, subscriptionId: string): Promise<InvoiceEntity | null> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.id = :id', { id })
      .andWhere('inv.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('inv.status IN (:...statuses)', { statuses: CUSTOMER_VISIBLE_INVOICE_STATUSES });

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

  async findByIdForUpdate(id: string, manager: EntityManager): Promise<InvoiceEntity | null> {
    const qb = manager
      .getRepository(InvoiceEntity)
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.id = :id', { id })
      .setLock('pessimistic_write');

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  /**
   * True when the storage key matches an invoice PDF or time report for the current tenant.
   */
  async existsAuthorizedByPdfOrTimeReportStorageKey(storageKey: string): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('(inv.pdf_storage_key = :storageKey OR inv.time_report_storage_key = :storageKey)', { storageKey });

    applyUserTenantFilter(qb, 'user');

    return (await qb.getCount()) > 0;
  }

  async findByIdForUser(invoiceId: string, userId: string): Promise<InvoiceEntity | null> {
    const invoice = await this.findById(invoiceId);

    if (!invoice || invoice.userId !== userId) {
      return null;
    }

    if (!CUSTOMER_VISIBLE_INVOICE_STATUSES.includes(invoice.status)) {
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

  async findIdsDueForAutoPayment(batchSize: number, offset: number): Promise<string[]> {
    const now = new Date();
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .select('inv.id', 'id')
      .where('inv.status IN (:...statuses)', { statuses: OPEN_OVERDUE_INVOICE_STATUSES })
      .andWhere(
        `(
          (
            inv.auto_payment_status IN (:...claimableStatuses)
            AND (inv.auto_payment_next_retry_at IS NULL OR inv.auto_payment_next_retry_at <= :now)
          )
          OR (
            inv.auto_payment_status = :inProgressStatus
            AND inv.auto_payment_next_retry_at IS NOT NULL
            AND inv.auto_payment_next_retry_at <= :now
          )
        )`,
        {
          claimableStatuses: [AutoPaymentStatus.SCHEDULED, AutoPaymentStatus.RETRYING],
          inProgressStatus: AutoPaymentStatus.IN_PROGRESS,
          now,
        },
      )
      .orderBy('inv.auto_payment_next_retry_at', 'ASC', 'NULLS FIRST')
      .addOrderBy('inv.createdAt', 'ASC')
      .take(batchSize)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    const rows = await qb.getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  /**
   * Atomically claims an invoice for an off-session charge attempt.
   * Returns null when another worker already claimed it or status is no longer claimable.
   */
  async claimForAutoPayment(invoiceId: string, attemptNumber: number): Promise<InvoiceEntity | null> {
    const result = await this.repository
      .createQueryBuilder()
      .update(InvoiceEntity)
      .set({
        autoPaymentStatus: AutoPaymentStatus.IN_PROGRESS,
        autoPaymentAttemptCount: attemptNumber,
        autoPaymentNextRetryAt: null,
      })
      .where('id = :invoiceId', { invoiceId })
      .andWhere('auto_payment_status IN (:...statuses)', {
        statuses: [AutoPaymentStatus.SCHEDULED, AutoPaymentStatus.RETRYING],
      })
      .execute();

    if (!result.affected) {
      return null;
    }

    return await this.findById(invoiceId);
  }

  /**
   * Transitions auto-payment state only while still IN_PROGRESS (sync/webhook race guard).
   */
  async transitionAutoPaymentFromInProgress(
    invoiceId: string,
    dto: {
      autoPaymentStatus: AutoPaymentStatus;
      autoPaymentNextRetryAt?: Date | null;
      autoPaymentAttemptCount?: number;
    },
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(InvoiceEntity)
      .set(dto)
      .where('id = :invoiceId', { invoiceId })
      .andWhere('auto_payment_status = :status', { status: AutoPaymentStatus.IN_PROGRESS })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async findOpenOverdueByUserId(
    userId: string,
    options?: { search?: string; limit?: number; offset?: number },
  ): Promise<InvoiceEntity[]> {
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const search = options?.search?.trim();

    if (search && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('invoices', search, {
        tenantId: getRequiredTenantId(),
        limit,
        offset,
        extraFilters: { userId, status: OPEN_OVERDUE_INVOICE_STATUSES },
      });
      const items = await this.hydrateInvoicesBySearchIds(lookup);

      if (items !== null) {
        return items;
      }
    }

    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .leftJoinAndSelect('inv.subscription', 'subscription')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.status IN (:...statuses)', { statuses: OPEN_OVERDUE_INVOICE_STATUSES })
      .orderBy('inv.createdAt', 'DESC');

    applyUserTenantFilter(qb, 'user');

    if (search) {
      applyBillingSearchIlike(qb, 'invoices', 'inv', search, {
        subscriptionNumber: 'subscription.number',
        userEmail: 'user.email',
      });
    }

    if (limit != null) {
      qb.take(limit).skip(offset);
    }

    return await qb.getMany();
  }

  async findHistoryByUserId(
    userId: string,
    options?: { search?: string; limit?: number; offset?: number },
  ): Promise<InvoiceEntity[]> {
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const search = options?.search?.trim();

    if (search && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('invoices', search, {
        tenantId: getRequiredTenantId(),
        limit,
        offset,
        extraFilters: { userId, status: HISTORY_INVOICE_STATUSES },
      });
      const items = await this.hydrateInvoicesBySearchIds(lookup);

      if (items !== null) {
        return items;
      }
    }

    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .leftJoinAndSelect('inv.subscription', 'subscription')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.status IN (:...statuses)', { statuses: HISTORY_INVOICE_STATUSES })
      .orderBy('inv.createdAt', 'DESC');

    applyUserTenantFilter(qb, 'user');

    if (search) {
      applyBillingSearchIlike(qb, 'invoices', 'inv', search, {
        subscriptionNumber: 'subscription.number',
        userEmail: 'user.email',
      });
    }

    if (limit != null) {
      qb.take(limit).skip(offset);
    }

    return await qb.getMany();
  }

  /** Count of the customer's invoice history (same scope as {@link findHistoryByUserId} without search). */
  async countHistoryByUserId(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.status IN (:...statuses)', { statuses: HISTORY_INVOICE_STATUSES });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
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

  async countByStatus(status: InvoiceStatus): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.status = :status', { status });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
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
    if (params.search?.trim() && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('invoices', params.search.trim(), {
        tenantId: getRequiredTenantId(),
        limit: params.limit,
        offset: params.offset,
        extraFilters: params.userId ? { userId: params.userId } : undefined,
      });

      const items = await this.hydrateInvoicesBySearchIds(lookup);

      if (items !== null) {
        return { items, total: lookup!.total };
      }
    }

    const qb = this.repository
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.subscription', 'subscription')
      .leftJoin(UserEntity, 'user', 'user.id = inv.user_id');

    applyUserTenantFilter(qb, 'user');

    if (params.userId) {
      qb.andWhere('inv.userId = :userId', { userId: params.userId });
    }

    if (params.search?.trim()) {
      applyBillingSearchIlike(qb, 'invoices', 'inv', params.search, {
        subscriptionNumber: 'subscription.number',
        userEmail: 'user.email',
      });
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
    // Prefer service-plan product; fall back to project name; otherwise Unknown.
    // Use CAST(...) instead of :: so TypeORM does not mangle PostgreSQL casts.
    const productIdExpr = `COALESCE(
      CAST(plan.id AS text),
      CASE WHEN project.id IS NOT NULL THEN CONCAT('project:', CAST(project.id AS text)) END,
      'UNKNOWN'
    )`;
    const productNameExpr = `COALESCE(
      NULLIF(TRIM(plan.name), ''),
      NULLIF(TRIM(project.name), ''),
      'Unknown'
    )`;
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .leftJoin('billing_subscriptions', 'subscription', 'subscription.id = inv.subscription_id')
      .leftJoin('billing_service_plans', 'plan', 'plan.id = subscription.plan_id')
      .leftJoin('billing_projects', 'project', 'project.id = inv.project_id')
      .where('inv.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES })
      .andWhere('inv.issued_at IS NOT NULL')
      .andWhere('inv.issued_at >= :from', { from })
      .andWhere('inv.issued_at <= :to', { to });

    applyUserTenantFilter(qb, 'user');

    if (userId) {
      qb.andWhere('inv.userId = :userId', { userId });
    }

    const rows = await qb
      .select(productIdExpr, 'planId')
      .addSelect(productNameExpr, 'planName')
      .addSelect('COALESCE(SUM(inv.total_gross), 0)', 'totalGross')
      .groupBy(productIdExpr)
      .addGroupBy(productNameExpr)
      .orderBy('COALESCE(SUM(inv.total_gross), 0)', 'DESC')
      .getRawMany<{ planId: string; planName: string; totalGross: string }>();

    return rows.map((row) => ({
      planId: row.planId,
      planName: row.planName,
      totalGross: parseFloat(String(row.totalGross)),
    }));
  }

  async sumByBuyerCountryInPeriod(from: Date, to: Date, userId?: string): Promise<TurnoverByCountryRow[]> {
    const countryExpr = `COALESCE(NULLIF(UPPER(TRIM(inv.buyer_country)), ''), 'UNKNOWN')`;
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

    const rows = await qb
      .select(countryExpr, 'countryCode')
      .addSelect('COALESCE(SUM(inv.total_gross), 0)', 'totalGross')
      .groupBy(countryExpr)
      .orderBy('COALESCE(SUM(inv.total_gross), 0)', 'DESC')
      .getRawMany<{ countryCode: string; totalGross: string }>();

    return rows.map((row) => ({
      countryCode: row.countryCode,
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

  async countBilledSubscriptionInvoicesByUserId(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.subscription_id IS NOT NULL')
      .andWhere('inv.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async hasAutoPaymentExhaustedByUserId(userId: string): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.auto_payment_status = :status', { status: AutoPaymentStatus.EXHAUSTED });

    applyUserTenantFilter(qb, 'user');

    return (await qb.getCount()) > 0;
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

  private async hydrateInvoicesBySearchIds(lookup: BillingSearchIdsLookup): Promise<InvoiceEntity[] | null> {
    if (!lookup) {
      return null;
    }

    // Empty OS hits → fall through to ILIKE (unindexed data / analyzer gaps).
    if (lookup.ids.length === 0) {
      return lookup.total === 0 ? null : [];
    }

    const found = await this.repository.find({
      where: { id: In(lookup.ids) },
      relations: ['subscription'],
    });
    const byId = new Map(found.map((item) => [item.id, item]));

    return lookup.ids.map((id) => byId.get(id)).filter((item): item is InvoiceEntity => item != null);
  }
}

/** @deprecated Use InvoicesRepository */
export { InvoicesRepository as InvoiceRefsRepository };
