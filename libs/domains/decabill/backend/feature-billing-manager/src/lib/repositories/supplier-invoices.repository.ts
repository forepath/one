import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BILLED_INVOICE_STATUSES, InvoiceStatus } from '../constants/invoice-status.constants';
import { SupplierInvoiceEntity } from '../entities/supplier-invoice.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class SupplierInvoicesRepository {
  constructor(
    @InjectRepository(SupplierInvoiceEntity)
    private readonly repository: Repository<SupplierInvoiceEntity>,
  ) {}

  private baseQb() {
    return this.repository
      .createQueryBuilder('invoice')
      .innerJoin('billing_supplier_profiles', 'supplier', 'supplier.id = invoice.supplier_id')
      .andWhere('supplier.tenant_id = :tenantId', { tenantId: getRequiredTenantId() });
  }

  async findByIdOrThrow(id: string): Promise<SupplierInvoiceEntity> {
    const entity = await this.repository
      .createQueryBuilder('invoice')
      .innerJoin('billing_supplier_profiles', 'supplierFilter', 'supplierFilter.id = invoice.supplier_id')
      .leftJoinAndSelect('invoice.lineItems', 'lineItems')
      .leftJoinAndSelect('invoice.contract', 'contract')
      .leftJoinAndSelect('invoice.supplier', 'supplier')
      .where('invoice.id = :id', { id })
      .andWhere('supplierFilter.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .orderBy('lineItems.position', 'ASC')
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Supplier invoice with ID ${id} not found`);
    }

    return entity;
  }

  async findAll(params: {
    limit: number;
    offset: number;
    search?: string;
    status?: InvoiceStatus;
    supplierId?: string;
  }): Promise<{ items: SupplierInvoiceEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('invoice')
      .innerJoin('billing_supplier_profiles', 'supplierFilter', 'supplierFilter.id = invoice.supplier_id')
      .leftJoinAndSelect('invoice.supplier', 'supplier')
      .leftJoinAndSelect('invoice.contract', 'contract')
      .andWhere('supplierFilter.tenant_id = :tenantId', { tenantId: getRequiredTenantId() });

    if (params.status) {
      qb.andWhere('invoice.status = :status', { status: params.status });
    }

    if (params.supplierId) {
      qb.andWhere('invoice.supplier_id = :supplierId', { supplierId: params.supplierId });
    }

    if (params.search?.trim()) {
      const term = `%${params.search.trim().toLowerCase()}%`;

      qb.andWhere(
        `(LOWER(COALESCE(invoice.invoice_number, '')) LIKE :term
          OR LOWER(invoice.id::text) LIKE :term
          OR LOWER(COALESCE(supplier.company, '')) LIKE :term
          OR LOWER(COALESCE(supplier.email, '')) LIKE :term
          OR LOWER(supplier.supplier_number) LIKE :term
          OR LOWER(COALESCE(contract.contract_number, '')) LIKE :term)`,
        { term },
      );
    }

    const total = await qb.getCount();
    const items = await qb.orderBy('invoice.createdAt', 'DESC').take(params.limit).skip(params.offset).getMany();

    return { items, total };
  }

  async countBySupplierId(supplierId: string): Promise<number> {
    return await this.repository.count({ where: { supplierId } });
  }

  async findIdByInvoiceNumber(invoiceNumber: string, excludeId?: string): Promise<string | null> {
    const qb = this.repository
      .createQueryBuilder('invoice')
      .innerJoin('billing_supplier_profiles', 'supplierFilter', 'supplierFilter.id = invoice.supplier_id')
      .select('invoice.id', 'id')
      .where('invoice.invoice_number = :invoiceNumber', { invoiceNumber })
      .andWhere('supplierFilter.tenant_id = :tenantId', { tenantId: getRequiredTenantId() });

    if (excludeId) {
      qb.andWhere('invoice.id != :excludeId', { excludeId });
    }

    const row = await qb.getRawOne<{ id: string }>();

    return row?.id ?? null;
  }

  async create(dto: Partial<SupplierInvoiceEntity>): Promise<SupplierInvoiceEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<SupplierInvoiceEntity>): Promise<SupplierInvoiceEntity> {
    await this.findByIdOrThrow(id);
    await this.repository.update(id, dto as never);

    return await this.findByIdOrThrow(id);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }

  async findIssuedInPeriod(from: Date, to: Date): Promise<SupplierInvoiceEntity[]> {
    return await this.repository
      .createQueryBuilder('invoice')
      .innerJoin('billing_supplier_profiles', 'supplierFilter', 'supplierFilter.id = invoice.supplier_id')
      .leftJoinAndSelect('invoice.lineItems', 'lineItems')
      .leftJoinAndSelect('invoice.supplier', 'supplier')
      .andWhere('supplierFilter.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere('invoice.status IN (:...statuses)', {
        // Voided invoices keep their original booking; the cancellation is exported in the void period.
        statuses: [
          InvoiceStatus.ISSUED,
          InvoiceStatus.PAID,
          InvoiceStatus.PARTIALLY_PAID,
          InvoiceStatus.OVERDUE,
          InvoiceStatus.VOID,
        ],
      })
      .andWhere('invoice.issue_date IS NOT NULL')
      .andWhere('invoice.issue_date >= :from', { from: from.toISOString().slice(0, 10) })
      .andWhere('invoice.issue_date <= :to', { to: to.toISOString().slice(0, 10) })
      .orderBy('lineItems.position', 'ASC')
      .getMany();
  }

  async findVoidedInPeriod(from: Date, to: Date): Promise<SupplierInvoiceEntity[]> {
    return await this.repository
      .createQueryBuilder('invoice')
      .innerJoin('billing_supplier_profiles', 'supplierFilter', 'supplierFilter.id = invoice.supplier_id')
      .leftJoinAndSelect('invoice.lineItems', 'lineItems')
      .leftJoinAndSelect('invoice.supplier', 'supplier')
      .andWhere('supplierFilter.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere('invoice.status = :status', { status: InvoiceStatus.VOID })
      .andWhere('invoice.voided_at IS NOT NULL')
      .andWhere('invoice.voided_at >= :from', { from })
      .andWhere('invoice.voided_at <= :to', { to })
      .orderBy('lineItems.position', 'ASC')
      .getMany();
  }

  async sumExpenseTotals(): Promise<{ totalGross: number; count: number }> {
    const tenantId = getRequiredTenantId();
    const rows = await this.repository.query(
      `
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(inv.total_gross), 0) AS total_gross
        FROM billing_supplier_invoices inv
        INNER JOIN billing_supplier_profiles sp ON sp.id = inv.supplier_id
        WHERE sp.tenant_id = $1
          AND inv.status <> 'draft'
      `,
      [tenantId],
    );

    return {
      count: Number(rows?.[0]?.count ?? 0),
      totalGross: Number(rows?.[0]?.total_gross ?? 0),
    };
  }

  async sumExpenseGrossByPeriod(
    from: Date,
    to: Date,
    groupBy: 'day' | 'month',
    supplierId?: string,
  ): Promise<{ period: string; totalGross: number }[]> {
    const qb = this.repository
      .createQueryBuilder('invoice')
      .innerJoin('billing_supplier_profiles', 'supplierFilter', 'supplierFilter.id = invoice.supplier_id')
      .andWhere('supplierFilter.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere('invoice.status IN (:...statuses)', { statuses: BILLED_INVOICE_STATUSES })
      .andWhere('invoice.issue_date IS NOT NULL')
      .andWhere('invoice.issue_date >= :from', { from: from.toISOString().slice(0, 10) })
      .andWhere('invoice.issue_date <= :to', { to: to.toISOString().slice(0, 10) });

    if (supplierId) {
      qb.andWhere('invoice.supplier_id = :supplierId', { supplierId });
    }

    // Format calendar issue_date in SQL so period keys never shift via JS/Date timezone conversion.
    const periodExpr =
      groupBy === 'month'
        ? `to_char(date_trunc('month', invoice.issue_date), 'YYYY-MM-01')`
        : `to_char(invoice.issue_date, 'YYYY-MM-DD')`;
    const rows = await qb
      .select(periodExpr, 'period')
      .addSelect('COALESCE(SUM(invoice.total_gross), 0)', 'totalGross')
      .groupBy(periodExpr)
      .orderBy(periodExpr, 'ASC')
      .getRawMany<{ period: string | Date; totalGross: string }>();

    return rows.map((row) => ({
      period: this.normalizeExpensePeriodKey(row.period),
      totalGross: parseFloat(String(row.totalGross)),
    }));
  }

  private normalizeExpensePeriodKey(period: string | Date): string {
    if (period instanceof Date) {
      return period.toISOString().slice(0, 10);
    }

    const raw = String(period).trim();
    const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);

    return dateOnly?.[1] ?? raw.slice(0, 10);
  }

  async summaryStats(): Promise<{
    openCount: number;
    openGross: number;
    paidCount: number;
    paidGross: number;
    draftCount: number;
  }> {
    const tenantId = getRequiredTenantId();
    const rows = await this.repository.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE inv.status IN ('issued', 'partially_paid', 'overdue'))::int AS open_count,
          COALESCE(SUM(inv.balance_due) FILTER (WHERE inv.status IN ('issued', 'partially_paid', 'overdue')), 0) AS open_gross,
          COUNT(*) FILTER (WHERE inv.status = 'paid')::int AS paid_count,
          COALESCE(SUM(inv.total_gross) FILTER (WHERE inv.status = 'paid'), 0) AS paid_gross,
          COUNT(*) FILTER (WHERE inv.status = 'draft')::int AS draft_count
        FROM billing_supplier_invoices inv
        INNER JOIN billing_supplier_profiles sp ON sp.id = inv.supplier_id
        WHERE sp.tenant_id = $1
      `,
      [tenantId],
    );
    const row = rows?.[0] ?? {};

    return {
      openCount: Number(row.open_count ?? 0),
      openGross: Number(row.open_gross ?? 0),
      paidCount: Number(row.paid_count ?? 0),
      paidGross: Number(row.paid_gross ?? 0),
      draftCount: Number(row.draft_count ?? 0),
    };
  }
}
