import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { DATEV_BOOKING_FIELD, DATEV_BOOKING_ROW_FIELD_COUNT } from '../../constants/datev-export.constants';
import { formatDatevAmount, truncateDatevText } from '../../utils/datev-format.util';
import {
  AccountingPeriodStatus,
  CounterpartyType,
  JournalLinkType,
  TaxCodeKind,
} from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingEntryLinkEntity } from '../entities/accounting-entry-link.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingJournalLineEntity } from '../entities/accounting-journal-line.entity';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import { AccountingTaxCodeEntity } from '../entities/accounting-tax-code.entity';
import { AccountingConfigService } from '../services/accounting-config.service';
import { fromCents, toCents } from '../utils/accounting-money.util';

export interface LedgerDatevParams {
  /** Tenant dimension filter; `null` = all tenants (unified export). */
  tenantId: string | null;
  periodStart: Date;
  periodEnd: Date;
  /** Exclude entries originating from bank statement lines (the tax advisor receives bank data directly). */
  includeBankPostings: boolean;
  /** Prefix booking texts with the tenant (unified exports) and fill KOST1. */
  unified: boolean;
  resolveDebtor: (tenantId: string, userId: string) => Promise<number>;
  resolveCreditor: (tenantId: string, supplierId: string) => Promise<number>;
  /** Beleglink for an entry's receipt (invoice PDF path inside the ZIP), if any. */
  documentLink: (entry: AccountingJournalEntryEntity, links: AccountingEntryLinkEntity[]) => string | undefined;
}

interface Combined {
  account: AccountingAccountEntity;
  /** Signed cents: + debit, − credit. */
  cents: number;
  originalCents: number | null;
  originalCurrency: string | null;
  buKey: string;
  euCountry: string | null;
  euVatId: string | null;
  euRate: number | null;
  counterparty: { type: CounterpartyType; id: string } | null;
  tenantId: string | null;
  serviceDate: string | null;
}

/**
 * Builds DATEV Buchungsstapel rows from the journal (all bookings: invoices, credits, payments, fees, refunds,
 * write-offs, COGS, depreciation, manual and opening entries). Multi-line entries become Konto/Gegenkonto rows
 * against the entry's anchor (personal account or bank); VAT lines fold into their base line (automatic accounts
 * need no BU key, other accounts get the tax code's BU key).
 */
