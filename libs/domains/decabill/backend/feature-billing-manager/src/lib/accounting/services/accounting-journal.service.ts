import { randomUUID } from 'crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import {
  AccountingAccountType,
  AccountingPeriodStatus,
  CounterpartyType,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
} from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingEntryLinkEntity } from '../entities/accounting-entry-link.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingJournalLineEntity } from '../entities/accounting-journal-line.entity';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import { toCents, fromCents } from '../utils/accounting-money.util';

import { AccountingFiscalYearService } from './accounting-fiscal-year.service';

export interface JournalLineInput {
  accountId: string;
  /** Exactly one of debit / credit > 0 (functional currency, 2 decimals). */
  debit?: number;
  credit?: number;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  taxCodeId?: string | null;
  taxRate?: number | null;
  taxRole?: 'base' | 'tax' | 'reverse_tax' | null;
  counterpartyType?: CounterpartyType | null;
  counterpartyId?: string | null;
  openItemId?: string | null;
  tenantId?: string | null;
  costCenter?: string | null;
  description?: string | null;
  serviceDate?: string | null;
  euCountry?: string | null;
  euVatId?: string | null;
}

export interface JournalLinkInput {
  linkType: JournalLinkType;
  targetId: string;
  role: JournalLinkRole;
  label?: string | null;
}

export interface PostEntryInput {
  /** Belegdatum (ISO); decides the period unless that period is locked. */
  documentDate: string;
  documentNumber?: string | null;
  description: string;
  kind: JournalEntryKind;
  sourceType: JournalSourceType;
  sourceId?: string | null;
  sourceEvent?: string | null;
  /** Defaults to `{sourceType}:{sourceId}:{sourceEvent}` (automatic) or a random key (manual). */
  idempotencyKey?: string;
  tenantId?: string | null;
  currency?: string;
  fxRate?: number;
  reversalOfEntryId?: string | null;
  createdByUserId?: string | null;
  lines: JournalLineInput[];
  links?: JournalLinkInput[];
  /** Force a specific fiscal year (opening entries); the posting date is then the year's first day. */
  fiscalYearId?: string;
}

export interface PostEntryResult {
  entry: AccountingJournalEntryEntity;
  created: boolean;
}

const MAX_LINES = 2000;

/**
 * The journal: balanced, append-only entries with gap-free numbers per fiscal year. Posting is idempotent by key
 * (re-posting the same business event returns the existing entry). Corrections are reversal entries.
 */
