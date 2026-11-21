import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { SettlementDocumentType, SettlementType } from '../../constants/settlement.constants';
import { DocumentSettlementEntity } from '../../entities/document-settlement.entity';
import { PaymentProcessorFactory } from '../../payment-processors/payment-processor.factory';
import type { ProcessorBalanceTransaction } from '../../payment-processors/payment-processor.interface';
import { AccountingAccountRole as R } from '../constants/accounting.constants';
import { AccountingBankImportEntity } from '../entities/accounting-bank-import.entity';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';
import { toBookingDate } from '../utils/accounting-date.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingReconciliationService } from './accounting-reconciliation.service';

const MAX_PAGES_PER_RUN = 20;

/** `syncCursor` is `<ms>` or, while a backlog is being paged, `<ms>|<resumeAfterId>|<newestSeenMs>`. */
export function parseSyncCursor(
  raw: string | null | undefined,
  startDate: string,
): { cursorMs: number; resumeAfter: string | null; pendingNewestMs: number | null } {
  const fallback = new Date(`${startDate}T00:00:00Z`).getTime();
  const [ms, resumeAfter, newest] = (raw ?? '').split('|');
  const cursorMs = Number(ms);

  return {
    cursorMs: Number.isFinite(cursorMs) && cursorMs > 0 ? cursorMs : fallback,
    resumeAfter: resumeAfter || null,
    pendingNewestMs: newest && Number.isFinite(Number(newest)) ? Number(newest) : null,
  };
}

/**
 * Automatic processor accounting for processors with a balance API (Stripe): charges, fees, refunds and payouts
 * land on the processor's financial (clearing) account. Charges/refunds already settled by webhooks are only
 * marked as reconciled; fees are booked to payment fees; payouts move to cash in transit, where the bank's payout
 * line clears them.
 */
@Injectable()
export class AccountingProcessorSyncService {
  private readonly logger = new Logger(AccountingProcessorSyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly processors: PaymentProcessorFactory,
    private readonly reconciliation: AccountingReconciliationService,
    private readonly charts: AccountingChartService,
    private readonly fiscalYears: AccountingFiscalYearService,
  ) {}

  async syncAll(): Promise<Array<{ accountId: string; imported: number; error?: string }>> {
    if (!this.config.isEnabled()) {
      return [];
    }

    const accounts = await this.dataSource
      .getRepository(AccountingFinancialAccountEntity)
      .find({ where: { kind: 'processor', isActive: true } });
    const results: Array<{ accountId: string; imported: number; error?: string }> = [];

    for (const account of accounts) {
      try {
        results.push({ accountId: account.id, imported: await this.syncAccount(account) });
      } catch (error) {
        const message = (error as Error).message;

        this.logger.warn(`Processor sync for ${account.name} failed: ${message}`);
        results.push({ accountId: account.id, imported: 0, error: message });
      }
    }

    return results;
  }

  async syncAccount(account: AccountingFinancialAccountEntity): Promise<number> {
    if (!account.processor) {
      return 0;
    }

    let processor;

    try {
      processor = this.processors.getProcessor(account.processor);
    } catch {
      return 0;
    }

    if (!processor.listBalanceTransactions) {
      return 0;
    }

    const state = parseSyncCursor(account.syncCursor, this.config.getConfig().startDate);
    // One second of overlap: the API filters by whole seconds; re-listed movements are skipped by the dedupe key.
    const createdAfter = new Date(state.cursorMs - 1000);
    const items: ProcessorBalanceTransaction[] = [];
    let startingAfter = state.resumeAfter ?? undefined;
    let truncated = false;
    let newestMs = state.pendingNewestMs ?? 0;

    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES_PER_RUN) {
        truncated = true;
        break;
      }

      const result = await processor.listBalanceTransactions({ createdAfter, startingAfter, limit: 100 });

      for (const item of result.items) {
        newestMs = Math.max(newestMs, item.created.getTime());
      }

      items.push(...result.items.filter((i) => i.currency === account.currency));

      if (!result.hasMore || result.items.length === 0) {
        break;
      }

