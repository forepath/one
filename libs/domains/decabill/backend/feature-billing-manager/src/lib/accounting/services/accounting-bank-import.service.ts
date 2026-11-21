import { createHash } from 'crypto';

import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { StoredFileRegistryService } from '../../services/stored-file-registry.service';
import {
  BANK_STATEMENT_FORMATS,
  BankStatementParseError,
  type BankStatementFormat,
  type CsvColumnMapping,
  type ParsedStatement,
  type ParsedTransaction,
} from '../bank-import/bank-import.types';
import { compareDecimals, ibanFromBban, normalizeIban, sumDecimals } from '../bank-import/bank-parse.utils';
import { BankStatementParserService } from '../bank-import/bank-statement-parser.service';
import { CSV_PRESETS } from '../bank-import/parsers/csv-presets';
import { AccountingBankImportEntity } from '../entities/accounting-bank-import.entity';
import { AccountingBankStatementEntity } from '../entities/accounting-bank-statement.entity';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingCsvMappingEntity } from '../entities/accounting-csv-mapping.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';
import { addDays } from '../utils/accounting-date.util';

import { AccountingConfigService } from './accounting-config.service';
import { AccountingReconciliationService } from './accounting-reconciliation.service';

export interface UploadOptions {
  financialAccountId?: string | null;
  format?: string | null;
  csvPreset?: string | null;
  csvMappingId?: string | null;
  encoding?: 'auto' | 'utf-8' | 'windows-1252' | 'iso-8859-1' | 'cp850' | null;
  qifDateFormat?: 'DMY' | 'MDY' | 'auto' | null;
}

/** Tenant scope of the caller: a tenant id, or `null` for global (allowlisted) operators. */
export interface ImportScope {
  tenantId: string;
  global: boolean;
}

const ALLOWED_EXTENSIONS =
  /\.(xml|zip|sta|mt940|mt942|940|942|txt|csv|tsv|cod|coda|n43|aeb|q43|cfonb|120|cbi|bai|bai2|ofx|qfx|qif|dat)$/i;

/**
 * Statement file import: stores the raw file, parses it (any supported format or a ZIP of statements), assigns
 * statements to financial accounts of the caller's tenant by IBAN / account number, deduplicates transactions
 * (native ids or fingerprints with multiset counting, pending → booked replacement), checks balance continuity
 * and runs reconciliation suggestions / auto-matching.
 */
@Injectable()
export class AccountingBankImportService {
  private readonly logger = new Logger(AccountingBankImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly parser: BankStatementParserService,
    private readonly reconciliation: AccountingReconciliationService,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
  ) {}

  csvPresets() {
    return Object.entries(CSV_PRESETS).map(([key, preset]) => ({ key, label: preset.label, mapping: preset.mapping }));
  }

  async upload(
    file: { buffer: Buffer; originalname: string; size: number },
    options: UploadOptions,
    scope: ImportScope,
    userId: string | null,
  ): Promise<AccountingBankImportEntity> {
    const maxBytes = this.config.getConfig().bankImportMaxBytes;

    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Empty file');
    }