@Injectable()
export class AccountingJournalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly fiscalYears: AccountingFiscalYearService,
  ) {}

  static automaticKey(sourceType: JournalSourceType, sourceId: string, event: string): string {
    return `${sourceType}:${sourceId}:${event}`;
  }

  async findByKey(key: string, manager?: EntityManager): Promise<AccountingJournalEntryEntity | null> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingJournalEntryEntity)
      .findOne({ where: { idempotencyKey: key } });
  }

  async post(input: PostEntryInput, manager?: EntityManager): Promise<PostEntryResult> {
    if (manager) {
      return await this.postInManager(input, manager);
    }

    return await this.dataSource.transaction(async (m) => await this.postInManager(input, m));
  }

  /** Mirrors an entry (debit ↔ credit) into the first open period; the original gets `reversedByEntryId`. */
  async reverse(
    entryId: string,
    options: { documentDate?: string; reason?: string; createdByUserId?: string | null; idempotencyKey?: string },
    manager?: EntityManager,
  ): Promise<PostEntryResult> {
    const run = async (m: EntityManager): Promise<PostEntryResult> => {
      const original = await m
        .getRepository(AccountingJournalEntryEntity)
        .createQueryBuilder('e')
        .where('e.id = :id', { id: entryId })
        .setLock('pessimistic_write')
        .getOne();

      if (!original) {
        throw new NotFoundException('Journal entry not found');
      }

      const key = options.idempotencyKey ?? `reversal:${original.id}`;
      const existing = await this.findByKey(key, m);

      if (existing) {
        return { entry: existing, created: false };
      }

      if (original.reversedByEntryId) {
        throw new BadRequestException('Journal entry is already reversed');
      }

      if (original.kind === JournalEntryKind.REVERSAL) {
        throw new BadRequestException('A reversal entry cannot be reversed; post a new entry instead');
      }

      const lines = await m
        .getRepository(AccountingJournalLineEntity)
        .find({ where: { entryId: original.id }, order: { lineNo: 'ASC' } });
      const result = await this.postInManager(
        {
          documentDate: options.documentDate ?? original.documentDate,
          documentNumber: original.documentNumber,
          description: `Storno: ${options.reason ? `${options.reason} – ` : ''}${original.description}`.slice(0, 255),
          kind: JournalEntryKind.REVERSAL,
          sourceType: original.sourceType,
          sourceId: original.sourceId,
          sourceEvent: `${original.sourceEvent ?? 'entry'}_reversal`.slice(0, 48),
          idempotencyKey: key,
          tenantId: original.tenantId,
          currency: original.currency,
          fxRate: Number(original.fxRate),
          reversalOfEntryId: original.id,
          createdByUserId: options.createdByUserId ?? null,
          lines: lines.map((line) => ({
            accountId: line.accountId,
            debit: Number(line.credit),
            credit: Number(line.debit),
            originalAmount: line.originalAmount != null ? -Number(line.originalAmount) : null,
            originalCurrency: line.originalCurrency,
            taxCodeId: line.taxCodeId,
            taxRate: line.taxRate != null ? Number(line.taxRate) : null,
            taxRole: line.taxRole,
            counterpartyType: line.counterpartyType,
            counterpartyId: line.counterpartyId,
            openItemId: line.openItemId,
            tenantId: line.tenantId,
            costCenter: line.costCenter,
            description: line.description,
            serviceDate: line.serviceDate,
            euCountry: line.euCountry,
            euVatId: line.euVatId,
          })),
          links: [{ linkType: JournalLinkType.JOURNAL_ENTRY, targetId: original.id, role: JournalLinkRole.RELATED }],
        },
        m,
      );

      await m.getRepository(AccountingJournalEntryEntity).update(original.id, { reversedByEntryId: result.entry.id });

      return result;
    };

    return manager ? await run(manager) : await this.dataSource.transaction(run);
  }

  async getEntry(entryId: string, manager?: EntityManager): Promise<AccountingJournalEntryEntity> {
    const entry = await (manager ?? this.dataSource.manager)
      .getRepository(AccountingJournalEntryEntity)
      .findOne({ where: { id: entryId }, relations: ['lines'] });

    if (!entry) {
      throw new NotFoundException('Journal entry not found');
    }

    entry.lines?.sort((a, b) => a.lineNo - b.lineNo);

    return entry;
  }

  async listLinks(entryId: string, manager?: EntityManager): Promise<AccountingEntryLinkEntity[]> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingEntryLinkEntity)
      .find({ where: { entryId }, order: { createdAt: 'ASC' } });
  }

  /** Entries linked to a document or transaction (reverse lookup). */
  async findEntriesByLink(linkType: JournalLinkType, targetId: string): Promise<AccountingJournalEntryEntity[]> {
    const links = await this.dataSource
      .getRepository(AccountingEntryLinkEntity)
      .find({ where: { linkType, targetId } });

    if (links.length === 0) {
      return [];
    }

    return await this.dataSource.getRepository(AccountingJournalEntryEntity).find({
      where: { id: In([...new Set(links.map((l) => l.entryId))]) },
      relations: ['lines'],
      order: { postingDate: 'ASC', entryNumber: 'ASC' },
    });
  }

  /** Adds a link (allowed for entries in locked periods too — links add evidence, they never change amounts). */
  async addLink(
    entryId: string,
    link: JournalLinkInput,
    userId: string | null,
    manager?: EntityManager,
  ): Promise<AccountingEntryLinkEntity> {
    const m = manager ?? this.dataSource.manager;

    await this.getEntry(entryId, m);

    const repo = m.getRepository(AccountingEntryLinkEntity);
    const existing = await repo.findOne({
      where: { entryId, linkType: link.linkType, targetId: link.targetId, role: link.role },
    });

    if (existing) {
      return existing;
    }

    return await repo.save(
      repo.create({
        entryId,
        linkType: link.linkType,
        targetId: link.targetId,
        role: link.role,
        label: link.label ?? null,
        createdByUserId: userId,
      }),
    );
  }

  /** Removes a manually added link; entries in locked periods keep all links (GoBD audit trail). */
  async removeLink(entryId: string, linkId: string): Promise<void> {
    const entry = await this.getEntry(entryId);
    const period = await this.dataSource
      .getRepository(AccountingPeriodEntity)
      .findOne({ where: { id: entry.periodId } });

    if (period?.status === AccountingPeriodStatus.LOCKED) {
      throw new ForbiddenException('Links of bookings in locked periods cannot be removed');
    }

    const link = await this.dataSource
      .getRepository(AccountingEntryLinkEntity)
      .findOne({ where: { id: linkId, entryId } });

    if (!link) {
      throw new NotFoundException('Link not found');
    }

    if (link.role === JournalLinkRole.SOURCE) {
      throw new BadRequestException('The source link of an automatic booking cannot be removed');
    }

    await this.dataSource.getRepository(AccountingEntryLinkEntity).delete(link.id);
  }

  private async postInManager(input: PostEntryInput, manager: EntityManager): Promise<PostEntryResult> {
    const key =
      input.idempotencyKey ??
      (input.kind === JournalEntryKind.MANUAL || !input.sourceId
        ? `manual:${randomUUID()}`
        : AccountingJournalService.automaticKey(input.sourceType, input.sourceId, input.sourceEvent ?? 'posted'));
    const existing = await this.findByKey(key, manager);

    if (existing) {
      return { entry: existing, created: false };
    }

    const lines = input.lines.filter((l) => toCents(l.debit ?? 0) !== 0 || toCents(l.credit ?? 0) !== 0);

    if (lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least two non-zero lines');
    }

    if (lines.length > MAX_LINES) {
      throw new BadRequestException(`A journal entry may have at most ${MAX_LINES} lines`);
    }

    let debitCents = 0;
    let creditCents = 0;

    for (const line of lines) {
      const debit = toCents(line.debit ?? 0);
      const credit = toCents(line.credit ?? 0);

      if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) {
        throw new BadRequestException('Each line is either a positive debit or a positive credit');
      }

      debitCents += debit;
      creditCents += credit;
    }

    if (debitCents !== creditCents) {
      throw new BadRequestException(
        `Journal entry is not balanced (debit ${fromCents(debitCents)} ≠ credit ${fromCents(creditCents)})`,
      );
    }

    const target = input.fiscalYearId
      ? await this.targetForYear(input.fiscalYearId, manager)
      : await this.fiscalYears.resolvePostingTarget(input.documentDate, manager);
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await manager.getRepository(AccountingAccountEntity).find({ where: { id: In(accountIds) } });

    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('Unknown account in journal entry');
    }

    for (const account of accounts) {
      if (account.chartId !== target.fiscalYear.chartId) {
        throw new BadRequestException(
          `Account ${account.number} does not belong to the chart of fiscal year ${target.fiscalYear.name}`,
        );
      }

      if (!account.isActive) {
        throw new BadRequestException(`Account ${account.number} is inactive`);
      }

      if (account.type === AccountingAccountType.STATISTICAL && input.kind !== JournalEntryKind.OPENING) {
        throw new BadRequestException(`Carry-forward account ${account.number} is reserved for opening balances`);
      }
    }

    const sequence: Array<{ last_value: number }> = await manager.query(
      `INSERT INTO billing_accounting_entry_number_sequences (fiscal_year_id, last_value) VALUES ($1, 1)
       ON CONFLICT (fiscal_year_id) DO UPDATE SET last_value = billing_accounting_entry_number_sequences.last_value + 1
       RETURNING last_value`,
      [target.fiscalYear.id],
    );
    const entryRepo = manager.getRepository(AccountingJournalEntryEntity);
    const entry = await entryRepo.save(
      entryRepo.create({
        fiscalYearId: target.fiscalYear.id,
        periodId: target.period.id,
        entryNumber: Number(sequence[0].last_value),
        postingDate: target.postingDate,
        documentDate: input.documentDate,
        documentNumber: input.documentNumber?.slice(0, 64) ?? null,
        description: (input.description || '—').slice(0, 255),
        kind: input.kind,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        sourceEvent: input.sourceEvent ?? null,
        idempotencyKey: key,
        tenantId: input.tenantId ?? null,
        currency: (input.currency ?? 'EUR').toUpperCase(),
        fxRate: input.fxRate ?? 1,
        total: fromCents(debitCents),
        reversalOfEntryId: input.reversalOfEntryId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      }),
    );
    const lineRepo = manager.getRepository(AccountingJournalLineEntity);

    await lineRepo.save(
      lines.map((line, index) =>
        lineRepo.create({
          entryId: entry.id,
          lineNo: index + 1,
          accountId: line.accountId,
          debit: fromCents(toCents(line.debit ?? 0)),
          credit: fromCents(toCents(line.credit ?? 0)),
          originalAmount: line.originalAmount ?? null,
          originalCurrency: line.originalCurrency ?? null,
          taxCodeId: line.taxCodeId ?? null,
          taxRate: line.taxRate ?? null,
          taxRole: line.taxRole ?? null,
          counterpartyType: line.counterpartyType ?? null,
          counterpartyId: line.counterpartyId ?? null,
          openItemId: line.openItemId ?? null,
          tenantId: line.tenantId ?? input.tenantId ?? null,
          costCenter: line.costCenter ?? null,
          description: line.description?.slice(0, 255) ?? null,
          serviceDate: line.serviceDate ?? null,
          euCountry: line.euCountry ?? null,
          euVatId: line.euVatId ?? null,
        }),
      ),
    );

    if (input.links?.length) {
      const linkRepo = manager.getRepository(AccountingEntryLinkEntity);
      const unique = new Map(input.links.map((l) => [`${l.linkType}:${l.targetId}:${l.role}`, l]));

      await linkRepo.save(
        [...unique.values()].map((l) =>
          linkRepo.create({
            entryId: entry.id,
            linkType: l.linkType,
            targetId: l.targetId,
            role: l.role,
            label: l.label ?? null,
            createdByUserId: input.createdByUserId ?? null,
          }),
        ),
      );
    }

    return { entry, created: true };
  }

  private async targetForYear(fiscalYearId: string, manager: EntityManager) {
    const fiscalYear = await this.fiscalYears.getYear(fiscalYearId, manager);
    const period = await manager
      .getRepository(AccountingPeriodEntity)
      .findOne({ where: { fiscalYearId, periodIndex: 1 } });

    if (!period) {
      throw new BadRequestException('Fiscal year has no periods');
    }

    if (period.status === AccountingPeriodStatus.LOCKED) {
      throw new BadRequestException('The first period of the fiscal year is locked');
    }

    return { fiscalYear, period, postingDate: fiscalYear.startDate };
  }
}
