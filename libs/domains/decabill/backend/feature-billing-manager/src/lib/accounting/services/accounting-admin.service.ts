import { createHash } from 'crypto';

import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, In, IsNull } from 'typeorm';

import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { StoredFileRegistryService } from '../../services/stored-file-registry.service';
import { normalizeIban } from '../bank-import/bank-parse.utils';
import { JournalEntryKind, JournalLinkRole, JournalSourceType } from '../constants/accounting.constants';
import type { FinancialAccountDto, JournalLinkDto, ManualEntryDto } from '../dto/accounting.dto';
import { AccountingBankImportEntity } from '../entities/accounting-bank-import.entity';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingCsvMappingEntity } from '../entities/accounting-csv-mapping.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingPostingIssueEntity } from '../entities/accounting-posting-issue.entity';
import { isoToday } from '../utils/accounting-date.util';
import { fromCents, toCents } from '../utils/accounting-money.util';
import type { AccountingViewScope } from '../utils/accounting-scope.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingJournalService, type JournalLineInput } from './accounting-journal.service';
import { AccountingReconciliationService } from './accounting-reconciliation.service';
import { AccountingReferenceService } from './accounting-reference.service';
import { AccountingReportsService } from './accounting-reports.service';

const IMPLEMENTED_EXPORTS: string[] = ['datev', 'gdpdu', 'fec', 'saft', 'xaf', 'journal_csv', 'trial_balance_csv'];
const RECEIPT_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/xml',
  'text/xml',
]);
const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;