    if (file.buffer.length > maxBytes) {
      throw new PayloadTooLargeException(`Statement files are limited to ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }

    const fileName = (file.originalname || 'statement').replace(/[^\w.() -]/g, '_').slice(0, 255);

    if (!ALLOWED_EXTENSIONS.test(fileName) && !options.format) {
      throw new BadRequestException('Unsupported file type; upload a statement file or choose the format');
    }

    if (options.format && !BANK_STATEMENT_FORMATS.includes(options.format as BankStatementFormat)) {
      throw new BadRequestException('Unknown format');
    }

    if (options.financialAccountId) {
      await this.getAccountForScope(options.financialAccountId, scope);
    }

    const csvMapping = await this.resolveCsvMapping(options, scope);
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.dataSource.getRepository(AccountingBankImportEntity).findOne({
      where: { fileSha256: sha, status: 'completed', tenantId: scope.tenantId },
    });

    if (duplicate) {
      throw new ConflictException(`This file was already imported (${duplicate.fileName})`);
    }

    const repo = this.dataSource.getRepository(AccountingBankImportEntity);
    const record = await repo.save(
      repo.create({
        tenantId: scope.tenantId,
        financialAccountId: options.financialAccountId ?? null,
        fileName,
        fileSha256: sha,
        fileSize: file.buffer.length,
        format: options.format ?? null,
        csvMapping: options.csvPreset ?? options.csvMappingId ?? null,
        status: 'processing',
        uploadedByUserId: userId,
      }),
    );
    const storageKey = `${scope.tenantId}/${new Date().toISOString().slice(0, 7)}/${record.id}-${fileName}`;

    await this.fileStorage.writeAccountingImportFile(storageKey, file.buffer);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: scope.tenantId,
      scope: FileStorageScope.accountingImports,
      storageKey,
      content: file.buffer,
    });
    await repo.update(record.id, { storageKey });

    try {
      await this.process(record.id, file.buffer, options, csvMapping, scope);
    } catch (error) {
      const message =
        error instanceof BankStatementParseError ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
          ? (error as Error).message
          : 'Import failed';

      if (
        !(error instanceof BankStatementParseError) &&
        !(error instanceof BadRequestException) &&
        !(error instanceof ForbiddenException)
      ) {
        this.logger.error(`Bank import ${record.id} failed: ${(error as Error).stack ?? error}`);
      }

      await repo.update(record.id, { status: 'failed', errorMessage: message.slice(0, 2000), completedAt: new Date() });
    }

    return (await repo.findOne({ where: { id: record.id } }))!;
  }

  /** Removes an import's unreconciled transactions (reconciled ones must be undone first). */
  async rollback(importId: string, scope: ImportScope): Promise<AccountingBankImportEntity> {
    const record = await this.getImport(importId, scope);
    const restoredIds: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const reconciled = await manager.getRepository(AccountingBankTransactionEntity).count({
        where: { importId, matchStatus: In(['matched', 'booked']) },
      });

      if (reconciled > 0) {
        throw new BadRequestException(`${reconciled} transaction(s) of this import are reconciled; undo them first`);
      }

      const accountIds = (await manager.getRepository(AccountingBankStatementEntity).find({ where: { importId } })).map(
        (st) => st.financialAccountId,
      );
      // Lines superseded by this import's lines (pending lines replaced by booked ones, cross-format duplicates) come
      // back as open lines — unless the removed line was itself superseded by a remaining one: then they point there.
      const removed = await manager.getRepository(AccountingBankTransactionEntity).find({ where: { importId } });
      const removedIds = new Set(removed.map((t) => t.id));

      if (removedIds.size > 0) {
        const dependants = await manager
          .getRepository(AccountingBankTransactionEntity)
          .find({ where: { supersededById: In([...removedIds]), matchStatus: 'superseded' } });
        const successorOf = new Map(
          removed
            .filter((t) => t.matchStatus === 'superseded' && t.supersededById && !removedIds.has(t.supersededById))
            .map((t) => [t.id, t.supersededById as string]),
        );

        for (const dependant of dependants.filter((d) => !removedIds.has(d.id))) {
          const successor = successorOf.get(dependant.supersededById as string);

          if (successor) {
            await manager
              .getRepository(AccountingBankTransactionEntity)
              .update(dependant.id, { supersededById: successor });
          } else {
            await manager
              .getRepository(AccountingBankTransactionEntity)
              .update(dependant.id, { matchStatus: 'unmatched', supersededById: null, matchedAt: null });
            restoredIds.push(dependant.id);
          }
        }
      }

      await manager.getRepository(AccountingBankTransactionEntity).delete({ importId });
      await manager.getRepository(AccountingBankStatementEntity).delete({ importId });
      // Lines that later imports also contained were stored only once (here) and leave with this import. Name those
      // imports so they can be rolled back and uploaded again.
      const overlapping = accountIds.length
        ? await manager
            .getRepository(AccountingBankImportEntity)
            .createQueryBuilder('i')
            .where('i.status = :status', { status: 'completed' })
            .andWhere('i.duplicate_count > 0')
            .andWhere('i.created_at > :createdAt', { createdAt: record.createdAt })
            .andWhere('i.id <> :id', { id: importId })
            .andWhere(
              'EXISTS (SELECT 1 FROM billing_accounting_bank_statements s WHERE s.import_id = i.id AND s.financial_account_id IN (:...accountIds))',
              { accountIds: [...new Set(accountIds)] },
            )
            .getMany()
        : [];
      const hint = overlapping.length
        ? [
            `Later imports overlapping this one may have lost lines with it (roll back and re-upload them): ${overlapping
              .map((i) => i.fileName)
              .join(', ')}`.slice(0, 500),
          ]
        : [];

      await manager
        .getRepository(AccountingBankImportEntity)
        .update(importId, { status: 'rolled_back', warnings: [...(record.warnings ?? []), ...hint] });

      // Balance continuity restarts from the latest remaining statement of each affected account.
      for (const accountId of new Set(accountIds)) {
        const latest = await manager
          .getRepository(AccountingBankStatementEntity)
          .createQueryBuilder('s')
          .where('s.financialAccountId = :accountId', { accountId })
          .andWhere('s.closingBalance IS NOT NULL')
          .andWhere('s.periodTo IS NOT NULL')
          .orderBy('s.periodTo', 'DESC')
          .addOrderBy('s.createdAt', 'DESC')
          .getOne();

        await manager.getRepository(AccountingFinancialAccountEntity).update(accountId, {
          lastClosingBalance: latest ? Number(latest.closingBalance) : null,
          lastClosingDate: latest?.periodTo ?? null,
        });
      }
    });

    if (restoredIds.length > 0) {
      // Restored lines are open again: give them suggestions / auto-matches like freshly imported ones.
      await this.reconciliation.suggestAndAutoMatch(restoredIds).catch((error: unknown) => {
        this.logger.warn(`Reconciliation after rollback of ${importId} failed: ${(error as Error).message}`);
      });
    }

    return (await this.dataSource.getRepository(AccountingBankImportEntity).findOne({ where: { id: record.id } }))!;
  }

  async getImport(importId: string, scope: ImportScope): Promise<AccountingBankImportEntity> {
    const record = await this.dataSource.getRepository(AccountingBankImportEntity).findOne({ where: { id: importId } });

    if (!record || (!scope.global && record.tenantId !== scope.tenantId)) {
      throw new NotFoundException('Import not found');
    }

    return record;
  }

  async downloadImportFile(importId: string, scope: ImportScope): Promise<{ buffer: Buffer; fileName: string }> {
    const record = await this.getImport(importId, scope);

    if (!record.storageKey) {
      throw new NotFoundException('Import file not stored');
    }

    return { buffer: await this.fileStorage.readAccountingImportFile(record.storageKey), fileName: record.fileName };
  }

  async getAccountForScope(id: string, scope: ImportScope): Promise<AccountingFinancialAccountEntity> {
    const account = await this.dataSource.getRepository(AccountingFinancialAccountEntity).findOne({ where: { id } });

    if (!account || !this.accountVisible(account, scope)) {
      throw new NotFoundException('Financial account not found');
    }

    return account;
  }

  accountVisible(account: AccountingFinancialAccountEntity, scope: ImportScope): boolean {
    return scope.global || account.tenantId === scope.tenantId;
  }

  private async process(
    importId: string,
    buffer: Buffer,
    options: UploadOptions,
    csvMapping: CsvColumnMapping | undefined,
    scope: ImportScope,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(AccountingBankImportEntity);
    const forcedAccount = options.financialAccountId
      ? await this.getAccountForScope(options.financialAccountId, scope)
      : null;
    const parsed = this.parser.parse({
      buffer,
      fileName: (await repo.findOneOrFail({ where: { id: importId } })).fileName,
      format: (options.format as BankStatementFormat | undefined) ?? (csvMapping ? 'csv' : undefined),
      encoding: options.encoding ?? 'auto',
      csvMapping,
      qifDateFormat: options.qifDateFormat ?? 'auto',
      defaultCurrency: forcedAccount?.currency,
    });
    const warnings = [...parsed.warnings];
    const newTransactionIds: string[] = [];
    let statements = 0;
    const resolvedAccounts = new Set<string>();
    let transactions = 0;
    let duplicates = 0;
    const formats = new Set<string>();
    // Existing lines already paired with a cross-format duplicate of this import (each absorbs at most one).
    const claimed = new Set<string>();
    let crossFormat = 0;

    await this.dataSource.transaction(async (manager) => {
      for (const file of parsed.files) {
        formats.add(file.parsed.format);
        warnings.push(...file.parsed.warnings.map((w) => `${file.name}: ${w}`));

        for (const statement of file.parsed.statements) {
          // Re-read per statement: continuity and the closing balance must see what earlier statements stored.
          const account = forcedAccount
            ? await this.forcedAccountFor(manager, forcedAccount.id, statement)
            : await this.resolveAccount(manager, statement, scope);

          this.assertCurrency(account, statement);
          resolvedAccounts.add(account.id);

          const stored = await manager.getRepository(AccountingBankStatementEntity).save(
            manager.getRepository(AccountingBankStatementEntity).create({
              importId,
              financialAccountId: account.id,
              kind: statement.kind,
              statementRef: statement.statementId?.slice(0, 128) ?? null,
              sequenceNumber: statement.sequenceNumber?.slice(0, 64) ?? null,
              periodFrom: statement.periodFrom ?? null,
              periodTo: statement.periodTo ?? null,
              openingBalance: statement.openingBalance ? Number(statement.openingBalance.amount) : null,
              closingBalance: statement.closingBalance ? Number(statement.closingBalance.amount) : null,
              currency: statement.currency ?? account.currency,
              warnings: [],
            }),
          );
          const continuity = this.continuityWarning(account, statement);

          if (continuity) {
            warnings.push(continuity);
            await manager.getRepository(AccountingBankStatementEntity).update(stored.id, { warnings: [continuity] });
          }

          statements += 1;

          const result = await this.insertTransactions(
            manager,
            account,
            stored.id,
            importId,
            file.parsed.format,
            statement.transactions,
            claimed,
          );

          transactions += result.inserted.length;
          duplicates += result.duplicates;
          crossFormat += result.crossFormat;
          newTransactionIds.push(...result.inserted);

          if (
            statement.closingBalance &&
            (!account.lastClosingDate || statement.closingBalance.date >= account.lastClosingDate)
          ) {
            await manager.getRepository(AccountingFinancialAccountEntity).update(account.id, {
              lastClosingBalance: Number(statement.closingBalance.amount),
              lastClosingDate: statement.closingBalance.date,
            });
          }
        }
      }

      if (crossFormat > 0) {
        warnings.push(
          `${crossFormat} transaction(s) were already imported from another file format and were kept as superseded duplicates`,
        );
      }

      await manager.getRepository(AccountingBankImportEntity).update(importId, {
        status: 'completed',
        // Auto-detected target: recorded when every statement of the file went to the same account.
        ...(!options.financialAccountId && resolvedAccounts.size === 1
          ? { financialAccountId: [...resolvedAccounts][0] }
          : {}),
        format: [...formats].join(',').slice(0, 64) || null,
        formatVersion: parsed.files[0]?.parsed.formatVersion?.slice(0, 16) ?? null,
        encoding: parsed.files[0]?.parsed.encoding?.slice(0, 16) ?? null,
        statementCount: statements,
        transactionCount: transactions,
        duplicateCount: duplicates,
        warnings: warnings.slice(0, 200).map((w) => w.slice(0, 500)),
        completedAt: new Date(),
      });
    });

    const { matched } = await this.reconciliation.suggestAndAutoMatch(newTransactionIds);

    await repo.update(importId, { matchedCount: matched });
  }

  /**
   * Inserts transactions with layered dedupe:
   * 1. same format — native bank reference when present, otherwise a fingerprint; equal keys in one file get
   *    ascending ordinals so legitimate identical lines survive while re-imports of overlapping statements only add
   *    what is new;
   * 2. across formats — the same period exported once as camt and once as MT940 / CSV / … carries different
   *    references and remittance formatting, so a line without a same-format twin is compared with the lines that
   *    came from other formats (same status, booking date, amount and currency; end-to-end id, counterparty IBAN and
   *    value date must not contradict). Each existing line absorbs at most one line per import (multiset), lines
   *    with a matching identifier are paired first. Such duplicates are stored as `superseded` (pointing at the line
   *    they duplicate) so their dedupe slot stays taken and a rollback of the original import brings them back.
   * Booked lines replace matching pending lines.
   */
  private async insertTransactions(
    manager: EntityManager,
    account: AccountingFinancialAccountEntity,
    statementId: string,
    importId: string,
    sourceFormat: string,
    transactions: ParsedTransaction[],
    claimed: Set<string>,
  ): Promise<{ inserted: string[]; duplicates: number; crossFormat: number }> {
    const ordinals = new Map<string, number>();
    const inserted: string[] = [];
    let duplicates = 0;
    let crossFormat = 0;
    const prepared = transactions.map((tx) => {
      const key = this.dedupeKey(account.id, tx);
      const ordinal = ordinals.get(key) ?? 0;

      ordinals.set(key, ordinal + 1);

      return { tx, key, ordinal, counterIban: normalizeIban(tx.details[0]?.counterparty?.iban) ?? null };
    });
    const existingSlots = await this.existingSlots(
      manager,
      account.id,
      prepared.map((p) => p.key),
    );
    const fresh = prepared.filter((p) => !existingSlots.has(`${p.key}|${p.ordinal}`));

    // A line deduplicated by its key is paired with that existing line: it must not absorb another one as well.
    for (const p of prepared) {
      const twin = existingSlots.get(`${p.key}|${p.ordinal}`);

      if (twin) {
        claimed.add(twin);
      }
    }

    const duplicateOf = await this.crossFormatDuplicates(manager, account, sourceFormat, fresh, claimed);

    duplicates += prepared.length - fresh.length;

    for (const { tx, key, ordinal, counterIban } of fresh) {
      const detail = tx.details[0];
      const supersededBy = duplicateOf.get(tx) ?? null;
      const structured = tx.details.flatMap((d) => d.structuredReferences ?? [])[0]?.reference ?? null;
      const remittance =
        tx.details
          .map((d) => d.remittance)
          .filter(Boolean)
          .join(' | ') || null;
      const rows: Array<{ id: string }> = await manager.query(
        `INSERT INTO billing_accounting_bank_transactions
           (financial_account_id, import_id, statement_id, tenant_id, status, booking_date, value_date, amount, currency,
            is_reversal, counterparty_name, counterparty_iban, counterparty_bic, remittance, end_to_end_id,
            structured_reference, booking_text, bank_reference, bank_transaction_code, details, raw, locator,
            dedupe_key, dedupe_ordinal, source_format, match_status, superseded_by_id, matched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
                 CASE WHEN $27::uuid IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (financial_account_id, dedupe_key, dedupe_ordinal) DO NOTHING
         RETURNING id`,
        [
          account.id,
          importId,
          statementId,
          account.tenantId ?? null,
          tx.status,
          tx.bookingDate,
          tx.valueDate ?? null,
          tx.amount,
          (tx.currency || account.currency).toUpperCase(),
          tx.isReversal,
          detail?.counterparty?.name?.slice(0, 255) ?? null,
          counterIban,
          detail?.counterparty?.bic?.slice(0, 11) ?? null,
          remittance,
          detail?.endToEndId?.slice(0, 128) ?? null,
          structured?.slice(0, 64) ?? null,
          tx.bookingText?.slice(0, 255) ?? null,
          tx.bankReference?.slice(0, 128) ?? null,
          this.transactionCode(tx)?.slice(0, 64) ?? null,
          JSON.stringify(tx.details ?? []),
          tx.raw?.slice(0, 4000) ?? null,
          tx.locator.slice(0, 255),
          key,
          ordinal,
          sourceFormat.slice(0, 16),
          supersededBy ? 'superseded' : 'unmatched',
          supersededBy,
        ],
      );

      if (rows.length === 0 || supersededBy) {
        duplicates += 1;
        crossFormat += rows.length > 0 ? 1 : 0;
        continue;
      }

      inserted.push(rows[0].id);

      if (tx.status === 'booked') {
        await this.supersedePending(manager, account.id, tx, counterIban, rows[0].id);
      }
    }

    return { inserted, duplicates, crossFormat };
  }

  /** `key|ordinal` slots of the given dedupe keys that are already taken on the account → id of the taking line. */
  private async existingSlots(manager: EntityManager, accountId: string, keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) {
      return new Map();
    }

    // A superseded twin stands for the line it duplicates.
    const rows: Array<{ id: string; dedupe_key: string; dedupe_ordinal: number }> = await manager.query(
      `SELECT CASE WHEN match_status = 'superseded' AND superseded_by_id IS NOT NULL THEN superseded_by_id ELSE id END AS id,
              dedupe_key, dedupe_ordinal
       FROM billing_accounting_bank_transactions
       WHERE financial_account_id = $1 AND dedupe_key = ANY($2::varchar[])`,
      [accountId, [...new Set(keys)]],
    );

    return new Map(rows.map((r) => [`${r.dedupe_key}|${r.dedupe_ordinal}`, r.id]));
  }

  /**
   * Pairs new lines with lines of the same account that were imported from another format (see
   * {@link insertTransactions}). Returns new line → id of the existing line it duplicates.
   */
  private async crossFormatDuplicates(
    manager: EntityManager,
    account: AccountingFinancialAccountEntity,
    sourceFormat: string,
    lines: Array<{ tx: ParsedTransaction; counterIban: string | null }>,
    claimed: Set<string>,
  ): Promise<Map<ParsedTransaction, string>> {
    const result = new Map<ParsedTransaction, string>();

    if (lines.length === 0) {
      return result;
    }

    const dates = lines.map((l) => l.tx.bookingDate).sort();
    const candidates: Array<{
      id: string;
      status: string;
      booking_date: string;
      value_date: string | null;
      amount: string;
      currency: string;
      end_to_end_id: string | null;
      counterparty_iban: string | null;
    }> = await manager.query(
      `SELECT id, status, to_char(booking_date, 'YYYY-MM-DD') AS booking_date,
              to_char(value_date, 'YYYY-MM-DD') AS value_date, amount::text AS amount, currency, end_to_end_id,
              counterparty_iban
       FROM billing_accounting_bank_transactions
       WHERE financial_account_id = $1 AND source_format IS NOT NULL AND source_format <> $2
         AND match_status <> 'superseded' AND booking_date >= $3::date AND booking_date <= $4::date
       ORDER BY created_at, id`,
      // Lines of this very upload count too: a ZIP may carry the same period as camt.053 and as MT940.
      [account.id, sourceFormat.slice(0, 16), dates[0], dates[dates.length - 1]],
    );

    if (candidates.length === 0) {
      return result;
    }

    const groupKey = (status: string, date: string, amount: string, currency: string) =>
      `${status}|${date}|${Math.round(Number(amount) * 100)}|${currency.toUpperCase()}`;
    const groups = new Map<string, typeof candidates>();

    for (const c of candidates) {
      const k = groupKey(c.status, c.booking_date, c.amount, c.currency);

      groups.set(k, [...(groups.get(k) ?? []), c]);
    }

    const e2eOf = (value: string | null | undefined) => {
      const v = value?.trim().toUpperCase();

      return v && v !== 'NOTPROVIDED' && v !== 'NONREF' ? v : null;
    };
    const assess = (line: (typeof lines)[number], c: (typeof candidates)[number]): 'strong' | 'weak' | null => {
      const e2e = e2eOf(line.tx.details[0]?.endToEndId);
      const otherE2e = e2eOf(c.end_to_end_id);

      if (
        (e2e && otherE2e && e2e !== otherE2e) ||
        (line.counterIban && c.counterparty_iban && line.counterIban !== c.counterparty_iban)
      ) {
        return null;
      }

      if (line.tx.valueDate && c.value_date && line.tx.valueDate !== c.value_date) {
        return null;
      }

      return (e2e && e2e === otherE2e) || (line.counterIban && line.counterIban === c.counterparty_iban)
        ? 'strong'
        : 'weak';
    };

    // Identifier matches pair first so an anonymous line cannot take the twin of a better identified one.
    for (const pass of ['strong', 'weak'] as const) {
      for (const line of lines) {
        if (result.has(line.tx)) {
          continue;
        }

        const group =
          groups.get(
            groupKey(line.tx.status, line.tx.bookingDate, line.tx.amount, line.tx.currency || account.currency),
          ) ?? [];
        const match = group.find((c) => {
          if (claimed.has(c.id)) {
            return false;
          }

          const quality = assess(line, c);

          return pass === 'strong' ? quality === 'strong' : quality !== null;
        });

        if (match) {
          claimed.add(match.id);
          result.set(line.tx, match.id);
        }
      }
    }

    return result;
  }

  /** A booked line replaces the pending (intraday / "vorgemerkt") line it confirms. */
  private async supersedePending(
    manager: EntityManager,
    accountId: string,
    tx: ParsedTransaction,
    counterIban: string | null,
    newId: string,
  ): Promise<void> {
    const pending = await manager.getRepository(AccountingBankTransactionEntity).find({
      where: {
        financialAccountId: accountId,
        status: 'pending',
        matchStatus: In(['unmatched', 'suggested']),
        amount: tx.amount as unknown as number,
      },
    });
    const e2e = tx.details[0]?.endToEndId ?? null;
    const inWindow = pending.filter(
      (p) =>
        p.id !== newId && p.bookingDate >= addDays(tx.bookingDate, -5) && p.bookingDate <= addDays(tx.bookingDate, 5),
    );
    const identified = inWindow.find(
      (p) => (e2e && p.endToEndId === e2e) || (counterIban && p.counterpartyIban === counterIban),
    );
    // Without identifiers on either side only an unambiguous amount/date match is replaced.
    const anonymous = !e2e && !counterIban ? inWindow.filter((p) => !p.endToEndId && !p.counterpartyIban) : [];
    const candidate = identified ?? (anonymous.length === 1 ? anonymous[0] : undefined);

    if (candidate) {
      // Kept (not deleted) so its dedupe slot stays taken: re-importing an overlapping intraday file must not bring it back.
      await manager.getRepository(AccountingBankTransactionEntity).update(candidate.id, {
        matchStatus: 'superseded',
        suggestion: null,
        matchedAt: new Date(),
        supersededById: newId,
      });
    }
  }

  private dedupeKey(accountId: string, tx: ParsedTransaction): string {
    const detail = tx.details[0];
    const native = tx.bankReference && tx.bankReference.toUpperCase() !== 'NONREF' ? tx.bankReference : null;
    const material = native
      ? // The booking date keeps references that are not unique by spec (QIF N "ATM", Norma43 mandate refs, CSV
        // columns) from swallowing next month's line with the same amount.
        `ref|${tx.status}|${tx.bookingDate}|${native}|${tx.amount}`
      : [
          'fp',
          tx.status,
          tx.bookingDate,
          tx.valueDate ?? '',
          tx.amount,
          tx.currency,
          (normalizeIban(detail?.counterparty?.iban) ?? '').toUpperCase(),
          (detail?.endToEndId ?? '').toUpperCase(),
          (detail?.remittance ?? '').toUpperCase().replace(/\s+/g, ' ').slice(0, 140),
        ].join('|');

    return createHash('sha256').update(`${accountId}|${material}`).digest('hex');
  }

  private transactionCode(tx: ParsedTransaction): string | undefined {
    const code = tx.bankTransactionCode;

    if (!code) {
      return undefined;
    }

    return [code.domain, code.family, code.subFamily].filter(Boolean).join('/') || code.proprietary || code.national;
  }

  /**
   * MT940 / MT942 / CSV statements often identify the account as "bank code/account number" (`:25:12030000/0000202051`).
   * For the national layouts with a plain numeric BBAN (DE: 8 + 10 digits, AT: 5 + 11) the IBAN is derived.
   */
  private ibanFromBankCode(bankCode: string | undefined, accountNumber: string | undefined): string | undefined {
    if (!bankCode || !accountNumber || !/^\d+$/.test(bankCode) || !/^\d+$/.test(accountNumber)) {
      return undefined;
    }

    if (bankCode.length === 8 && accountNumber.length <= 10) {
      return normalizeIban(ibanFromBban('DE', `${bankCode}${accountNumber.padStart(10, '0')}`));
    }

    if (bankCode.length === 5 && accountNumber.length <= 11) {
      return normalizeIban(ibanFromBban('AT', `${bankCode}${accountNumber.padStart(11, '0')}`));
    }

    return undefined;
  }

  /**
   * The chosen target account, freshly loaded. It only overrides the detection for statements that do not name an
   * account or name this one — a statement of another IBAN in a multi-account file is rejected, not misbooked.
   */
  private async forcedAccountFor(
    manager: EntityManager,
    accountId: string,
    statement: ParsedStatement,
  ): Promise<AccountingFinancialAccountEntity> {
    const account = await manager
      .getRepository(AccountingFinancialAccountEntity)
      .findOneOrFail({ where: { id: accountId } });
    const iban =
      normalizeIban(statement.account.iban) ??
      this.ibanFromBankCode(statement.account.bankCode, statement.account.accountNumber);

    if (iban && account.iban && normalizeIban(account.iban) !== iban) {
      throw new BadRequestException(
        `The file contains a statement for ${iban}, which is not the chosen account ${account.name}`,
      );
    }

    return account;
  }

  /** Statement → financial account by IBAN / account number; it must be visible to the caller's tenant. */
  private async resolveAccount(
    manager: EntityManager,
    statement: ParsedStatement,
    scope: ImportScope,
  ): Promise<AccountingFinancialAccountEntity> {
    const iban =
      normalizeIban(statement.account.iban) ??
      this.ibanFromBankCode(statement.account.bankCode, statement.account.accountNumber);
    const repo = manager.getRepository(AccountingFinancialAccountEntity);
    const accountNumber = statement.account.accountNumber;
    const where = [
      ...(iban ? [{ iban, isActive: true }] : []),
      ...(accountNumber ? [{ accountNumber, isActive: true }] : []),
    ];
    const candidates = where.length ? await repo.find({ where }) : [];
    const visible = candidates.filter((a) => this.accountVisible(a, scope));
    const byCurrency = visible.filter((a) => !statement.currency || a.currency === statement.currency);
    const account = byCurrency[0] ?? visible[0];

    if (!account) {
      const id = iban ?? statement.account.accountNumber ?? 'unknown account';

      // A file is not proof of ownership: unknown or foreign accounts are rejected, never auto-created.
      throw new BadRequestException(`No financial account for ${id}; create it first or choose the target account`);
    }

    return account;
  }

  private assertCurrency(account: AccountingFinancialAccountEntity, statement: ParsedStatement): void {
    const currencies = new Set(statement.transactions.map((t) => (t.currency || account.currency).toUpperCase()));

    for (const currency of currencies) {
      if (currency !== account.currency) {
        throw new BadRequestException(
          `Statement currency ${currency} does not match account ${account.name} (${account.currency})`,
        );
      }
    }
  }

  private continuityWarning(account: AccountingFinancialAccountEntity, statement: ParsedStatement): string | null {
    if (!statement.openingBalance || account.lastClosingBalance == null || !account.lastClosingDate) {
      return null;
    }

    // Only compare the directly following statement (opening date = day after the last closing).
    if (
      statement.openingBalance.date !== account.lastClosingDate &&
      statement.openingBalance.date !== addDays(account.lastClosingDate, 1)
    ) {
      return null;
    }

    if (compareDecimals(statement.openingBalance.amount, String(Number(account.lastClosingBalance).toFixed(2))) !== 0) {
      return `Opening balance ${statement.openingBalance.amount} of ${account.name} does not match the last closing balance ${Number(account.lastClosingBalance).toFixed(2)} (missing statement?)`;
    }

    return null;
  }

  private async resolveCsvMapping(options: UploadOptions, scope: ImportScope): Promise<CsvColumnMapping | undefined> {
    if (options.csvPreset) {
      const preset = CSV_PRESETS[options.csvPreset];

      if (!preset) {
        throw new BadRequestException('Unknown CSV preset');
      }

      return preset.mapping;
    }

    if (options.csvMappingId) {
      const saved = await this.dataSource
        .getRepository(AccountingCsvMappingEntity)
        .findOne({ where: { id: options.csvMappingId } });

      if (!saved || (!scope.global && saved.tenantId !== scope.tenantId && saved.tenantId !== null)) {
        throw new NotFoundException('CSV mapping not found');
      }

      return saved.mapping;
    }

    return undefined;
  }

  /** Sum check helper for statistics (inflow / outflow per month). */
  async flowSeries(accountIds: string[], from: string, to: string) {
    if (accountIds.length === 0) {
      return [];
    }

    return (await this.dataSource.query(
      `SELECT to_char(date_trunc('month', booking_date), 'YYYY-MM') AS month,
              SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::float AS inflow,
              SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END)::float AS outflow,
              COUNT(*)::int AS count
       FROM billing_accounting_bank_transactions
       WHERE financial_account_id = ANY($1) AND status = 'booked' AND match_status <> 'superseded'
         AND booking_date >= $2 AND booking_date <= $3
       GROUP BY 1 ORDER BY 1`,
      [accountIds, from, to],
    )) as Array<{ month: string; inflow: number; outflow: number; count: number }>;
  }

  /** Not used externally; keeps the decimal helper import meaningful for balance sums. */
  sumAmounts(transactions: ParsedTransaction[]): string {
    return sumDecimals(transactions.map((t) => t.amount));
  }
}
