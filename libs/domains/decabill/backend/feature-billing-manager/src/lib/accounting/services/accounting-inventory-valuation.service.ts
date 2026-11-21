import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { InventoryMovementReason, InventoryMovementType } from '../../inventory/constants/inventory.constants';
import { InventoryArticleEntity } from '../../inventory/entities/inventory-article.entity';
import { InventoryMovementEntity } from '../../inventory/entities/inventory-movement.entity';
import type { BookMovementParams, InventoryValuationHook } from '../../inventory/services/inventory-movements.service';
import {
  AccountingAccountRole as R,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
} from '../constants/accounting.constants';
import { ACCOUNTING_POSTING_PORT, type AccountingPostingPort } from '../ports/accounting-posting.port';
import { toBookingDate } from '../utils/accounting-date.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingFxService } from './accounting-fx.service';
import type { PostEntryInput } from './accounting-journal.service';
import { AccountingPostingService } from './accounting-posting.service';

const INFLOW_REASONS: Array<InventoryMovementReason | string> = [
  InventoryMovementReason.RECEIPT,
  InventoryMovementReason.RETURN,
  InventoryMovementReason.CORRECTION,
  InventoryMovementReason.OTHER,
];

/**
 * Perpetual inventory at moving weighted average cost (HGB § 240(4) / § 256, IFRS IAS 2). Receipts set the average
 * from the supplier invoice line price (or an explicit / article purchase price); withdrawals leave at the current
 * average and are booked as cost of goods sold. Purchases themselves are booked to the inventory account by the
 * supplier invoice (lines referencing an article).
 */
@Injectable()
export class AccountingInventoryValuationService implements InventoryValuationHook, OnModuleInit {
  constructor(
    private readonly posting: AccountingPostingService,
    private readonly charts: AccountingChartService,
    private readonly fiscalYears: AccountingFiscalYearService,
    @Optional() @Inject(ACCOUNTING_POSTING_PORT) private readonly port?: AccountingPostingPort,
    @Optional() private readonly fx?: AccountingFxService,
  ) {}

  onModuleInit(): void {
    this.posting.inventoryHandler = (manager, movementId) => this.buildEntry(manager, movementId);
  }