@Injectable()
export class AccountingDatevLedgerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
  ) {}

  isActive(): boolean {
    return this.config.isEnabled();
  }

  async buildRows(params: LedgerDatevParams): Promise<{ rows: string[][]; entryCount: number; allLocked: boolean }> {
    const from = params.periodStart.toISOString().slice(0, 10);
    const to = params.periodEnd.toISOString().slice(0, 10);
    const qb = this.dataSource
      .getRepository(AccountingJournalEntryEntity)
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.lines', 'l')
      .where('e.posting_date >= :from AND e.posting_date <= :to', { from, to })
      .orderBy('e.postingDate', 'ASC')
      .addOrderBy('e.entryNumber', 'ASC')
      .addOrderBy('l.lineNo', 'ASC');

    if (params.tenantId !== null) {
      qb.andWhere('e.tenant_id = :tenantId', { tenantId: params.tenantId });
    }

    const entries = await qb.getMany();
    const entryIds = entries.map((e) => e.id);
    const links = entryIds.length
      ? await this.dataSource.getRepository(AccountingEntryLinkEntity).find({ where: { entryId: In(entryIds) } })
      : [];
    const linksByEntry = new Map<string, AccountingEntryLinkEntity[]>();

    for (const link of links) {
      linksByEntry.set(link.entryId, [...(linksByEntry.get(link.entryId) ?? []), link]);
    }

    const accountIds = [...new Set(entries.flatMap((e) => (e.lines ?? []).map((l) => l.accountId)))];
    const accounts = accountIds.length
      ? await this.dataSource.getRepository(AccountingAccountEntity).find({ where: { id: In(accountIds) } })
      : [];
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const taxCodeIds = [
      ...new Set(
        entries.flatMap((e) => (e.lines ?? []).map((l) => l.taxCodeId).filter((x): x is string => Boolean(x))),
      ),
    ];
    const taxCodes = taxCodeIds.length
      ? await this.dataSource.getRepository(AccountingTaxCodeEntity).find({ where: { id: In(taxCodeIds) } })
      : [];
    const taxById = new Map(taxCodes.map((t) => [t.id, t]));
    const periodIds = [...new Set(entries.map((e) => e.periodId))];
    const periods = periodIds.length
      ? await this.dataSource.getRepository(AccountingPeriodEntity).find({ where: { id: In(periodIds) } })
      : [];
    const lockedPeriods = new Set(periods.filter((p) => p.status === AccountingPeriodStatus.LOCKED).map((p) => p.id));
    const rows: string[][] = [];
    let entryCount = 0;

    for (const entry of entries) {
      const entryLinks = linksByEntry.get(entry.id) ?? [];

      if (!params.includeBankPostings && entryLinks.some((l) => l.linkType === JournalLinkType.BANK_TRANSACTION)) {
        continue;
      }

      const combined = this.combine(entry.lines ?? [], accountById, taxById);

      if (combined.length < 2) {
        continue;
      }

      const anchor = this.pickAnchor(combined);
      const anchorAccount = await this.accountNumberFor(anchor, entry, params);
      const link = params.documentLink(entry, entryLinks);
      const locked = lockedPeriods.has(entry.periodId);

      for (const line of combined) {
        if (line === anchor || line.cents === 0) {
          continue;
        }

        // The anchor takes the opposite side of each counter line: counter credit ⇒ anchor debit (S).
        const fields = Array.from({ length: DATEV_BOOKING_ROW_FIELD_COUNT }, () => '');
        const anchorDebit = line.cents < 0;
        const currency = (line.originalCurrency ?? entry.currency ?? 'EUR').toUpperCase();
        const functional = this.config.getConfig().functionalCurrency;
        const foreign = currency !== functional && line.originalCents !== null;

        fields[0] = formatDatevAmount(fromCents(Math.abs(foreign ? line.originalCents! : line.cents)));
        fields[1] = anchorDebit ? 'S' : 'H';
        fields[2] = foreign ? currency : functional;

        if (foreign) {
          // Per row: a settlement's open-item line carries the invoice rate, its bank line the payment-day rate.
          const rowRate = line.cents !== 0 ? Math.abs(line.originalCents! / line.cents) : Number(entry.fxRate);

          fields[3] = String(Math.round(rowRate * 1_000_000) / 1_000_000).replace('.', ',');
          fields[4] = formatDatevAmount(fromCents(Math.abs(line.cents)));
          fields[5] = functional;
        }

        fields[6] = anchorAccount;
        fields[7] = await this.accountNumberFor(line, entry, params);
        fields[8] = line.buKey;
        // Belegdatum must lie inside the batch period; a document dated before the period it was posted into (late
        // posting into the next open period) carries its posting date.
        fields[9] = this.ddmmyyyy(
          entry.documentDate >= from && entry.documentDate <= to ? entry.documentDate : entry.postingDate,
        );
        fields[10] = truncateDatevText((entry.documentNumber ?? '').replace(/[^\w$%&*+\-./]/g, ''), 36);
        fields[13] = truncateDatevText(
          params.unified && entry.tenantId ? `[${entry.tenantId}] ${entry.description}` : entry.description,
          60,
        );

        if (link) {
          fields[DATEV_BOOKING_FIELD.documentLink] = link;
        }

        if (params.unified && entry.tenantId) {
          fields[DATEV_BOOKING_FIELD.costCenter1] = truncateDatevText(entry.tenantId, 36);
        }

        if (line.euCountry || line.euVatId) {
          fields[DATEV_BOOKING_FIELD.euCountryVatId] = (line.euVatId ?? line.euCountry ?? '')
            .replace(/\s/g, '')
            .toUpperCase();
        }

        if (line.euRate !== null) {
          fields[DATEV_BOOKING_FIELD.euTaxRate] = line.euRate.toFixed(2).replace('.', ',');
        }

        if (line.serviceDate) {
          fields[DATEV_BOOKING_FIELD.serviceDate] = this.ddmmyyyy(line.serviceDate);
        }

        fields[DATEV_BOOKING_FIELD.lock] = locked ? '1' : '0';
        rows.push(fields);
      }

      entryCount += 1;
    }

    return {
      rows,
      entryCount,
      allLocked: periods.length > 0 && periods.every((p) => p.status === AccountingPeriodStatus.LOCKED),
    };
  }

  /** Folds VAT lines into their base lines and assigns BU keys / EU fields. */
  private combine(
    lines: AccountingJournalLineEntity[],
    accounts: Map<string, AccountingAccountEntity>,
    taxCodes: Map<string, AccountingTaxCodeEntity>,
  ): Combined[] {
    const out: Combined[] = [];
    const bases = new Map<string, Combined>();

    for (const line of lines) {
      const account = accounts.get(line.accountId);

      if (!account) {
        continue;
      }

      const cents = toCents(Number(line.debit)) - toCents(Number(line.credit));
      const taxCode = line.taxCodeId ? taxCodes.get(line.taxCodeId) : undefined;
      const key = `${line.taxCodeId}:${line.taxRate}:${line.counterpartyId ?? ''}`;

      if (line.taxRole === 'tax' || line.taxRole === 'reverse_tax') {
        // Reverse charge: DATEV books input and output VAT itself (BU key / automatic account) → drop both.
        if (taxCode?.kind === TaxCodeKind.REVERSE_CHARGE) {
          continue;
        }

        const base = bases.get(key);

        if (base) {
          base.cents += cents;
          base.originalCents =
            base.originalCents !== null && line.originalAmount != null
              ? base.originalCents + toCents(Number(line.originalAmount))
              : base.originalCents;
          continue;
        }
      }

      const isBase = line.taxRole === 'base' && taxCode;
      const combined: Combined = {
        account,
        cents,
        originalCents: line.originalAmount != null ? toCents(Number(line.originalAmount)) : null,
        originalCurrency: line.originalCurrency ?? null,
        buKey: isBase && !account.isAutomatic ? (taxCode?.datevBuKey ?? '') : '',
        euCountry: isBase && (taxCode?.oss || taxCode?.ecSalesList) ? (line.euCountry ?? null) : null,
        euVatId: isBase && taxCode?.ecSalesList ? (line.euVatId ?? null) : null,
        euRate: isBase && taxCode?.oss && line.taxRate != null ? Number(line.taxRate) : null,
        counterparty:
          line.counterpartyType && line.counterpartyId
            ? { type: line.counterpartyType, id: line.counterpartyId }
            : null,
        tenantId: line.tenantId ?? null,
        serviceDate: line.serviceDate ?? null,
      };

      if (isBase) {
        bases.set(key, combined);
      }

      out.push(combined);
    }

    return out;
  }

  /** Personal account (customer/supplier) first, then the largest line. */
  private pickAnchor(lines: Combined[]): Combined {
    return (
      lines.find((l) => l.counterparty !== null) ?? [...lines].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0]
    );
  }

  private async accountNumberFor(
    line: Combined,
    entry: AccountingJournalEntryEntity,
    params: LedgerDatevParams,
  ): Promise<string> {
    if (line.counterparty) {
      const tenant = line.tenantId ?? entry.tenantId ?? 'default';
      const number =
        line.counterparty.type === CounterpartyType.CUSTOMER
          ? await params.resolveDebtor(tenant, line.counterparty.id)
          : await params.resolveCreditor(tenant, line.counterparty.id);

      return String(number);
    }

    return line.account.number;
  }

  private ddmmyyyy(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');

    return `${d}${m}${y}`;
  }
}