      startingAfter = result.items[result.items.length - 1].id;
    }

    // Newest first: when the page budget runs out, older movements are still pending. Keep the old cursor and resume
    // paging after the oldest movement seen; the cursor only moves forward once the backlog is fully listed.
    const nextCursor = truncated
      ? `${state.cursorMs}|${startingAfter ?? ''}|${newestMs}`
      : String(Math.max(state.cursorMs, newestMs));

    if (items.length === 0) {
      await this.dataSource
        .getRepository(AccountingFinancialAccountEntity)
        .update(account.id, { syncCursor: nextCursor, lastSyncedAt: new Date() });

      return 0;
    }

    items.sort((a, b) => a.created.getTime() - b.created.getTime());

    const importRecord = await this.dataSource.getRepository(AccountingBankImportEntity).save(
      this.dataSource.getRepository(AccountingBankImportEntity).create({
        tenantId: account.tenantId ?? null,
        financialAccountId: account.id,
        fileName: `${account.processor} API sync ${new Date().toISOString()}`,
        fileSha256: createHash('sha256')
          .update(items.map((i) => i.id).join(','))
          .digest('hex'),
        fileSize: 0,
        format: `api:${account.processor}`,
        status: 'processing',
      }),
    );
    const inserted: Array<{ id: string; item: ProcessorBalanceTransaction; part: 'gross' | 'fee' }> = [];

    for (const item of items) {
      // Gross movement and fee as separate lines so each is reconciled on its own.
      for (const part of ['gross', 'fee'] as const) {
        const amount = part === 'gross' ? item.amount : -item.fee;

        if (Math.round(amount * 100) === 0) {
          continue;
        }

        const rows: Array<{ id: string }> = await this.dataSource.query(
          `INSERT INTO billing_accounting_bank_transactions
             (financial_account_id, import_id, tenant_id, status, booking_date, value_date, amount, currency,
              booking_text, bank_reference, details, locator, dedupe_key, dedupe_ordinal, remittance, source_format)
           VALUES ($1,$2,$3,'booked',$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,'api')
           ON CONFLICT (financial_account_id, dedupe_key, dedupe_ordinal) DO NOTHING RETURNING id`,
          [
            account.id,
            importRecord.id,
            account.tenantId ?? null,
            toBookingDate(item.created),
            item.availableOn ? toBookingDate(item.availableOn) : null,
            amount.toFixed(2),
            account.currency,
            `${item.type}${part === 'fee' ? ' fee' : ''}`.slice(0, 255),
            `${item.id}${part === 'fee' ? ':fee' : ''}`,
            JSON.stringify([
              {
                processor: {
                  provider: account.processor,
                  chargeId: item.sourceId,
                  payoutId: item.payoutId,
                  gross: item.amount.toFixed(2),
                  fee: item.fee.toFixed(2),
                  net: item.net.toFixed(2),
                  merchantReference: item.invoiceId,
                  category: item.reportingCategory,
                },
              },
            ]),
            `api:${item.id}:${part}`,
            createHash('sha256').update(`${account.id}|api|${item.id}|${part}`).digest('hex'),
            item.description?.slice(0, 500) ?? null,
          ],
        );

        if (rows[0]) {
          inserted.push({ id: rows[0].id, item, part });
        }
      }
    }

    await this.dataSource.getRepository(AccountingFinancialAccountEntity).update(account.id, {
      syncCursor: nextCursor,
      lastSyncedAt: new Date(),
    });

    let matched = 0;

    try {
      for (const row of inserted) {
        if (await this.reconcile(account, row.id, row.item, row.part)) {
          matched += 1;
        }
      }
    } finally {
      // Rows are stored either way; unreconciled ones stay open in the banking inbox.
      await this.dataSource.getRepository(AccountingBankImportEntity).update(importRecord.id, {
        status: 'completed',
        transactionCount: inserted.length,
        matchedCount: matched,
        completedAt: new Date(),
      });
    }

    return inserted.length;
  }

  private async reconcile(
    account: AccountingFinancialAccountEntity,
    txId: string,
    item: ProcessorBalanceTransaction,
    part: 'gross' | 'fee',
  ): Promise<boolean> {
    // The same date the reconciliation books on (value date = available on, else the booking date): the account
    // roles must come from that fiscal year's chart.
    const date = toBookingDate(item.availableOn ?? item.created);

    try {
      const chartId = (await this.fiscalYears.resolvePostingTarget(date, this.dataSource.manager)).fiscalYear.chartId;

      if (part === 'fee' || item.type === 'stripe_fee' || item.type === 'application_fee') {
        const fees = await this.charts.requireAccountByRole(chartId, R.PAYMENT_FEES);

        await this.reconciliation.apply(
          txId,
          [
            {
              type: 'account',
              accountNumber: fees.number,
              amount: part === 'fee' ? -item.fee : item.amount,
              description: 'Processor fee',
            },
          ],
          null,
        );

        return true;
      }

      if (item.type === 'payout') {
        const transit = await this.charts.requireAccountByRole(chartId, R.CASH_IN_TRANSIT);

        await this.reconciliation.apply(
          txId,
          [{ type: 'account', accountNumber: transit.number, amount: item.amount, description: 'Processor payout' }],
          null,
        );

        return true;
      }

      if (['charge', 'payment', 'refund', 'payment_refund'].includes(item.type)) {
        // Already settled through the webhook / auto charge → only mark reconciled (no second booking).
        // A refund carries the original payment intent, so the settlement type must follow the movement's direction.
        const types =
          item.amount < 0 ? [SettlementType.REFUND, SettlementType.PAYMENT_REVERSAL] : [SettlementType.PAYMENT];
        const refs = (
          item.amount < 0 ? [item.sourceId, item.paymentIntentId] : [item.paymentIntentId, item.sourceId]
        ).filter((r): r is string => Boolean(r));
        const existing = refs.length
          ? await this.dataSource.getRepository(DocumentSettlementEntity).findOne({
              where: refs.map((externalId) => ({
                documentType: SettlementDocumentType.INVOICE,
                externalId,
                type: In(types),
              })),
            })
          : null;

        if (existing) {
          await this.dataSource
            .getRepository(AccountingBankTransactionEntity)
            .update(txId, { matchStatus: 'matched', matchedAt: new Date() });

          return true;
        }

        if (item.invoiceId && item.amount > 0) {
          await this.reconciliation.apply(txId, [{ type: 'invoice', id: item.invoiceId, amount: item.amount }], null);

          return true;
        }
      }
    } catch (error) {
      this.logger.warn(`Could not reconcile processor movement ${item.id}: ${(error as Error).message}`);
    }

    await this.reconciliation.suggestAndAutoMatch([txId]);

    return false;
  }
}