  async onMovementBooked(
    manager: EntityManager,
    movement: InventoryMovementEntity,
    params: BookMovementParams,
  ): Promise<void> {
    const article = await manager
      .getRepository(InventoryArticleEntity)
      .findOneOrFail({ where: { id: movement.articleId } });
    const rows: Array<{ total: string }> = await manager.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM billing_inventory_stock WHERE article_id = $1`,
      [article.id],
    );
    const totalAfter = Number(rows[0]?.total ?? 0);
    const quantity = Number(movement.quantity);
    const average = article.averageCost != null ? Number(article.averageCost) : Number(article.purchasePriceNet ?? 0);
    let unitCost = average;

    if (movement.type === InventoryMovementType.PUTAWAY && INFLOW_REASONS.includes(movement.reason ?? '')) {
      unitCost =
        params.unitCost ??
        (params.supplierInvoiceId
          ? await this.invoiceLinePrice(manager, params.supplierInvoiceId, article.id)
          : null) ??
        (movement.reason === InventoryMovementReason.RETURN ? average : Number(article.purchasePriceNet ?? average));

      const totalBefore = Math.max(0, totalAfter - quantity);
      const newAverage = totalAfter > 0 ? (totalBefore * average + quantity * unitCost) / totalAfter : unitCost;

      await manager
        .getRepository(InventoryArticleEntity)
        .update(article.id, { averageCost: Math.round(newAverage * 10000) / 10000 });
    }

    await manager.getRepository(InventoryMovementEntity).update(movement.id, {
      unitCost: Math.round(unitCost * 10000) / 10000,
      totalCost: Math.round(unitCost * quantity * 100) / 100,
      supplierInvoiceId: params.supplierInvoiceId ?? null,
    });

    await this.port?.onInventoryMovementBooked(manager, movement.id);
  }

  /** COGS / inventory bookings of a valued movement (null = nothing to book). */
  private async buildEntry(manager: EntityManager, movementId: string): Promise<PostEntryInput | null> {
    const movement = await manager.getRepository(InventoryMovementEntity).findOneOrFail({ where: { id: movementId } });
    const total = Number(movement.totalCost ?? 0);

    if (Math.round(total * 100) === 0) {
      return null;
    }

    let direction: 1 | -1 | 0 = 0;

    if (movement.type === InventoryMovementType.WITHDRAWAL) {
      direction = -1;
    } else if (
      movement.type === InventoryMovementType.PUTAWAY &&
      // Returns, corrections and other non-purchase inflows (found or initial stock) raise the stock value; receipts are
      // capitalized by their supplier invoice.
      (movement.reason === InventoryMovementReason.RETURN ||
        movement.reason === InventoryMovementReason.CORRECTION ||
        movement.reason === InventoryMovementReason.OTHER)
    ) {
      direction = 1;
    }

    // Receipts are capitalized by the supplier invoice; transfers and lendings stay in stock.
    if (direction === 0) {
      return null;
    }

    const date = toBookingDate(movement.createdAt);
    const chartId = (await this.fiscalYears.resolvePostingTarget(date, manager)).fiscalYear.chartId;
    const inventory = (await this.charts.requireAccountByRole(chartId, R.INVENTORY, manager)).id;
    const cogs = (await this.charts.requireAccountByRole(chartId, R.COST_OF_GOODS_SOLD, manager)).id;
    const amount = Math.round(total * 100) / 100;

    return {
      documentDate: date,
      documentNumber: movement.documentNumber,
      description:
        `${direction < 0 ? 'Stock withdrawal' : 'Stock return'} ${movement.documentNumber} (${movement.snapshot?.article?.name ?? ''})`.slice(
          0,
          255,
        ),
      kind: JournalEntryKind.AUTOMATIC,
      sourceType: JournalSourceType.INVENTORY_MOVEMENT,
      sourceId: movement.id,
      sourceEvent: 'booked',
      tenantId: movement.tenantId,
      lines:
        direction < 0
          ? [
              { accountId: cogs, debit: amount, tenantId: movement.tenantId },
              { accountId: inventory, credit: amount, tenantId: movement.tenantId },
            ]
          : [
              { accountId: inventory, debit: amount, tenantId: movement.tenantId },
              { accountId: cogs, credit: amount, tenantId: movement.tenantId },
            ],
      links: [{ linkType: JournalLinkType.INVENTORY_MOVEMENT, targetId: movement.id, role: JournalLinkRole.SOURCE }],
    };
  }

  private async invoiceLinePrice(
    manager: EntityManager,
    supplierInvoiceId: string,
    articleId: string,
  ): Promise<number | null> {
    const rows: Array<{ price: string; currency: string; issue_date: string | null; issued_at: Date | null }> =
      await manager.query(
        `SELECT li.unit_price_net AS price, si.currency, si.issue_date::text AS issue_date, si.issued_at
         FROM billing_supplier_invoice_line_items li JOIN billing_supplier_invoices si ON si.id = li.invoice_id
         WHERE li.invoice_id = $1 AND li.inventory_article_id = $2 ORDER BY li.position LIMIT 1`,
        [supplierInvoiceId, articleId],
      );

    if (!rows[0]) {
      return null;
    }

    const price = Number(rows[0].price);

    if (!this.fx) {
      return price;
    }

    // Unit cost in the functional currency at the invoice's rate (the inventory debit of the invoice uses it too).
    const { rate } = await this.fx.convert(
      1,
      rows[0].currency,
      rows[0].issue_date ?? toBookingDate(rows[0].issued_at ?? new Date()),
      manager,
    );

    return rate === 1 ? price : Math.round((price / rate) * 10000) / 10000;
  }
}
