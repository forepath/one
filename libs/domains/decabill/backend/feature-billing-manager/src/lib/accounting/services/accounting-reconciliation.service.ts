import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { SettlementDocumentType, SettlementSource, SettlementType } from '../../constants/settlement.constants';
import { DocumentSettlementEntity } from '../../entities/document-settlement.entity';
import { DocumentSettlementService } from '../../services/document-settlement.service';
import {
  CounterpartyType,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
} from '../constants/accounting.constants';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingMatchRuleEntity } from '../entities/accounting-match-rule.entity';
import { fromCents, toCents } from '../utils/accounting-money.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingJournalService } from './accounting-journal.service';

export type MatchTarget =
  /** `number`: the document number, for display (suggestions); matching goes by `id`. */
  | { type: 'invoice' | 'supplier_invoice'; id: string; amount: number; number?: string | null }
  | { type: 'account'; accountNumber: string; amount: number; taxCode?: string | null; description?: string | null };

export interface MatchSuggestion {
  targets: MatchTarget[];
  score: number;
  reasons: string[];
  label?: string;
}

interface OpenDoc {
  id: string;
  number: string | null;
  balance: number;
  party: string;
  reference: string | null;
  currency: string;
  name: string | null;
}

/**
 * Bank reconciliation: suggests and applies matches of imported transactions to open customer / supplier invoices
 * (settlements) or books them directly against an account (fees, payouts, transfers). Confirmed matches can be
 * learned as IBAN / text rules.
 */