/** Accounting console operations that span several services (journal UI, manual entries, banking master data). */
@Injectable()
export class AccountingAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly charts: AccountingChartService,
    private readonly fiscalYears: AccountingFiscalYearService,
    private readonly journal: AccountingJournalService,
    private readonly reports: AccountingReportsService,
    private readonly reconciliation: AccountingReconciliationService,
    private readonly auditLog: BillingAuditLogService,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
    private readonly references: AccountingReferenceService,
  ) {}

  async overview(scope: AccountingViewScope) {
    const cfg = this.config.getConfig();
    const years = await this.fiscalYears.listYears();
    // Posting issues are entity-wide (not tenant-attributed); only global views see the count.
    const issues = scope.global
      ? await this.dataSource.getRepository(AccountingPostingIssueEntity).count({ where: { resolvedAt: IsNull() } })
      : null;

    return {
      enabled: cfg.enabled,
      country: cfg.country,
      profile: {
        country: cfg.profile.country,
        name: cfg.profile.name,
        templates: cfg.profile.templates,
        defaultTemplate: cfg.defaultChartTemplate,
        vatReturns: cfg.profile.vatReturns.map((r) => ({
          key: r.key,
          name: r.name,
          kind: r.kind,
          periods: r.periods,
          filingChannel: r.filingChannel,
          filingUrl: r.filingUrl,
          dueRule: r.dueRule,
        })),
        // Only exports Decabill implements (profiles may list national formats such as XAF / SIE for later).
        exports: cfg.profile.exports.filter((e) => IMPLEMENTED_EXPORTS.includes(e)),
        hasCashBasis: Boolean(cfg.profile.cashBasis),
        retention: cfg.profile.retention,
        complianceNotice: cfg.profile.complianceNotice ?? null,
        mandatoryChart: cfg.profile.mandatoryChart,
      },
      method: cfg.method,
      vatBasis: cfg.vatBasis,
      startDate: cfg.startDate,
      fiscalYearStartMonth: cfg.fiscalYearStartMonth,
      functionalCurrency: cfg.functionalCurrency,
      vatReturnPeriod: cfg.vatReturnPeriod,
      features: this.config
        .getFeatureAvailability()
        .filter((f) => !cfg.profile.exports.includes(f.key as never) || IMPLEMENTED_EXPORTS.includes(f.key)),
      fiscalYears: years,
      openPostingIssues: issues,
      globalAccess: scope.global,
      tenantFilter: scope.tenantFilter,
    };
  }

  async listJournal(
    scope: AccountingViewScope,
    q: {
      from?: string;
      to?: string;
      accountId?: string;
      sourceType?: string;
      kind?: string;
      search?: string;
      limit: number;
      offset: number;
    },
  ) {
    const qb = this.dataSource
      .getRepository(AccountingJournalEntryEntity)
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.lines', 'l')
      .orderBy('e.postingDate', 'DESC')
      .addOrderBy('e.entryNumber', 'DESC')
      .take(q.limit)
      .skip(q.offset);

    if (scope.tenantFilter !== null) {
      qb.andWhere('e.tenant_id = :tenantId', { tenantId: scope.tenantFilter });
    }

    if (q.from) {
      qb.andWhere('e.posting_date >= :from', { from: q.from });
    }

    if (q.to) {
      qb.andWhere('e.posting_date <= :to', { to: q.to });
    }

    if (q.sourceType) {
      qb.andWhere('e.source_type = :sourceType', { sourceType: q.sourceType });
    }

    if (q.kind) {
      qb.andWhere('e.kind = :kind', { kind: q.kind });
    }

    if (q.accountId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM billing_accounting_journal_lines x WHERE x.entry_id = e.id AND x.account_id = :accountId)',
        {
          accountId: q.accountId,
        },
      );
    }

    if (q.search?.trim()) {
      const term = `%${q.search.trim().replace(/[%_\\]/g, '\\$&')}%`;

      qb.andWhere(
        new Brackets((w) => {
          w.where('e.description ILIKE :term', { term })
            .orWhere('e.document_number ILIKE :term', { term })
            .orWhere('CAST(e.entry_number AS text) = :exact', { exact: q.search!.trim() });
        }),
      );
    }

    const [items, total] = await qb.getManyAndCount();

    return { items: items.map((e) => ({ ...e, lines: (e.lines ?? []).sort((a, b) => a.lineNo - b.lineNo) })), total };
  }

  async getEntry(entryId: string, scope: AccountingViewScope) {
    const entry = await this.journal.getEntry(entryId);

    this.assertEntryVisible(entry, scope);

    const links = await this.journal.listLinks(entryId);
    const lines = entry.lines ?? [];
    // Documents and counterparties by the numbers people know (invoice / customer numbers), not raw ids.
    const labels = await this.references.labels([
      ...links.map((l) => ({ type: l.linkType, id: l.targetId })),
      ...lines.map((l) => ({ type: l.counterpartyType ?? '', id: l.counterpartyId })),
    ]);
    const labelOf = (type: string | null | undefined, id: string | null | undefined) =>
      type && id ? (labels.get(AccountingReferenceService.key(type, id)) ?? null) : null;

    return {
      ...entry,
      lines: lines.map((l) => ({ ...l, counterpartyLabel: labelOf(l.counterpartyType, l.counterpartyId) })),
      links: links.map((l) => ({ ...l, targetLabel: labelOf(l.linkType, l.targetId) })),
    };
  }

  /**
   * Manual booking (accounts by number; lines with a tax code are entered gross and the VAT is split off to the
   * tax code's account).
   */
  async createManualEntry(dto: ManualEntryDto, scope: AccountingViewScope, userId: string | null) {
    const tenantId = this.resolveWriteTenant(dto.tenantId, scope);
    const result = await this.dataSource.transaction(async (manager) => {
      const target = await this.fiscalYears.resolvePostingTarget(dto.documentDate, manager);
      const chartId = target.fiscalYear.chartId;
      const lines: JournalLineInput[] = [];

      for (const line of dto.lines) {
        const debit = toCents(line.debit ?? 0);
        const credit = toCents(line.credit ?? 0);

        if (debit > 0 === credit > 0) {
          throw new BadRequestException(`Line ${line.accountNumber}: enter either a debit or a credit amount`);
        }

        const account = await this.charts.findAccountByNumber(chartId, line.accountNumber, manager);

        if (!account) {
          throw new BadRequestException(
            `Account ${line.accountNumber} does not exist in the chart of fiscal year ${target.fiscalYear.name}`,
          );
        }

        const sign = debit > 0 ? 1 : -1;
        const gross = debit > 0 ? debit : credit;
        const taxCode = line.taxCode ? await this.charts.findTaxCode(chartId, line.taxCode, manager) : null;

        if (line.taxCode && !taxCode) {
          throw new BadRequestException(`Tax code ${line.taxCode} does not exist`);
        }

        const rate = taxCode?.rate != null ? Number(taxCode.rate) : 0;
        const tax = taxCode?.accountId && rate > 0 ? Math.round((gross * rate) / (100 + rate)) : 0;
        const side = (cents: number) => (sign > 0 ? { debit: fromCents(cents) } : { credit: fromCents(cents) });

        lines.push({
          accountId: account.id,
          ...side(gross - tax),
          taxCodeId: taxCode?.id ?? null,
          taxRate: taxCode ? rate : null,
          taxRole: taxCode ? 'base' : null,
          description: line.description ?? null,
          costCenter: line.costCenter ?? null,
          tenantId,
        });

        if (tax > 0 && taxCode?.accountId) {
          lines.push({
            accountId: taxCode.accountId,
            ...side(tax),
            taxCodeId: taxCode.id,
            taxRate: rate,
            taxRole: 'tax',
            tenantId,
          });
        }
      }

      return await this.journal.post(
        {
          documentDate: dto.documentDate,
          documentNumber: dto.documentNumber ?? null,
          description: dto.description,
          kind: JournalEntryKind.MANUAL,
          sourceType: JournalSourceType.MANUAL,
          tenantId,
          currency: this.config.getConfig().functionalCurrency,
          createdByUserId: userId,
          lines,
          links: (dto.links ?? []).map((l) => ({
            linkType: l.linkType,
            targetId: l.targetId,
            role: l.role ?? JournalLinkRole.RELATED,
            label: l.label,
          })),
        },
        manager,
      );
    });

    await this.auditLog.log({
      process: 'accounting.entry.manual',
      level: 'info',
      message: `Manual journal entry ${result.entry.entryNumber}`,
      userId: userId ?? undefined,
      context: { entryId: result.entry.id, total: result.entry.total, tenantId },
    });

    return await this.getEntry(result.entry.id, scope);
  }

  async reverseEntry(
    entryId: string,
    input: { documentDate?: string; reason?: string },
    scope: AccountingViewScope,
    userId: string | null,
  ) {
    const entry = await this.journal.getEntry(entryId);

    this.assertEntryVisible(entry, scope);

    const result = await this.journal.reverse(entryId, {
      documentDate: input.documentDate ?? isoToday(),
      reason: input.reason,
      createdByUserId: userId,
    });

    await this.auditLog.log({
      process: 'accounting.entry.reverse',
      level: 'info',
      message: `Reversed journal entry ${entry.entryNumber}`,
      userId: userId ?? undefined,
      context: { entryId, reversalEntryId: result.entry.id, reason: input.reason },
    });

    return await this.getEntry(result.entry.id, scope);
  }

  async addLink(entryId: string, dto: JournalLinkDto, scope: AccountingViewScope, userId: string | null) {
    const entry = await this.journal.getEntry(entryId);

    this.assertEntryVisible(entry, scope);

    // People enter the document number; it resolves within the entry's tenant (ids pass through).
    const targetId = await this.references.resolve(dto.linkType, dto.targetId, entry.tenantId ?? null);
    const link = await this.journal.addLink(
      entryId,
      { linkType: dto.linkType, targetId, role: dto.role ?? JournalLinkRole.RELATED, label: dto.label },
      userId,
    );

    await this.auditLog.log({
      process: 'accounting.entry.link',
      level: 'info',
      message: `Linked ${dto.linkType} ${dto.targetId} to entry ${entry.entryNumber}`,
      userId: userId ?? undefined,
      context: { entryId, linkId: link.id },
    });

    return link;
  }

  async removeLink(entryId: string, linkId: string, scope: AccountingViewScope, userId: string | null) {
    const entry = await this.journal.getEntry(entryId);

    this.assertEntryVisible(entry, scope);
    await this.journal.removeLink(entryId, linkId);
    await this.auditLog.log({
      process: 'accounting.entry.unlink',
      level: 'info',
      message: `Removed link from entry ${entry.entryNumber}`,
      userId: userId ?? undefined,
      context: { entryId, linkId },
    });
  }

  /** Uploads a receipt (Beleg) and links it to the entry. */
  async attachReceipt(
    entryId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    scope: AccountingViewScope,
    userId: string | null,
  ) {
    const entry = await this.journal.getEntry(entryId);

    this.assertEntryVisible(entry, scope);

    if (!file?.buffer?.length) {
      throw new BadRequestException('Empty file');
    }

    if (file.buffer.length > MAX_RECEIPT_BYTES) {
      throw new BadRequestException('Receipts are limited to 20 MB');
    }

    if (!RECEIPT_MIME.has(file.mimetype)) {
      throw new BadRequestException('Receipts must be PDF, PNG, JPEG, WebP or XML');
    }

    if (file.mimetype === 'application/pdf' && file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new BadRequestException('File content is not a PDF');
    }

    const tenantId = entry.tenantId ?? scope.requestTenantId;
    const safeName = (file.originalname || 'receipt').replace(/[^\w.() -]/g, '_').slice(0, 120);
    const hash = createHash('sha256').update(file.buffer).digest('hex').slice(0, 12);
    const storageKey = `${tenantId}/${entry.postingDate.slice(0, 7)}/${entry.id}-${hash}-${safeName}`;

    await this.fileStorage.writeAccountingReceiptFile(storageKey, file.buffer);

    const stored = await this.storedFileRegistry.registerFromBuffer({
      tenantId,
      scope: FileStorageScope.accountingReceipts,
      storageKey,
      content: file.buffer,
    });

    return await this.addLink(
      entryId,
      {
        linkType: 'stored_file' as JournalLinkDto['linkType'],
        targetId: stored.id,
        role: JournalLinkRole.RECEIPT,
        label: safeName,
      },
      scope,
      userId,
    );
  }

  async downloadReceipt(
    storedFileId: string,
    scope: AccountingViewScope,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const rows: Array<{ storage_key: string; tenant_id: string }> = await this.dataSource.query(
      `SELECT storage_key, tenant_id FROM billing_stored_files WHERE id = $1 AND scope = $2`,
      [storedFileId, FileStorageScope.accountingReceipts],
    );

    if (!rows[0] || (!scope.global && rows[0].tenant_id !== scope.requestTenantId)) {
      throw new NotFoundException('Receipt not found');
    }

    return {
      buffer: await this.fileStorage.readAccountingReceiptFile(rows[0].storage_key),
      fileName: rows[0].storage_key
        .split('/')
        .pop()!
        .replace(/^[0-9a-f-]{36}-[0-9a-f]{12}-/, ''),
    };
  }

  async listPostingIssues(includeResolved: boolean, limit: number, offset: number) {
    const [items, total] = await this.dataSource.getRepository(AccountingPostingIssueEntity).findAndCount({
      where: includeResolved ? {} : { resolvedAt: IsNull() },
      order: { updatedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    const labels = await this.references.labels(items.map((i) => ({ type: i.sourceType, id: i.sourceId })));

    return {
      items: items.map((i) => ({
        ...i,
        sourceLabel: labels.get(AccountingReferenceService.key(i.sourceType, i.sourceId)) ?? null,
      })),
      total,
    };
  }

  // ── Financial accounts, imports, transactions ────────────────────────────

  async listFinancialAccounts(scope: AccountingViewScope) {
    const repo = this.dataSource.getRepository(AccountingFinancialAccountEntity);

    if (scope.tenantFilter === null) {
      return await repo.find({ order: { name: 'ASC' } });
    }

    return await repo.find({
      where: scope.global
        ? [{ tenantId: scope.tenantFilter }, { tenantId: IsNull() }]
        : { tenantId: scope.tenantFilter },
      order: { name: 'ASC' },
    });
  }

  async saveFinancialAccount(
    id: string | null,
    dto: FinancialAccountDto,
    scope: AccountingViewScope,
    userId: string | null,
  ) {
    const repo = this.dataSource.getRepository(AccountingFinancialAccountEntity);
    const existing = id ? await repo.findOne({ where: { id } }) : null;

    if (id && (!existing || (!scope.global && existing.tenantId !== scope.requestTenantId))) {
      throw new NotFoundException('Financial account not found');
    }

    const tenantId = dto.tenantId === undefined ? (existing?.tenantId ?? scope.requestTenantId) : dto.tenantId;

    if (!scope.global && tenantId !== scope.requestTenantId) {
      throw new ForbiddenException('Accounts of other tenants or shared accounts need global access');
    }

    const iban = dto.iban ? normalizeIban(dto.iban) : null;

    if (dto.iban && !iban) {
      throw new BadRequestException('Invalid IBAN checksum');
    }

    const saved = await repo.save(
      repo.create({
        ...(existing ?? {}),
        name: dto.name,
        kind: dto.kind,
        iban,
        accountNumber: dto.accountNumber ?? null,
        bic: dto.bic ?? null,
        currency: dto.currency,
        ledgerAccountNumber: dto.ledgerAccountNumber,
        processor: dto.kind === 'processor' ? (dto.processor ?? null) : null,
        tenantId,
        isActive: dto.isActive ?? existing?.isActive ?? true,
      }),
    );

    await this.auditLog.log({
      process: id ? 'accounting.financial_account.update' : 'accounting.financial_account.create',
      level: 'info',
      message: `Financial account ${saved.name}`,
      userId: userId ?? undefined,
      context: { financialAccountId: saved.id },
    });

    return saved;
  }

  async listImports(scope: AccountingViewScope, limit: number, offset: number) {
    const where = scope.tenantFilter === null ? {} : { tenantId: scope.tenantFilter };
    const [items, total] = await this.dataSource.getRepository(AccountingBankImportEntity).findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async listTransactions(
    scope: AccountingViewScope,
    q: {
      financialAccountId?: string;
      matchStatus?: string;
      importId?: string;
      search?: string;
      limit: number;
      offset: number;
    },
  ) {
    const accounts = await this.listFinancialAccounts(scope);
    const ids = accounts.map((a) => a.id).filter((id) => !q.financialAccountId || id === q.financialAccountId);

    if (ids.length === 0) {
      return { items: [], total: 0 };
    }

    const qb = this.dataSource
      .getRepository(AccountingBankTransactionEntity)
      .createQueryBuilder('t')
      .where({ financialAccountId: In(ids) })
      .orderBy('t.bookingDate', 'DESC')
      .addOrderBy('t.createdAt', 'DESC')
      .take(q.limit)
      .skip(q.offset);

    if (q.matchStatus) {
      qb.andWhere('t.match_status = :status', { status: q.matchStatus });
    }

    if (q.importId) {
      qb.andWhere('t.import_id = :importId', { importId: q.importId });
    }

    if (q.search?.trim()) {
      const term = `%${q.search.trim().replace(/[%_\\]/g, '\\$&')}%`;

      qb.andWhere(
        new Brackets((w) => {
          w.where('t.remittance ILIKE :term', { term })
            .orWhere('t.counterparty_name ILIKE :term', { term })
            .orWhere('t.end_to_end_id ILIKE :term', { term })
            .orWhere('t.counterparty_iban ILIKE :term', { term });
        }),
      );
    }

    const [items, total] = await qb.getManyAndCount();

    return { items: items.map((t) => ({ ...t, raw: undefined })), total };
  }

  async getTransactionForScope(id: string, scope: AccountingViewScope): Promise<AccountingBankTransactionEntity> {
    const tx = await this.dataSource.getRepository(AccountingBankTransactionEntity).findOne({ where: { id } });

    if (!tx) {
      throw new NotFoundException('Bank transaction not found');
    }

    const account = await this.dataSource
      .getRepository(AccountingFinancialAccountEntity)
      .findOne({ where: { id: tx.financialAccountId } });

    if (!account || (!scope.global && account.tenantId !== scope.requestTenantId)) {
      throw new NotFoundException('Bank transaction not found');
    }

    return tx;
  }

  async suggestionsFor(id: string, scope: AccountingViewScope) {
    return await this.reconciliation.suggest(await this.getTransactionForScope(id, scope));
  }

  async listCsvMappings(scope: AccountingViewScope) {
    return await this.dataSource.getRepository(AccountingCsvMappingEntity).find({
      where: scope.global ? {} : [{ tenantId: scope.requestTenantId }, { tenantId: IsNull() }],
      order: { name: 'ASC' },
    });
  }

  async saveCsvMapping(
    id: string | null,
    input: { name: string; mapping: Record<string, unknown> },
    scope: AccountingViewScope,
  ) {
    const repo = this.dataSource.getRepository(AccountingCsvMappingEntity);
    const mapping = input.mapping as unknown as AccountingCsvMappingEntity['mapping'];

    if (
      !mapping ||
      typeof mapping !== 'object' ||
      !mapping.columns ||
      typeof mapping.columns !== 'object' ||
      !mapping.dateFormat
    ) {
      throw new BadRequestException('Mapping needs columns and a date format');
    }

    if (JSON.stringify(mapping).length > 10_000) {
      throw new BadRequestException('Mapping too large');
    }

    const existing = id ? await repo.findOne({ where: { id } }) : null;

    if (id && (!existing || (!scope.global && existing.tenantId !== scope.requestTenantId))) {
      throw new NotFoundException('CSV mapping not found');
    }

    return await repo.save(
      repo.create({
        ...(existing ?? {}),
        name: input.name,
        mapping,
        tenantId: existing?.tenantId ?? scope.requestTenantId,
      }),
    );
  }

  async deleteCsvMapping(id: string, scope: AccountingViewScope): Promise<void> {
    const repo = this.dataSource.getRepository(AccountingCsvMappingEntity);
    const existing = await repo.findOne({ where: { id } });

    if (!existing || (!scope.global && existing.tenantId !== scope.requestTenantId)) {
      throw new NotFoundException('CSV mapping not found');
    }

    await repo.delete(id);
  }

  // ── Statistics ───────────────────────────────────────────────────────────

  async journalStatistics(scope: AccountingViewScope, from: string, to: string) {
    const series = await this.reports.journalSeries(from, to, scope.tenantFilter, 'month');
    const result = await this.reports.resultSeries(from, to, scope.tenantFilter);
    const bySource: Array<{ source: string; entries: number; volume: number }> = await this.dataSource.query(
      `SELECT e.source_type AS source, COUNT(*)::int AS entries, COALESCE(SUM(e.total), 0)::float AS volume
       FROM billing_accounting_journal_entries e
       WHERE e.posting_date >= $1 AND e.posting_date <= $2 ${scope.tenantFilter !== null ? 'AND e.tenant_id = $3' : ''}
       GROUP BY 1 ORDER BY 2 DESC`,
      scope.tenantFilter !== null ? [from, to, scope.tenantFilter] : [from, to],
    );
    const entries = series.reduce((s, r) => s + r.entries, 0);
    const manual = series.reduce((s, r) => s + r.manual, 0);
    const revenue = result.reduce((s, r) => s + r.revenue, 0);
    const expenses = result.reduce((s, r) => s + r.expenses, 0);

    return {
      kpis: {
        entries,
        manualShare: entries > 0 ? manual / entries : 0,
        volume: fromCents(series.reduce((s, r) => s + toCents(r.volume), 0)),
        revenue: fromCents(toCents(revenue)),
        expenses: fromCents(toCents(expenses)),
        result: fromCents(toCents(revenue) - toCents(expenses)),
      },
      series,
      result,
      bySource,
    };
  }

  async bankStatistics(scope: AccountingViewScope, from: string, to: string) {
    const accounts = await this.listFinancialAccounts(scope);
    const ids = accounts.map((a) => a.id);
    const flows: Array<{ month: string; inflow: number; outflow: number; count: number }> = ids.length
      ? await this.dataSource.query(
          `SELECT to_char(date_trunc('month', booking_date), 'YYYY-MM') AS month,
                  SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::float AS inflow,
                  SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END)::float AS outflow, COUNT(*)::int AS count
           FROM billing_accounting_bank_transactions
           WHERE financial_account_id = ANY($1) AND status = 'booked' AND match_status <> 'superseded'
             AND booking_date >= $2 AND booking_date <= $3
           GROUP BY 1 ORDER BY 1`,
          [ids, from, to],
        )
      : [];
    const statuses = await this.reconciliation.statusCounts(ids);
    const total = statuses.reduce((s, r) => s + r.count, 0);
    const reconciled = statuses
      .filter((s) => ['matched', 'booked', 'ignored', 'superseded'].includes(s.status))
      .reduce((s, r) => s + r.count, 0);

    return {
      kpis: {
        accounts: accounts.length,
        transactions: total,
        reconciliationRate: total > 0 ? reconciled / total : 1,
        unmatched: statuses
          .filter((s) => s.status === 'unmatched' || s.status === 'suggested')
          .reduce((s, r) => s + r.count, 0),
        balance: accounts.reduce((s, a) => s + Number(a.lastClosingBalance ?? 0), 0),
      },
      flows,
      statuses,
      balances: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        balance: a.lastClosingBalance != null ? Number(a.lastClosingBalance) : null,
        date: a.lastClosingDate,
      })),
    };
  }

  private assertEntryVisible(entry: AccountingJournalEntryEntity, scope: AccountingViewScope): void {
    if (scope.tenantFilter !== null && entry.tenantId !== scope.tenantFilter) {
      throw new NotFoundException('Journal entry not found');
    }
  }

  private resolveWriteTenant(requested: string | undefined, scope: AccountingViewScope): string | null {
    if (!requested || requested === scope.requestTenantId) {
      return scope.tenantFilter ?? scope.requestTenantId;
    }

    if (!scope.global) {
      throw new ForbiddenException('Bookings for other tenants need global access');
    }

    return requested === 'none' ? null : requested;
  }
}