@Injectable()
export class AccountingReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly settlements: DocumentSettlementService,
    private readonly journal: AccountingJournalService,
    private readonly charts: AccountingChartService,
    private readonly fiscalYears: AccountingFiscalYearService,
  ) {}

  /** Computes suggestions for unmatched transactions and applies unique high-confidence ones. */
  async suggestAndAutoMatch(transactionIds: string[]): Promise<{ suggested: number; matched: number }> {
    let suggested = 0;
    let matched = 0;
    const threshold = this.config.getConfig().autoMatchThreshold;

    for (const id of transactionIds) {
      const tx = await this.dataSource.getRepository(AccountingBankTransactionEntity).findOne({ where: { id } });

      if (!tx || tx.status !== 'booked' || !['unmatched', 'suggested'].includes(tx.matchStatus)) {
        continue;
      }

      const suggestions = await this.suggest(tx);
      const best = suggestions[0];

      if (!best) {
        continue;
      }

      const unique = suggestions.length === 1 || suggestions[1].score < best.score - 0.1;

      if (best.score >= threshold && unique) {
        try {
          await this.apply(tx.id, best.targets, null, { learn: false });
          matched += 1;
          continue;
        } catch {
          // Fall through to a suggestion (e.g. the document changed meanwhile).
        }
      }

      await this.dataSource
        .getRepository(AccountingBankTransactionEntity)
        .update(tx.id, { matchStatus: 'suggested', suggestion: { ...best } as unknown as Record<string, unknown> });
      suggested += 1;
    }

    return { suggested, matched };
  }

  async suggest(tx: AccountingBankTransactionEntity): Promise<MatchSuggestion[]> {
    const amount = Number(tx.amount);
    const incoming = amount > 0;
    const abs = Math.abs(amount);
    const text = `${tx.remittance ?? ''} ${tx.endToEndId ?? ''} ${tx.bookingText ?? ''}`.toUpperCase();
    // A reference counts only as a whole token ("INV-2026-1" must not hit inside "INV-2026-10"); separators the payer
    // may have inserted or dropped between its characters are tolerated.
    const containsToken = (needle: string): boolean => {
      const pattern = needle
        .split('')
        .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s./_-]*');

      return new RegExp(`(?<![A-Z0-9])${pattern}(?![A-Z0-9])`).test(text);
    };
    const out: MatchSuggestion[] = [];
    const docs = incoming
      ? await this.openCustomerDocs(tx.currency, tx.tenantId ?? null)
      : await this.openSupplierDocs(tx.currency, tx.tenantId ?? null);
    const docType: 'invoice' | 'supplier_invoice' = incoming ? 'invoice' : 'supplier_invoice';
    // 1) Structured creditor reference / end-to-end id = our RF reference or invoice number.
    const ref = (tx.structuredReference ?? '').toUpperCase();

    for (const doc of docs) {
      const reasons: string[] = [];
      let score = 0;
      const number = (doc.number ?? '').toUpperCase().replace(/[\s./_-]/g, '');

      if (doc.reference && ref && doc.reference === ref) {
        score = 1;
        reasons.push('structured payment reference');
      } else if (doc.reference && containsToken(doc.reference)) {
        score = 0.98;
        reasons.push('payment reference in remittance');
      } else if (number && number.length >= 5 && containsToken(number)) {
        score = 0.9;
        reasons.push('invoice number in remittance');
      }

      if (score > 0) {
        const exact = toCents(doc.balance) === toCents(abs);

        if (!exact) {
          score -= 0.15;
          reasons.push(`amount differs (${doc.balance.toFixed(2)} open)`);
        } else {
          reasons.push('exact amount');
        }

        out.push({
          targets: [{ type: docType, id: doc.id, number: doc.number ?? null, amount: abs }],
          score,
          reasons,
          label: doc.number ?? doc.id,
        });
      }
    }

    // 2) Learned rules (IBAN → party / account, text → account).
    const rules = await this.matchingRules(tx);

    for (const rule of rules) {
      if (rule.targetType === 'account') {
        out.push({
          targets: [{ type: 'account', accountNumber: rule.targetId, amount, taxCode: rule.taxCode ?? null }],
          score: 0.92,
          reasons: [`rule: ${rule.kind} ${rule.pattern}`],
          label: `Account ${rule.targetId}`,
        });
        continue;
      }

      const partyDocs = docs.filter((d) => d.party === rule.targetId);
      const exact = partyDocs.filter((d) => toCents(d.balance) === toCents(abs));

      if (exact.length === 1) {
        out.push({
          targets: [{ type: docType, id: exact[0].id, number: exact[0].number ?? null, amount: abs }],
          score: 0.88,
          reasons: [`rule: ${rule.kind} ${rule.pattern}`, 'exact amount'],
          label: exact[0].number ?? exact[0].id,
        });
      } else if (partyDocs.length > 1 && partyDocs.length <= 8) {
        const combo = this.subsetSum(partyDocs, abs);

        if (combo) {
          out.push({
            targets: combo.map((d) => ({ type: docType, id: d.id, number: d.number ?? null, amount: d.balance })),
            score: 0.85,
            reasons: [`rule: ${rule.kind} ${rule.pattern}`, `${combo.length} invoices sum to the amount`],
            label: combo.map((d) => d.number).join(', '),
          });
        }
      }
    }

    // 3) Unique exact amount with matching counterparty name.
    if (out.length === 0 && tx.counterpartyName) {
      const name = this.normalizeName(tx.counterpartyName);
      const candidates = docs.filter(
        (d) =>
          toCents(d.balance) === toCents(abs) && d.name && this.nameSimilarity(name, this.normalizeName(d.name)) >= 0.8,
      );

      if (candidates.length === 1) {
        out.push({
          targets: [{ type: docType, id: candidates[0].id, number: candidates[0].number ?? null, amount: abs }],
          score: 0.75,
          reasons: ['exact amount', 'counterparty name'],
          label: candidates[0].number ?? candidates[0].id,
        });
      }
    }

    // 4) Processor payouts arriving on the bank account → cash in transit / processor clearing.
    if (incoming && /STRIPE|PAYPAL|MOLLIE|ADYEN/.test(text)) {
      const clearing = await this.processorLedgerNumber(text);

      if (clearing) {
        out.push({
          targets: [{ type: 'account', accountNumber: clearing, amount, description: 'Processor payout' }],
          score: 0.8,
          reasons: ['payment processor payout'],
          label: `Payout → ${clearing}`,
        });
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /** Applies a match: settlements for documents, a direct journal entry for account targets. */
  async apply(
    transactionId: string,
    targets: MatchTarget[],
    userId: string | null,
    options: { learn?: boolean } = {},
  ): Promise<AccountingBankTransactionEntity> {
    if (targets.length === 0 || targets.length > 50) {
      throw new BadRequestException('Provide 1–50 match targets');
    }

    await this.dataSource.transaction(async (manager) => {
      const tx = await manager
        .getRepository(AccountingBankTransactionEntity)
        .createQueryBuilder('t')
        .where('t.id = :id', { id: transactionId })
        .setLock('pessimistic_write')
        .getOne();

      if (!tx) {
        throw new NotFoundException('Bank transaction not found');
      }

      if (['matched', 'booked'].includes(tx.matchStatus)) {
        throw new BadRequestException('Transaction is already reconciled');
      }

      if (tx.matchStatus === 'superseded') {
        throw new BadRequestException('This line was replaced by or duplicates another bank line; reconcile that one');
      }

      if (tx.status !== 'booked') {
        throw new BadRequestException('Pending transactions cannot be reconciled');
      }

      const amount = Number(tx.amount);
      const totalCents = targets.reduce((s, t) => s + toCents(Math.abs(t.amount)), 0);

      if (totalCents !== toCents(Math.abs(amount))) {
        throw new BadRequestException(
          `Match amounts (${fromCents(totalCents)}) must equal the transaction amount (${Math.abs(amount).toFixed(2)})`,
        );
      }

      const account = await manager
        .getRepository(AccountingFinancialAccountEntity)
        .findOneOrFail({ where: { id: tx.financialAccountId } });
      const date = tx.valueDate ?? tx.bookingDate;
      const directTargets = targets.filter((t): t is Extract<MatchTarget, { type: 'account' }> => t.type === 'account');
      // A line can be matched, unmatched and matched again: every cycle gets its own idempotency keys, otherwise the
      // settlement / journal services would hand back the records the unmatch already reversed.
      const previous = await manager
        .getRepository(DocumentSettlementEntity)
        .find({ where: { bankTransactionId: tx.id } });
      const cycleSuffix = (n: number) => (n === 0 ? '' : `:${n + 1}`);

      for (const target of targets) {
        if (target.type === 'account') {
          continue;
        }

        await this.assertDocumentTenant(manager, target.type, target.id, tx.tenantId ?? null);
        await this.settlements.apply(
          {
            documentType:
              target.type === 'invoice' ? SettlementDocumentType.INVOICE : SettlementDocumentType.SUPPLIER_INVOICE,
            documentId: target.id,
            type: this.settlementTypeFor(target.type, amount),
            amount: Math.abs(target.amount),
            currency: tx.currency,
            occurredAt: new Date(`${date}T12:00:00Z`),
            source: SettlementSource.BANK_MATCH,
            sourceRef: `bank:${tx.id}:${target.id}${cycleSuffix(
              previous.filter((p) => !p.reversesSettlementId && p.documentId === target.id).length,
            )}`,
            bankTransactionId: tx.id,
            externalId: tx.bankReference ?? tx.endToEndId ?? null,
            createdByUserId: userId,
          },
          manager,
        );
      }

      let journalEntryId: string | null = null;

      if (directTargets.length > 0 && this.config.isEnabled()) {
        const target = await this.fiscalYears.resolvePostingTarget(date, manager);
        const chartId = target.fiscalYear.chartId;
        const bankAccount = await this.charts.findAccountByNumber(chartId, account.ledgerAccountNumber, manager);

        if (!bankAccount) {
          throw new BadRequestException(
            `Ledger account ${account.ledgerAccountNumber} of the financial account is missing`,
          );
        }

        const lines = [];
        const sign = amount > 0 ? 1 : -1;
        // Only the account targets: document targets reach the bank account through their settlement postings.
        const directTotal = fromCents(directTargets.reduce((sum, t) => sum + toCents(Math.abs(t.amount)), 0));

        lines.push({
          accountId: bankAccount.id,
          ...(sign > 0 ? { debit: directTotal } : { credit: directTotal }),
          tenantId: tx.tenantId,
        });

        for (const t of directTargets) {
          const counter = await this.charts.findAccountByNumber(chartId, t.accountNumber, manager);

          if (!counter || !counter.isActive) {
            throw new BadRequestException(`Account ${t.accountNumber} does not exist or is inactive`);
          }

          const taxCode = t.taxCode ? await this.charts.findTaxCode(chartId, t.taxCode, manager) : null;
          const gross = Math.abs(t.amount);
          const rate = taxCode?.rate != null ? Number(taxCode.rate) : 0;
          const tax = taxCode?.accountId && rate > 0 ? Math.round(((gross * rate) / (100 + rate)) * 100) / 100 : 0;

          lines.push({
            accountId: counter.id,
            ...(sign > 0 ? { credit: gross - tax } : { debit: gross - tax }),
            taxCodeId: taxCode?.id ?? null,
            taxRate: taxCode ? rate : null,
            taxRole: taxCode ? ('base' as const) : null,
            description: t.description ?? null,
            tenantId: tx.tenantId,
          });

          if (tax > 0 && taxCode?.accountId) {
            lines.push({
              accountId: taxCode.accountId,
              ...(sign > 0 ? { credit: tax } : { debit: tax }),
              taxCodeId: taxCode.id,
              taxRate: rate,
              taxRole: 'tax' as const,
              tenantId: tx.tenantId,
            });
          }
        }

        const directKey = `bank_transaction:${tx.id}:direct`;
        const directCycles = await manager
          .getRepository(AccountingJournalEntryEntity)
          .createQueryBuilder('e')
          .where('e.idempotency_key = :key OR e.idempotency_key LIKE :prefix', {
            key: directKey,
            prefix: `${directKey}:%`,
          })
          .getCount();
        const result = await this.journal.post(
          {
            documentDate: date,
            documentNumber: (tx.bankReference ?? tx.endToEndId ?? '').slice(0, 64) || null,
            description: (tx.remittance ?? tx.bookingText ?? tx.counterpartyName ?? 'Bank transaction').slice(0, 255),
            kind: JournalEntryKind.AUTOMATIC,
            sourceType: JournalSourceType.BANK_TRANSACTION,
            sourceId: tx.id,
            sourceEvent: 'direct',
            idempotencyKey: `${directKey}${cycleSuffix(directCycles)}`,
            tenantId: tx.tenantId,
            currency: tx.currency,
            createdByUserId: userId,
            lines,
            links: [{ linkType: JournalLinkType.BANK_TRANSACTION, targetId: tx.id, role: JournalLinkRole.SOURCE }],
          },
          manager,
        );

        journalEntryId = result.entry.id;
      }

      await manager.getRepository(AccountingBankTransactionEntity).update(tx.id, {
        matchStatus: directTargets.length === targets.length ? 'booked' : 'matched',
        journalEntryId,
        matchedAt: new Date(),
        matchedByUserId: userId,
        suggestion: null,
      });

      if (options.learn && tx.counterpartyIban) {
        await this.learnRule(manager, tx, targets, userId);
      }
    });

    return await this.dataSource
      .getRepository(AccountingBankTransactionEntity)
      .findOneOrFail({ where: { id: transactionId } });
  }

  /** Undoes a reconciliation: payments are reversed (settlement reversal), direct bookings reversed in the journal. */
  async unmatch(transactionId: string, userId: string | null): Promise<AccountingBankTransactionEntity> {
    await this.dataSource.transaction(async (manager) => {
      const tx = await manager
        .getRepository(AccountingBankTransactionEntity)
        .findOneOrFail({ where: { id: transactionId } });

      if (tx.matchStatus === 'superseded') {
        throw new BadRequestException('This line was replaced by or duplicates another bank line');
      }

      const linked = await manager
        .getRepository(DocumentSettlementEntity)
        .find({ where: { bankTransactionId: tx.id } });

      for (const s of linked.filter((x) => !x.reversesSettlementId)) {
        const reversalType =
          s.type === SettlementType.PAYMENT
            ? SettlementType.PAYMENT_REVERSAL
            : s.type === SettlementType.REFUND
              ? SettlementType.PAYMENT
              : null;

        if (!reversalType) {
          continue;
        }

        await this.settlements.apply(
          {
            documentType: s.documentType,
            documentId: s.documentId,
            type: reversalType,
            amount: Number(s.amount),
            currency: s.currency,
            occurredAt: new Date(),
            source: SettlementSource.BANK_MATCH,
            sourceRef: `unmatch:${s.id}`,
            reversesSettlementId: s.id,
            note: 'Bank reconciliation undone',
            createdByUserId: userId,
          },
          manager,
        );
      }

      if (tx.journalEntryId) {
        await this.journal.reverse(
          tx.journalEntryId,
          { reason: 'Bank reconciliation undone', createdByUserId: userId },
          manager,
        );
      }

      await manager.getRepository(AccountingBankTransactionEntity).update(tx.id, {
        matchStatus: 'unmatched',
        journalEntryId: null,
        matchedAt: null,
        matchedByUserId: null,
      });
    });

    return await this.dataSource
      .getRepository(AccountingBankTransactionEntity)
      .findOneOrFail({ where: { id: transactionId } });
  }

  async ignore(transactionId: string, userId: string | null): Promise<void> {
    const tx = await this.dataSource
      .getRepository(AccountingBankTransactionEntity)
      .findOne({ where: { id: transactionId } });

    if (!tx) {
      throw new NotFoundException('Bank transaction not found');
    }

    if (['matched', 'booked'].includes(tx.matchStatus)) {
      throw new BadRequestException('Undo the reconciliation first');
    }

    if (tx.matchStatus === 'superseded') {
      throw new BadRequestException('This line was replaced by or duplicates another bank line');
    }

    await this.dataSource
      .getRepository(AccountingBankTransactionEntity)
      .update(transactionId, { matchStatus: 'ignored', matchedByUserId: userId, matchedAt: new Date() });
  }

  /** A rule must point at something that exists (an active ledger account, a customer or a supplier). */
  private async assertRuleTarget(targetType: 'customer' | 'supplier' | 'account', targetId: string): Promise<void> {
    const sql = {
      account: `SELECT 1 FROM billing_accounting_accounts WHERE number = $1 AND is_active LIMIT 1`,
      customer: `SELECT 1 FROM users WHERE id::text = $1 LIMIT 1`,
      supplier: `SELECT 1 FROM billing_supplier_profiles WHERE id::text = $1 LIMIT 1`,
    }[targetType];
    const rows: unknown[] = await this.dataSource.query(sql, [targetId]);

    if (rows.length === 0) {
      throw new BadRequestException(`Unknown ${targetType} ${targetId} for the rule`);
    }
  }

  async listRules(): Promise<AccountingMatchRuleEntity[]> {
    return await this.dataSource.getRepository(AccountingMatchRuleEntity).find({ order: { createdAt: 'DESC' } });
  }

  async deleteRule(id: string): Promise<void> {
    await this.dataSource.getRepository(AccountingMatchRuleEntity).delete(id);
  }

  async createRule(
    input: {
      kind: 'iban' | 'text';
      pattern: string;
      targetType: 'customer' | 'supplier' | 'account';
      targetId: string;
      taxCode?: string | null;
    },
    userId: string | null,
  ): Promise<AccountingMatchRuleEntity> {
    const pattern =
      input.kind === 'iban' ? input.pattern.replace(/\s/g, '').toUpperCase() : input.pattern.trim().toUpperCase();

    if (pattern.length < 3 || pattern.length > 128) {
      throw new BadRequestException('Rule pattern must be 3–128 characters');
    }

    await this.assertRuleTarget(input.targetType, input.targetId);

    const repo = this.dataSource.getRepository(AccountingMatchRuleEntity);
    const existing = await repo.findOne({ where: { kind: input.kind, pattern } });

    if (existing) {
      await repo.update(existing.id, {
        targetType: input.targetType,
        targetId: input.targetId,
        taxCode: input.taxCode ?? null,
      });

      return (await repo.findOne({ where: { id: existing.id } }))!;
    }

    return await repo.save(
      repo.create({
        kind: input.kind,
        pattern,
        targetType: input.targetType,
        targetId: input.targetId,
        taxCode: input.taxCode ?? null,
        createdByUserId: userId,
      }),
    );
  }

  /** A tenant-owned bank account may only settle documents of the same tenant. */
  private async assertDocumentTenant(
    manager: EntityManager,
    type: 'invoice' | 'supplier_invoice',
    id: string,
    tenantId: string | null,
  ): Promise<void> {
    const rows: Array<{ tenant_id: string }> =
      type === 'invoice'
        ? await manager.query(
            `SELECT u.tenant_id FROM billing_invoices i JOIN users u ON u.id = i.user_id WHERE i.id = $1`,
            [id],
          )
        : await manager.query(
            `SELECT p.tenant_id FROM billing_supplier_invoices s JOIN billing_supplier_profiles p ON p.id = s.supplier_id WHERE s.id = $1`,
            [id],
          );

    if (!rows[0]) {
      throw new NotFoundException('Document not found');
    }

    if (tenantId !== null && rows[0].tenant_id !== tenantId) {
      throw new BadRequestException('The document belongs to another tenant than the bank account');
    }
  }

  private settlementTypeFor(type: 'invoice' | 'supplier_invoice', amount: number): SettlementType {
    // Incoming money: customer pays (invoice) / supplier refunds (supplier invoice); outgoing the opposite.
    if (type === 'invoice') {
      return amount > 0 ? SettlementType.PAYMENT : SettlementType.REFUND;
    }

    return amount < 0 ? SettlementType.PAYMENT : SettlementType.REFUND;
  }

  private async learnRule(
    manager: EntityManager,
    tx: AccountingBankTransactionEntity,
    targets: MatchTarget[],
    userId: string | null,
  ) {
    const first = targets[0];
    let targetType: 'customer' | 'supplier' | 'account';
    let targetId: string;

    if (first.type === 'account') {
      targetType = 'account';
      targetId = first.accountNumber;
    } else if (first.type === 'invoice') {
      const rows: Array<{ user_id: string }> = await manager.query(
        `SELECT user_id FROM billing_invoices WHERE id = $1`,
        [first.id],
      );

      targetType = 'customer';
      targetId = rows[0]?.user_id;
    } else {
      const rows: Array<{ supplier_id: string }> = await manager.query(
        `SELECT supplier_id FROM billing_supplier_invoices WHERE id = $1`,
        [first.id],
      );

      targetType = 'supplier';
      targetId = rows[0]?.supplier_id;
    }

    if (!targetId || !tx.counterpartyIban) {
      return;
    }

    await manager.query(
      `INSERT INTO billing_accounting_match_rules (kind, pattern, target_type, target_id, created_by_user_id, hits)
       VALUES ('iban', $1, $2, $3, $4, 1)
       ON CONFLICT (kind, pattern) DO UPDATE SET target_type = EXCLUDED.target_type, target_id = EXCLUDED.target_id,
         hits = billing_accounting_match_rules.hits + 1`,
      [tx.counterpartyIban, targetType, targetId, userId],
    );
  }

  private async matchingRules(tx: AccountingBankTransactionEntity): Promise<AccountingMatchRuleEntity[]> {
    const rules = await this.dataSource.getRepository(AccountingMatchRuleEntity).find();
    const text = `${tx.remittance ?? ''} ${tx.counterpartyName ?? ''} ${tx.bookingText ?? ''}`.toUpperCase();

    return rules.filter((r) =>
      r.kind === 'iban' ? Boolean(tx.counterpartyIban) && r.pattern === tx.counterpartyIban : text.includes(r.pattern),
    );
  }

  /** Open customer invoices; restricted to the bank account's tenant unless the account is shared (null). */
  private async openCustomerDocs(currency: string, tenantId: string | null): Promise<OpenDoc[]> {
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      `SELECT i.id, i.invoice_number AS number, i.balance_due AS balance, i.user_id AS party, i.payment_reference AS reference,
              i.currency, COALESCE(NULLIF(cp.company, ''), TRIM(CONCAT(cp.first_name, ' ', cp.last_name))) AS name
       FROM billing_invoices i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN billing_customer_profiles cp ON cp.user_id = i.user_id
       WHERE i.status IN ('issued', 'overdue', 'partially_paid') AND i.balance_due > 0 AND i.currency = $1
         AND ($2::varchar IS NULL OR u.tenant_id = $2)
       ORDER BY i.issued_at DESC LIMIT 5000`,
      [currency, tenantId],
    );

    return rows.map((r) => ({
      id: r['id']!,
      number: r['number'],
      balance: Number(r['balance']),
      party: r['party']!,
      reference: r['reference'],
      currency: r['currency']!,
      name: r['name'],
    }));
  }

  private async openSupplierDocs(currency: string, tenantId: string | null): Promise<OpenDoc[]> {
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      `SELECT s.id, s.invoice_number AS number, s.balance_due AS balance, s.supplier_id AS party, NULL AS reference,
              s.currency, COALESCE(NULLIF(p.company, ''), TRIM(CONCAT(p.first_name, ' ', p.last_name))) AS name
       FROM billing_supplier_invoices s
       LEFT JOIN billing_supplier_profiles p ON p.id = s.supplier_id
       WHERE s.status IN ('issued', 'overdue', 'partially_paid') AND s.balance_due > 0 AND s.currency = $1
         AND ($2::varchar IS NULL OR p.tenant_id = $2)
       ORDER BY s.due_date ASC LIMIT 5000`,
      [currency, tenantId],
    );

    return rows.map((r) => ({
      id: r['id']!,
      number: r['number'],
      balance: Number(r['balance']),
      party: r['party']!,
      reference: null,
      currency: r['currency']!,
      name: r['name'],
    }));
  }

  private async processorLedgerNumber(text: string): Promise<string | null> {
    const processor = ['STRIPE', 'PAYPAL', 'MOLLIE', 'ADYEN'].find((p) => text.includes(p))?.toLowerCase();
    const account = processor
      ? await this.dataSource
          .getRepository(AccountingFinancialAccountEntity)
          .findOne({ where: { processor, kind: 'processor' } })
      : null;

    return account?.ledgerAccountNumber ?? null;
  }

  /** Smallest combination (≤ 8 documents) whose balances sum exactly to `amount`. */
  private subsetSum(docs: OpenDoc[], amount: number): OpenDoc[] | null {
    const target = toCents(amount);
    const items = docs.slice(0, 8);

    for (let mask = 1; mask < 1 << items.length; mask += 1) {
      let sum = 0;
      const picked: OpenDoc[] = [];

      for (let i = 0; i < items.length; i += 1) {
        if (mask & (1 << i)) {
          sum += toCents(items[i].balance);
          picked.push(items[i]);
        }
      }

      if (sum === target && picked.length > 1) {
        return picked;
      }
    }

    return null;
  }

  private normalizeName(name: string): string {
    return name
      .toUpperCase()
      .replace(/\b(GMBH|AG|UG|KG|OHG|SARL|SAS|SA|BV|NV|LTD|LLC|INC|SRL|SPA|SL)\b/g, '')
      .replace(/[^A-Z0-9]/g, '');
  }

  /** Dice coefficient over character bigrams (0–1). */
  private nameSimilarity(a: string, b: string): number {
    if (!a || !b) {
      return 0;
    }

    if (a === b) {
      return 1;
    }

    const grams = (s: string) => {
      const m = new Map<string, number>();

      for (let i = 0; i < s.length - 1; i += 1) {
        const g = s.slice(i, i + 2);

        m.set(g, (m.get(g) ?? 0) + 1);
      }

      return m;
    };
    const ga = grams(a);
    const gb = grams(b);
    let overlap = 0;

    for (const [g, n] of ga) {
      overlap += Math.min(n, gb.get(g) ?? 0);
    }

    return (2 * overlap) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
  }

  /** Transactions per status for statistics. */
  async statusCounts(financialAccountIds: string[]) {
    if (financialAccountIds.length === 0) {
      return [];
    }

    return (await this.dataSource
      .getRepository(AccountingBankTransactionEntity)
      .createQueryBuilder('t')
      .select('t.match_status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .addSelect('COALESCE(SUM(t.amount), 0)::float', 'amount')
      .where({ financialAccountId: In(financialAccountIds) })
      .groupBy('t.match_status')
      .getRawMany()) as Array<{ status: string; count: number; amount: number }>;
  }

  /** Re-exported for the controller. */
  counterpartyTypes = CounterpartyType;
}
