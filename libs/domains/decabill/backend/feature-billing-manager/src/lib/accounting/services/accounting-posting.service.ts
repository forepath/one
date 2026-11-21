import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { SettlementDocumentType, SettlementSource, SettlementType } from '../../constants/settlement.constants';
import { TaxMode } from '../../constants/tax-mode.constants';
import { DocumentSettlementEntity } from '../../entities/document-settlement.entity';
import { InvoiceCreditDocumentEntity } from '../../entities/invoice-credit-document.entity';
import { InvoiceLineItemEntity } from '../../entities/invoice-line-item.entity';
import { InvoiceEntity } from '../../entities/invoice.entity';
import { SupplierInvoiceLineItemEntity } from '../../entities/supplier-invoice-line-item.entity';
import { SupplierInvoiceEntity } from '../../entities/supplier-invoice.entity';
import { SupplierProfileEntity } from '../../entities/supplier-profile.entity';
import {
  AccountingAccountRole as R,
  CounterpartyType,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
  TaxCodeKind,
} from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingTaxCodeEntity } from '../entities/accounting-tax-code.entity';
import type { AccountingPostingPort } from '../ports/accounting-posting.port';
import { CanonicalTaxCode as C } from '../profiles/accounting-profile.types';
import { toBookingDate } from '../utils/accounting-date.util';
import { allocateCents, fromCents, toCents } from '../utils/accounting-money.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingFixedAssetService } from './accounting-fixed-asset.service';
import { AccountingFxService } from './accounting-fx.service';
import { AccountingJournalService, type JournalLineInput, type PostEntryInput } from './accounting-journal.service';

/** Revenue role per canonical output tax code. */
const REVENUE_ROLE_BY_TAX_CODE: Record<string, R> = {
  [C.OUT_STANDARD]: R.REVENUE_STANDARD,
  [C.OUT_REDUCED]: R.REVENUE_REDUCED,
  [C.OUT_REDUCED_2]: R.REVENUE_REDUCED,
  [C.OUT_ZERO]: R.REVENUE_TAX_FREE,
  [C.OUT_EU_REVERSE_CHARGE]: R.REVENUE_EU_REVERSE_CHARGE,
  [C.OUT_OSS]: R.REVENUE_OSS,
  [C.OUT_EXPORT_SERVICES]: R.REVENUE_THIRD_COUNTRY,
  [C.OUT_NON_TAXABLE]: R.REVENUE_THIRD_COUNTRY,
};

interface TaxGroup {
  taxCode: AccountingTaxCodeEntity;
  rate: number;
  net: number;
  tax: number;
  /** Revenue / expense account. */
  accountId: string;
}

/** Signed line builder: positive = debit, negative = credit (functional currency). */
type DocumentFxConversion = ((amount: number) => number) & { rate: number; currency: string; foreign: boolean };

class EntryBuilder {
  readonly lines: JournalLineInput[] = [];

  add(accountId: string, amount: number, extra: Omit<JournalLineInput, 'accountId' | 'debit' | 'credit'> = {}): void {
    const cents = toCents(amount);

    if (cents === 0) {
      return;
    }

    this.lines.push({
      accountId,
      ...(cents > 0 ? { debit: fromCents(cents) } : { credit: fromCents(-cents) }),
      ...extra,
    });
  }

  /**
   * Adds a line from a document-currency amount: converted with `conv` (sign-symmetric rounding) and, for foreign
   * currencies, with the original amount / currency kept on the line (DATEV WKZ fields, FEC Montantdevise, SAF-T
   * CurrencyAmount, XAF currency).
   */
  addFx(
    accountId: string,
    conv: DocumentFxConversion,
    original: number,
    extra: Omit<JournalLineInput, 'accountId' | 'debit' | 'credit'> = {},
  ): void {
    const functional = Math.sign(original) * conv(Math.abs(original));

    this.add(
      accountId,
      functional,
      conv.foreign
        ? { ...extra, originalAmount: Math.round(original * 100) / 100, originalCurrency: conv.currency }
        : extra,
    );
  }

  imbalanceCents(): number {
    return this.lines.reduce((sum, l) => sum + toCents(l.debit ?? 0) - toCents(l.credit ?? 0), 0);
  }
}

/**
 * Turns billing events into journal entries (implements the posting port the billing services call inside their
 * transactions). Every call is idempotent and never throws: errors roll back to a savepoint and are recorded as
 * posting issues for the catch-up job.
 */
@Injectable()
export class AccountingPostingService implements AccountingPostingPort {
  private readonly logger = new Logger(AccountingPostingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly charts: AccountingChartService,
    private readonly fiscalYears: AccountingFiscalYearService,
    private readonly journal: AccountingJournalService,
    private readonly fx: AccountingFxService,
    private readonly assets: AccountingFixedAssetService,
  ) {}

  async onInvoiceIssued(manager: EntityManager, invoiceId: string): Promise<void> {
    await this.safely(manager, JournalSourceType.INVOICE, invoiceId, 'issued', async () => {
      const invoice = await manager.getRepository(InvoiceEntity).findOneOrFail({ where: { id: invoiceId } });

      return await this.buildInvoiceEntry(manager, invoice, 1, 'issued', toBookingDate(invoice.issuedAt));
    });
  }

  async onInvoiceVoided(manager: EntityManager, invoiceId: string): Promise<void> {
    await this.safely(manager, JournalSourceType.INVOICE, invoiceId, 'voided', async () => {
      const invoice = await manager.getRepository(InvoiceEntity).findOneOrFail({ where: { id: invoiceId } });
      const voidDate = toBookingDate(invoice.voidedAt ?? new Date());
      const issuedKey = AccountingJournalService.automaticKey(JournalSourceType.INVOICE, invoiceId, 'issued');
      const issuedEntry = await this.journal.findByKey(issuedKey, manager);

      if (issuedEntry) {
        await this.journal.reverse(
          issuedEntry.id,
          {
            documentDate: voidDate,
            reason: `Invoice ${invoice.invoiceNumber ?? invoice.id} voided`,
            idempotencyKey: AccountingJournalService.automaticKey(JournalSourceType.INVOICE, invoiceId, 'voided'),
          },
          manager,
        );

        return null;
      }

      // Issued before the bookkeeping start (opening item): book the cancellation in full at the void date.
      return await this.buildInvoiceEntry(manager, invoice, -1, 'voided', voidDate);
    });
  }

  async onCreditDocumentCreated(manager: EntityManager, creditDocumentId: string): Promise<void> {
    await this.safely(manager, JournalSourceType.CREDIT_DOCUMENT, creditDocumentId, 'created', async () => {
      const credit = await manager
        .getRepository(InvoiceCreditDocumentEntity)
        .findOneOrFail({ where: { id: creditDocumentId } });
      const invoice = await manager.getRepository(InvoiceEntity).findOneOrFail({ where: { id: credit.invoiceId } });
      const date = toBookingDate(credit.withdrawnAt);

      if (this.beforeStart(date)) {
        return null;
      }

      const chartId = await this.chartFor(date, manager);
      const tenantId = await this.customerTenant(manager, invoice.userId);
      const net = Number(credit.creditNet);
      const tax = credit.creditTax != null ? Number(credit.creditTax) : Number(credit.creditGross) - net;
      const rate = credit.taxRate != null ? Number(credit.taxRate) : net !== 0 ? (tax / net) * 100 : 0;
      const taxCode = await this.outputTaxCode(manager, chartId, invoice.taxMode ?? null, rate);
      const revenueAccount = await this.revenueAccountFor(manager, chartId, taxCode);
      // At the invoice's rate: the credit note mirrors (part of) the original booking, so the open item clears
      // without a currency residual.
      const conv = await this.fxFor(invoice.currency, toBookingDate(invoice.issuedAt), manager);
      const builder = new EntryBuilder();
      const party = this.customerParty(invoice);
      const gross = Number(credit.creditGross);
      const grossF = conv(gross);
      const netF = conv(net);
      const foreign = conv.foreign ? { originalCurrency: conv.currency } : {};

      builder.add(revenueAccount, netF, {
        ...this.taxLineExtra(invoice, taxCode, rate, 'base'),
        tenantId,
        ...(conv.foreign ? { ...foreign, originalAmount: net } : {}),
      });

      if (taxCode.accountId && toCents(tax) !== 0) {
        builder.add(taxCode.accountId, grossF - netF, {
          ...this.taxLineExtra(invoice, taxCode, rate, 'tax'),
          tenantId,
          ...(conv.foreign ? { ...foreign, originalAmount: Math.round((gross - net) * 100) / 100 } : {}),
        });
      }

      builder.add(await this.role(manager, chartId, R.RECEIVABLES), -grossF, {
        ...party,
        openItemId: invoice.id,
        tenantId,
        ...(conv.foreign ? { ...foreign, originalAmount: -gross } : {}),
      });

      return this.entry({
        documentDate: date,
        documentNumber: credit.documentNumber,
        description: `Credit note ${credit.documentNumber} for ${invoice.invoiceNumber ?? invoice.id}`,
        sourceType: JournalSourceType.CREDIT_DOCUMENT,
        sourceId: credit.id,
        sourceEvent: 'created',
        tenantId,
        currency: invoice.currency,
        fxRate: conv.rate,
        lines: await this.balance(manager, chartId, builder),
        links: [
          { linkType: JournalLinkType.CREDIT_DOCUMENT, targetId: credit.id, role: JournalLinkRole.SOURCE },
          { linkType: JournalLinkType.INVOICE, targetId: invoice.id, role: JournalLinkRole.SETTLES },
        ],
      });
    });
  }

  async onSettlementApplied(manager: EntityManager, settlementId: string): Promise<void> {
    const settlement = await manager.getRepository(DocumentSettlementEntity).findOne({ where: { id: settlementId } });

    if (!settlement) {
      return;
    }

    // Credit notes book their own entry; transfers are booked once, on the receiving side. Migrated settlements
    // (recorded before accounting existed) are booked like any other from the start date on: earlier ones are part of
    // the reconstructed opening items, later ones must clear the receivables / payables of booked documents.
    if (settlement.type === SettlementType.CREDIT || settlement.type === SettlementType.CREDIT_TRANSFER_OUT) {
      return;
    }

    await this.safely(manager, JournalSourceType.SETTLEMENT, settlementId, settlement.type, async () =>
      settlement.documentType === SettlementDocumentType.INVOICE
        ? await this.buildCustomerSettlementEntry(manager, settlement)
        : await this.buildSupplierSettlementEntry(manager, settlement),
    );
  }

  async onSupplierInvoiceIssued(manager: EntityManager, supplierInvoiceId: string): Promise<void> {
    await this.safely(manager, JournalSourceType.SUPPLIER_INVOICE, supplierInvoiceId, 'issued', async () => {
      const invoice = await manager
        .getRepository(SupplierInvoiceEntity)
        .findOneOrFail({ where: { id: supplierInvoiceId } });

      return await this.buildSupplierInvoiceEntry(
        manager,
        invoice,
        1,
        'issued',
        toBookingDate(invoice.issueDate ?? invoice.issuedAt),
      );
    });
  }

  async onSupplierInvoiceVoided(manager: EntityManager, supplierInvoiceId: string): Promise<void> {
    await this.safely(manager, JournalSourceType.SUPPLIER_INVOICE, supplierInvoiceId, 'voided', async () => {
      const invoice = await manager
        .getRepository(SupplierInvoiceEntity)
        .findOneOrFail({ where: { id: supplierInvoiceId } });
      const voidDate = toBookingDate(invoice.voidedAt ?? new Date());
      const issuedEntry = await this.journal.findByKey(
        AccountingJournalService.automaticKey(JournalSourceType.SUPPLIER_INVOICE, supplierInvoiceId, 'issued'),
        manager,
      );

      if (issuedEntry) {
        await this.journal.reverse(
          issuedEntry.id,
          {
            documentDate: voidDate,
            reason: `Supplier invoice ${invoice.invoiceNumber ?? invoice.id} voided`,
            idempotencyKey: AccountingJournalService.automaticKey(
              JournalSourceType.SUPPLIER_INVOICE,
              supplierInvoiceId,
              'voided',
            ),
          },
          manager,
        );

        return null;
      }

      return await this.buildSupplierInvoiceEntry(manager, invoice, -1, 'voided', voidDate);
    });
  }

  /** Implemented by the inventory valuation extension (registered later in the module). */
  async onInventoryMovementBooked(manager: EntityManager, movementId: string): Promise<void> {
    if (this.inventoryHandler) {
      await this.safely(manager, JournalSourceType.INVENTORY_MOVEMENT, movementId, 'booked', async () =>
        this.inventoryHandler ? await this.inventoryHandler(manager, movementId) : null,
      );
    }
  }

  /** Inventory valuation registers its posting builder here (avoids a module cycle). */
  inventoryHandler?: (manager: EntityManager, movementId: string) => Promise<PostEntryInput | null>;

  // ── Builders ──────────────────────────────────────────────────────────────

  private async buildInvoiceEntry(
    manager: EntityManager,
    invoice: InvoiceEntity,
    sign: 1 | -1,
    event: string,
    date: string,
  ): Promise<PostEntryInput | null> {
    if (this.beforeStart(toBookingDate(invoice.issuedAt))) {
      // Pre-start invoices are opening items; only their later cancellation is booked (sign −1).
      if (sign === 1) {
        return null;
      }
    }

    const chartId = await this.chartFor(date, manager);
    const tenantId = await this.customerTenant(manager, invoice.userId);
    const lines = await manager.getRepository(InvoiceLineItemEntity).find({ where: { invoiceId: invoice.id } });
    const groups = await this.outputGroups(manager, chartId, invoice, lines);
    const conv = await this.fxFor(invoice.currency, toBookingDate(invoice.issuedAt), manager);
    const builder = new EntryBuilder();
    const party = this.customerParty(invoice);
    const serviceDate = date;

    for (const group of groups) {
      builder.addFx(group.accountId, conv, -sign * group.net, {
        ...this.taxLineExtra(invoice, group.taxCode, group.rate, 'base'),
        tenantId,
        serviceDate,
      });

      if (group.taxCode.accountId && toCents(group.tax) !== 0) {
        builder.addFx(group.taxCode.accountId, conv, -sign * group.tax, {
          ...this.taxLineExtra(invoice, group.taxCode, group.rate, 'tax'),
          tenantId,
        });
      }
    }

    builder.addFx(await this.role(manager, chartId, R.RECEIVABLES), conv, sign * Number(invoice.totalGross), {
      ...party,
      openItemId: invoice.id,
      tenantId,
    });

    return this.entry({
      documentDate: date,
      documentNumber: invoice.invoiceNumber ?? null,
      description: `${sign === 1 ? 'Invoice' : 'Cancellation of invoice'} ${invoice.invoiceNumber ?? invoice.id}`,
      sourceType: JournalSourceType.INVOICE,
      sourceId: invoice.id,
      sourceEvent: event,
      tenantId,
      currency: invoice.currency,
      fxRate: conv.rate,
      lines: await this.balance(manager, chartId, builder),
      links: [
        { linkType: JournalLinkType.INVOICE, targetId: invoice.id, role: JournalLinkRole.SOURCE },
        ...(invoice.subscriptionId
          ? [
              {
                linkType: JournalLinkType.SUBSCRIPTION,
                targetId: invoice.subscriptionId,
                role: JournalLinkRole.RELATED,
              },
            ]
          : []),
        ...(invoice.projectId
          ? [{ linkType: JournalLinkType.PROJECT, targetId: invoice.projectId, role: JournalLinkRole.RELATED }]
          : []),
        ...(invoice.offerId
          ? [{ linkType: JournalLinkType.OFFER, targetId: invoice.offerId, role: JournalLinkRole.RELATED }]
          : []),
      ],
    });
  }

  private async buildCustomerSettlementEntry(
    manager: EntityManager,
    settlement: DocumentSettlementEntity,
  ): Promise<PostEntryInput | null> {
    const date = toBookingDate(settlement.occurredAt);

    if (this.beforeStart(date)) {
      return null;
    }

    const invoice = await manager.getRepository(InvoiceEntity).findOneOrFail({ where: { id: settlement.documentId } });
    const chartId = await this.chartFor(date, manager);
    const tenantId = await this.customerTenant(manager, invoice.userId);
    const receivables = await this.role(manager, chartId, R.RECEIVABLES);
    const party = this.customerParty(invoice);
    const amount = Number(settlement.amount);
    // Receivable side at the invoice's booking rate, cash side at the settlement date's rate (difference = FX).
    const invoiceConv = await this.fxFor(invoice.currency, toBookingDate(invoice.issuedAt), manager);
    const cashConv = await this.fxFor(invoice.currency, date, manager);
    const builder = new EntryBuilder();
    const arExtra = { ...party, openItemId: invoice.id, tenantId };
    let description: string;

    switch (settlement.type) {
      case SettlementType.PAYMENT:
      case SettlementType.PAYMENT_REVERSAL:

      case SettlementType.REFUND: {
        const cashAccount = await this.cashAccountFor(manager, chartId, settlement);
        const inflow = settlement.type === SettlementType.PAYMENT ? 1 : -1;

        builder.addFx(cashAccount, cashConv, inflow * amount, { tenantId });
        builder.addFx(receivables, invoiceConv, -inflow * amount, arExtra);
        await this.addFxDifference(manager, chartId, builder, tenantId);
        description =
          settlement.type === SettlementType.PAYMENT
            ? `Payment ${invoice.invoiceNumber ?? ''}`
            : settlement.type === SettlementType.REFUND
              ? `Refund ${invoice.invoiceNumber ?? ''}`
              : `Payment reversal ${invoice.invoiceNumber ?? ''}`;
        break;
      }

      case SettlementType.WRITE_OFF:

      case SettlementType.DISCOUNT: {
        const role = settlement.type === SettlementType.WRITE_OFF ? R.BAD_DEBT : R.CASH_DISCOUNTS_GRANTED;
        const target = await this.role(manager, chartId, role);
        const lines = await manager.getRepository(InvoiceLineItemEntity).find({ where: { invoiceId: invoice.id } });
        const groups = await this.outputGroups(manager, chartId, invoice, lines);
        const total = Number(invoice.totalGross);
        const amountF = invoiceConv(amount);
        // VAT correction (§ 17 UStG) proportional to the invoice's tax groups.
        const weights = groups.map((g) => g.net + g.tax);
        const parts = allocateCents(toCents(amountF), weights.length ? weights : [total]);

        groups.forEach((group, i) => {
          const gross = fromCents(parts[i]);
          const share = group.net + group.tax !== 0 ? group.tax / (group.net + group.tax) : 0;
          const tax = Math.round(gross * share * 100) / 100;

          builder.add(target, gross - tax, {
            ...this.taxLineExtra(invoice, group.taxCode, group.rate, 'base'),
            tenantId,
          });

          if (group.taxCode.accountId && toCents(tax) !== 0) {
            builder.add(group.taxCode.accountId, tax, {
              ...this.taxLineExtra(invoice, group.taxCode, group.rate, 'tax'),
              tenantId,
            });
          }
        });

        if (groups.length === 0) {
          builder.add(target, amountF, { tenantId });
        }

        builder.add(receivables, -amountF, arExtra);
        description = `${settlement.type === SettlementType.WRITE_OFF ? 'Write-off' : 'Cash discount'} ${invoice.invoiceNumber ?? ''}`;
        break;
      }

      case SettlementType.CREDIT_TRANSFER_IN: {
        if (!settlement.relatedDocumentId) {
          return null;
        }

        const amountF = invoiceConv(amount);

        builder.add(receivables, amountF, { ...party, openItemId: settlement.relatedDocumentId, tenantId });
        builder.add(receivables, -amountF, arExtra);
        description = `Customer credit applied to ${invoice.invoiceNumber ?? ''}`;
        break;
      }

      default:
        return null;
    }

    return this.entry({
      documentDate: date,
      documentNumber: invoice.invoiceNumber ?? null,
      description: description.trim(),
      sourceType: JournalSourceType.SETTLEMENT,
      sourceId: settlement.id,
      sourceEvent: settlement.type,
      tenantId,
      currency: invoice.currency,
      fxRate: cashConv.rate,
      lines: await this.balance(manager, chartId, builder),
      links: [
        { linkType: JournalLinkType.SETTLEMENT, targetId: settlement.id, role: JournalLinkRole.SOURCE },
        { linkType: JournalLinkType.INVOICE, targetId: invoice.id, role: JournalLinkRole.SETTLES },
        ...(settlement.paymentAttemptId
          ? [
              {
                linkType: JournalLinkType.PAYMENT_ATTEMPT,
                targetId: settlement.paymentAttemptId,
                role: JournalLinkRole.RELATED,
              },
            ]
          : []),
        ...(settlement.paymentRefundId
          ? [
              {
                linkType: JournalLinkType.PAYMENT_REFUND,
                targetId: settlement.paymentRefundId,
                role: JournalLinkRole.RELATED,
              },
            ]
          : []),
        ...(settlement.bankTransactionId
          ? [
              {
                linkType: JournalLinkType.BANK_TRANSACTION,
                targetId: settlement.bankTransactionId,
                role: JournalLinkRole.RECEIPT,
              },
            ]
          : []),
        ...(settlement.relatedDocumentId
          ? [
              {
                linkType: JournalLinkType.INVOICE,
                targetId: settlement.relatedDocumentId,
                role: JournalLinkRole.RELATED,
              },
            ]
          : []),
      ],
    });
  }

  private async buildSupplierInvoiceEntry(
    manager: EntityManager,
    invoice: SupplierInvoiceEntity,
    sign: 1 | -1,
    event: string,
    date: string,
  ): Promise<PostEntryInput | null> {
    if (sign === 1 && this.beforeStart(date)) {
      return null;
    }

    const chartId = await this.chartFor(date, manager);
    const supplier = await manager
      .getRepository(SupplierProfileEntity)
      .findOneOrFail({ where: { id: invoice.supplierId } });
    const tenantId = supplier.tenantId;
    const lines = await manager.getRepository(SupplierInvoiceLineItemEntity).find({ where: { invoiceId: invoice.id } });
    const conv = await this.fxFor(invoice.currency, toBookingDate(invoice.issueDate ?? invoice.issuedAt), manager);
    const builder = new EntryBuilder();
    const party = {
      counterpartyType: CounterpartyType.SUPPLIER,
      counterpartyId: supplier.id,
      euVatId: invoice.supplierVatId ?? null,
    };
    const reverseCharge = this.supplierReverseChargeCode(invoice);
    const defaultExpense = await this.supplierExpenseAccount(manager, chartId, supplier, reverseCharge);

    for (const line of lines) {
      const net = conv(Number(line.lineNet));
      const accountId =
        (sign === 1 ? await this.capitalizedAccount(manager, chartId, invoice, line, net, date, tenantId) : null) ??
        (await this.lineAccount(manager, chartId, line)) ??
        defaultExpense;
      const rate = Number(line.taxRate);

      if (reverseCharge) {
        const taxCode = await this.requireTaxCode(manager, chartId, reverseCharge);
        const rcRate = taxCode.rate != null ? Number(taxCode.rate) : 0;
        const rcTax = Math.round(net * rcRate) / 100;

        builder.addFx(accountId, conv, sign * Number(line.lineNet), {
          taxCodeId: taxCode.id,
          taxRate: rcRate,
          taxRole: 'base',
          tenantId,
          description: line.description,
        });

        if (taxCode.accountId && taxCode.reverseAccountId && toCents(rcTax) !== 0) {
          builder.add(taxCode.accountId, sign * rcTax, {
            taxCodeId: taxCode.id,
            taxRate: rcRate,
            taxRole: 'reverse_tax',
            tenantId,
          });
          builder.add(taxCode.reverseAccountId, -sign * rcTax, {
            taxCodeId: taxCode.id,
            taxRate: rcRate,
            taxRole: 'tax',
            tenantId,
          });
        }

        continue;
      }

      const taxCode = await this.inputTaxCode(manager, chartId, rate);

      builder.addFx(accountId, conv, sign * Number(line.lineNet), {
        taxCodeId: taxCode.id,
        taxRate: rate,
        taxRole: 'base',
        tenantId,
        description: line.description,
      });

      if (taxCode.accountId && toCents(Number(line.lineTax)) !== 0) {
        builder.addFx(taxCode.accountId, conv, sign * Number(line.lineTax), {
          taxCodeId: taxCode.id,
          taxRate: rate,
          taxRole: 'tax',
          tenantId,
        });
      }
    }

    const payable = reverseCharge ? Number(invoice.subtotalNet) : Number(invoice.totalGross);

    builder.addFx(await this.role(manager, chartId, R.PAYABLES), conv, -sign * payable, {
      ...party,
      openItemId: invoice.id,
      tenantId,
    });

    return this.entry({
      documentDate: date,
      documentNumber: invoice.invoiceNumber ?? null,
      description:
        `${sign === 1 ? 'Supplier invoice' : 'Cancellation of supplier invoice'} ${invoice.invoiceNumber ?? ''}`.trim(),
      sourceType: JournalSourceType.SUPPLIER_INVOICE,
      sourceId: invoice.id,
      sourceEvent: event,
      tenantId,
      currency: invoice.currency,
      fxRate: conv.rate,
      lines: await this.balance(manager, chartId, builder),
      links: [{ linkType: JournalLinkType.SUPPLIER_INVOICE, targetId: invoice.id, role: JournalLinkRole.SOURCE }],
    });
  }

  private async buildSupplierSettlementEntry(
    manager: EntityManager,
    settlement: DocumentSettlementEntity,
  ): Promise<PostEntryInput | null> {
    const date = toBookingDate(settlement.occurredAt);

    if (this.beforeStart(date)) {
      return null;
    }

    const invoice = await manager
      .getRepository(SupplierInvoiceEntity)
      .findOneOrFail({ where: { id: settlement.documentId } });
    const supplier = await manager
      .getRepository(SupplierProfileEntity)
      .findOneOrFail({ where: { id: invoice.supplierId } });
    const chartId = await this.chartFor(date, manager);
    const payables = await this.role(manager, chartId, R.PAYABLES);
    const invoiceConv = await this.fxFor(
      invoice.currency,
      toBookingDate(invoice.issueDate ?? invoice.issuedAt),
      manager,
    );
    const cashConv = await this.fxFor(invoice.currency, date, manager);
    const amount = Number(settlement.amount);
    const builder = new EntryBuilder();
    const apExtra = {
      counterpartyType: CounterpartyType.SUPPLIER,
      counterpartyId: supplier.id,
      openItemId: invoice.id,
      tenantId: supplier.tenantId,
    };

    if (
      settlement.type === SettlementType.PAYMENT ||
      settlement.type === SettlementType.PAYMENT_REVERSAL ||
      settlement.type === SettlementType.REFUND
    ) {
      const outflow = settlement.type === SettlementType.PAYMENT ? 1 : -1;
      const cashAccount = await this.cashAccountFor(manager, chartId, settlement);

      builder.addFx(payables, invoiceConv, outflow * amount, apExtra);
      builder.addFx(cashAccount, cashConv, -outflow * amount, { tenantId: supplier.tenantId });
      await this.addFxDifference(manager, chartId, builder, supplier.tenantId);
    } else if (settlement.type === SettlementType.DISCOUNT) {
      const discount = await this.role(manager, chartId, R.CASH_DISCOUNTS_RECEIVED);
      const amountF = invoiceConv(amount);

      builder.add(payables, amountF, apExtra);

      if (this.supplierReverseChargeCode(invoice)) {
        // Reverse charge: no input VAT was paid to the supplier; the discount only reduces the expense.
        builder.add(discount, -amountF, { tenantId: supplier.tenantId });
      } else {
        // Input VAT correction (§ 17 UStG) per tax rate of the invoice, with tax codes so it reaches the VAT return.
        const lines = await manager
          .getRepository(SupplierInvoiceLineItemEntity)
          .find({ where: { invoiceId: invoice.id } });
        const byRate = new Map<number, { net: number; tax: number }>();

        for (const line of lines) {
          const rate = Number(line.taxRate);
          const group = byRate.get(rate) ?? { net: 0, tax: 0 };

          group.net += Number(line.lineNet);
          group.tax += Number(line.lineTax);
          byRate.set(rate, group);
        }

        const groups = [...byRate.entries()].filter(([, g]) => g.net + g.tax !== 0);
        const parts = allocateCents(toCents(amountF), groups.length ? groups.map(([, g]) => g.net + g.tax) : [1]);

        if (groups.length === 0) {
          builder.add(discount, -amountF, { tenantId: supplier.tenantId });
        }

        for (const [i, [rate, group]] of groups.entries()) {
          const gross = fromCents(parts[i]);
          const tax = Math.round(gross * (group.tax / (group.net + group.tax)) * 100) / 100;
          const taxCode = await this.inputTaxCode(manager, chartId, rate);

          builder.add(discount, -(gross - tax), {
            taxCodeId: taxCode.id,
            taxRate: rate,
            taxRole: 'base',
            tenantId: supplier.tenantId,
          });

          if (taxCode.accountId && toCents(tax) !== 0) {
            builder.add(taxCode.accountId, -tax, {
              taxCodeId: taxCode.id,
              taxRate: rate,
              taxRole: 'tax',
              tenantId: supplier.tenantId,
            });
          }
        }
      }
    } else {
      return null;
    }

    return this.entry({
      documentDate: date,
      documentNumber: invoice.invoiceNumber ?? null,
      description: `Supplier ${settlement.type.replace('_', ' ')} ${invoice.invoiceNumber ?? ''}`.trim(),
      sourceType: JournalSourceType.SETTLEMENT,
      sourceId: settlement.id,
      sourceEvent: settlement.type,
      tenantId: supplier.tenantId,
      currency: invoice.currency,
      fxRate: cashConv.rate,
      lines: await this.balance(manager, chartId, builder),
      links: [
        { linkType: JournalLinkType.SETTLEMENT, targetId: settlement.id, role: JournalLinkRole.SOURCE },
        { linkType: JournalLinkType.SUPPLIER_INVOICE, targetId: invoice.id, role: JournalLinkRole.SETTLES },
        ...(settlement.bankTransactionId
          ? [
              {
                linkType: JournalLinkType.BANK_TRANSACTION,
                targetId: settlement.bankTransactionId,
                role: JournalLinkRole.RECEIPT,
              },
            ]
          : []),
      ],
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Posts inside a savepoint; failures are recorded as posting issues (never propagated to billing). Every accounting
   * statement — the idempotency lookup, the posting and the issue bookkeeping — runs in its own savepoint: in Postgres a
   * failed statement would otherwise abort the surrounding billing transaction.
   */
  async safely(
    manager: EntityManager,
    sourceType: JournalSourceType,
    sourceId: string,
    event: string,
    build: () => Promise<PostEntryInput | null>,
  ): Promise<void> {
    if (!this.config.isEnabled()) {
      return;
    }

    const key = AccountingJournalService.automaticKey(sourceType, sourceId, event);

    try {
      await this.inSavepoint(manager, async () => {
        if (await this.journal.findByKey(key, manager)) {
          await this.resolveIssue(manager, key);

          return;
        }

        const input = await build();

        if (input && input.lines.length > 0) {
          // Zero-value documents (e.g. fully discounted invoices) have nothing to book.
          await this.journal.post({ ...input, idempotencyKey: key }, manager);
        }

        await this.resolveIssue(manager, key);
      });
    } catch (error) {
      const message = (error as Error).message ?? String(error);

      this.logger.warn(`Posting ${key} failed: ${message}`);

      try {
        await this.inSavepoint(manager, async () => {
          await this.recordIssue(manager, key, sourceType, sourceId, event, message);
        });
      } catch (issueError) {
        this.logger.error(`Could not record posting issue ${key}: ${(issueError as Error).message}`);
      }
    }
  }

  /** Runs `work` in a savepoint of the active transaction (rolled back on failure, then rethrown). */
  private async inSavepoint(manager: EntityManager, work: () => Promise<void>): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
      await work();

      return;
    }

    const savepoint = `acc_${Math.random().toString(36).slice(2, 10)}`;

    await manager.query(`SAVEPOINT ${savepoint}`);

    try {
      await work();
      await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (error) {
      await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  private async resolveIssue(manager: EntityManager, key: string): Promise<void> {
    await manager.query(
      `UPDATE billing_accounting_posting_issues SET resolved_at = now(), updated_at = now()
       WHERE idempotency_key = $1 AND resolved_at IS NULL`,
      [key],
    );
  }

  private async recordIssue(
    manager: EntityManager,
    key: string,
    sourceType: JournalSourceType,
    sourceId: string,
    event: string,
    error: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO billing_accounting_posting_issues (idempotency_key, source_type, source_id, source_event, error)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO UPDATE
         SET error = EXCLUDED.error, attempts = billing_accounting_posting_issues.attempts + 1,
             resolved_at = NULL, updated_at = now()`,
      [key, sourceType, sourceId, event.slice(0, 48), error.slice(0, 4000)],
    );
  }

  private entry(input: Omit<PostEntryInput, 'kind'>): PostEntryInput {
    return { ...input, kind: JournalEntryKind.AUTOMATIC };
  }

  private beforeStart(date: string): boolean {
    return date < this.config.getConfig().startDate;
  }

  private async chartFor(date: string, manager: EntityManager): Promise<string> {
    const target = await this.fiscalYears.resolvePostingTarget(date, manager);

    return target.fiscalYear.chartId;
  }

  private async role(manager: EntityManager, chartId: string, role: R): Promise<string> {
    return (await this.charts.requireAccountByRole(chartId, role, manager)).id;
  }

  private async customerTenant(manager: EntityManager, userId: string): Promise<string | null> {
    const rows: Array<{ tenant_id: string }> = await manager.query(`SELECT tenant_id FROM users WHERE id = $1`, [
      userId,
    ]);

    return rows[0]?.tenant_id ?? null;
  }

  private customerParty(invoice: InvoiceEntity) {
    return {
      counterpartyType: CounterpartyType.CUSTOMER,
      counterpartyId: invoice.userId,
      euVatId: invoice.buyerVatId ?? null,
    };
  }

  private taxLineExtra(
    invoice: InvoiceEntity,
    taxCode: AccountingTaxCodeEntity,
    rate: number,
    role: 'base' | 'tax',
  ): Partial<JournalLineInput> {
    const euCountry =
      taxCode.oss || taxCode.ecSalesList ? (invoice.taxCountryCode ?? invoice.buyerCountry ?? null) : null;

    return {
      taxCodeId: taxCode.id,
      taxRate: rate,
      taxRole: role,
      euCountry,
      euVatId: taxCode.ecSalesList ? (invoice.buyerVatId ?? null) : null,
    };
  }

  /** Groups invoice lines by tax code and rate (net and tax summed from the frozen line amounts). */
  private async outputGroups(
    manager: EntityManager,
    chartId: string,
    invoice: InvoiceEntity,
    lines: InvoiceLineItemEntity[],
  ): Promise<TaxGroup[]> {
    const groups = new Map<string, TaxGroup>();

    for (const line of lines) {
      const rate = Number(line.taxRate);
      const taxCode = await this.outputTaxCode(manager, chartId, invoice.taxMode ?? null, rate);
      const key = `${taxCode.id}:${rate}`;
      const group = groups.get(key) ?? {
        taxCode,
        rate,
        net: 0,
        tax: 0,
        accountId: await this.revenueAccountFor(manager, chartId, taxCode),
      };

      group.net = fromCents(toCents(group.net) + toCents(Number(line.lineNet)));
      group.tax = fromCents(toCents(group.tax) + toCents(Number(line.lineTax)));
      groups.set(key, group);
    }

    return [...groups.values()];
  }

  /** Output tax code from the invoice's frozen tax mode and the line rate. */
  async outputTaxCode(
    manager: EntityManager,
    chartId: string,
    taxMode: TaxMode | string | null,
    rate: number,
  ): Promise<AccountingTaxCodeEntity> {
    switch (taxMode) {
      case TaxMode.EU_REVERSE_CHARGE:
        return await this.requireTaxCode(manager, chartId, C.OUT_EU_REVERSE_CHARGE);
      case TaxMode.EU_B2C_OSS:
      case TaxMode.NON_EU_ISSUER_EU_B2C:
        return await this.requireTaxCode(manager, chartId, C.OUT_OSS);
      case TaxMode.THIRD_COUNTRY_B2B_NO_VAT:
      case TaxMode.THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT:
        return await this.requireTaxCode(manager, chartId, C.OUT_EXPORT_SERVICES);
      case TaxMode.NON_EU_ISSUER_EU_B2B:
        if (rate === 0) {
          return await this.requireTaxCode(manager, chartId, C.OUT_NON_TAXABLE);
        }

        break;
      default:
        break;
    }

    if (rate === 0) {
      return (
        (await this.charts.findTaxCode(chartId, C.OUT_ZERO, manager)) ??
        (await this.requireTaxCode(manager, chartId, C.OUT_EXPORT_SERVICES))
      );
    }

    return await this.taxCodeByRate(
      manager,
      chartId,
      rate,
      [TaxCodeKind.OUTPUT],
      [C.OUT_STANDARD, C.OUT_REDUCED, C.OUT_REDUCED_2],
    );
  }

  private async inputTaxCode(manager: EntityManager, chartId: string, rate: number): Promise<AccountingTaxCodeEntity> {
    if (rate === 0) {
      return await this.requireTaxCode(manager, chartId, C.IN_NONE);
    }

    return await this.taxCodeByRate(manager, chartId, rate, [TaxCodeKind.INPUT], [C.IN_STANDARD, C.IN_REDUCED]);
  }

  private async taxCodeByRate(
    manager: EntityManager,
    chartId: string,
    rate: number,
    kinds: TaxCodeKind[],
    preferred: string[],
  ): Promise<AccountingTaxCodeEntity> {
    const codes = (await this.charts.listTaxCodes(chartId, manager)).filter(
      (c) => c.isActive && kinds.includes(c.kind) && !c.oss,
    );
    const matches = codes.filter((c) => c.rate != null && Math.abs(Number(c.rate) - rate) < 0.001);
    const chosen = matches.sort((a, b) => {
      const ia = preferred.indexOf(a.code);
      const ib = preferred.indexOf(b.code);

      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })[0];

    if (!chosen) {
      throw new Error(`No active ${kinds.join('/')} tax code with rate ${rate} % in the chart; add one`);
    }

    return chosen;
  }

  private async requireTaxCode(
    manager: EntityManager,
    chartId: string,
    code: string,
  ): Promise<AccountingTaxCodeEntity> {
    const taxCode = await this.charts.findTaxCode(chartId, code, manager);

    if (!taxCode || !taxCode.isActive) {
      throw new Error(`Tax code ${code} is missing or inactive in the chart of accounts`);
    }

    return taxCode;
  }

  /** Revenue account: the automatic account of the tax code, else the role mapped to the canonical code. */
  private async revenueAccountFor(
    manager: EntityManager,
    chartId: string,
    taxCode: AccountingTaxCodeEntity,
  ): Promise<string> {
    const automatic = await manager.getRepository(AccountingAccountEntity).findOne({
      where: { chartId, defaultTaxCodeId: taxCode.id, isActive: true },
      order: { number: 'ASC' },
    });

    if (automatic && ['revenue'].includes(automatic.type)) {
      return automatic.id;
    }

    return await this.role(manager, chartId, REVENUE_ROLE_BY_TAX_CODE[taxCode.code] ?? R.REVENUE_STANDARD);
  }

  private supplierReverseChargeCode(invoice: SupplierInvoiceEntity): string | null {
    // Supplier invoices without VAT from foreign entrepreneurs: the recipient owes the VAT (§ 13b / Art. 196 VAT Directive).
    if (Number(invoice.taxTotal) !== 0) {
      return null;
    }

    switch (invoice.taxMode) {
      case TaxMode.EU_REVERSE_CHARGE:
        return C.RC_EU_SERVICES;
      case TaxMode.THIRD_COUNTRY_B2B_NO_VAT:
      case TaxMode.NON_EU_ISSUER_EU_B2B:
        return C.RC_THIRD_COUNTRY;
      default:
        return null;
    }
  }

  private async supplierExpenseAccount(
    manager: EntityManager,
    chartId: string,
    supplier: SupplierProfileEntity,
    reverseCharge: string | null,
  ): Promise<string> {
    const configured = supplier.defaultExpenseAccountNumber
      ? await this.charts.findAccountByNumber(chartId, supplier.defaultExpenseAccountNumber, manager)
      : null;

    if (configured?.isActive) {
      return configured.id;
    }

    if (reverseCharge === C.RC_EU_SERVICES) {
      return await this.role(manager, chartId, R.EXPENSE_REVERSE_CHARGE_EU);
    }

    if (reverseCharge === C.RC_THIRD_COUNTRY) {
      return await this.role(manager, chartId, R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY);
    }

    return await this.role(manager, chartId, R.EXPENSE_DEFAULT);
  }

  /**
   * Capitalized lines go to the asset account chosen by the register classification (GWG / pool / fixed asset);
   * lines of stock articles go to inventory (perpetual valuation).
   */
  private async capitalizedAccount(
    manager: EntityManager,
    chartId: string,
    invoice: SupplierInvoiceEntity,
    line: SupplierInvoiceLineItemEntity,
    net: number,
    date: string,
    tenantId: string | null,
  ): Promise<string | null> {
    if (line.capitalizeAsAsset) {
      const existing = (await this.assets.findBySupplierLines([line.id]))[0];
      const asset =
        existing ??
        (await this.assets.create(
          {
            name: line.description || `Asset from ${invoice.invoiceNumber ?? invoice.id}`,
            acquisitionDate: date,
            acquisitionCost: net,
            usefulLifeMonths: line.assetUsefulLifeMonths ?? undefined,
            tenantId,
            supplierInvoiceId: invoice.id,
            supplierInvoiceLineId: line.id,
          },
          manager,
        ));
      const account = await this.charts.findAccountByNumber(chartId, asset.assetAccountNumber, manager);

      if (!account) {
        throw new Error(`Asset account ${asset.assetAccountNumber} is missing in the chart of accounts`);
      }

      return account.id;
    }

    if (line.inventoryArticleId) {
      return await this.role(manager, chartId, R.INVENTORY);
    }

    return null;
  }

  private async lineAccount(
    manager: EntityManager,
    chartId: string,
    line: SupplierInvoiceLineItemEntity,
  ): Promise<string | null> {
    if (!line.ledgerAccountNumber) {
      return null;
    }

    const account = await this.charts.findAccountByNumber(chartId, line.ledgerAccountNumber, manager);

    if (!account || !account.isActive) {
      throw new Error(`Line account ${line.ledgerAccountNumber} does not exist in the chart of accounts`);
    }

    return account.id;
  }

  /** Cash / clearing account of a payment: bank line's account, processor clearing, or the bank role. */
  private async cashAccountFor(
    manager: EntityManager,
    chartId: string,
    settlement: DocumentSettlementEntity,
  ): Promise<string> {
    if (settlement.bankTransactionId) {
      const rows: Array<{ ledger_account_number: string | null }> = await manager.query(
        `SELECT fa.ledger_account_number FROM billing_accounting_bank_transactions bt
         JOIN billing_accounting_financial_accounts fa ON fa.id = bt.financial_account_id
         WHERE bt.id = $1`,
        [settlement.bankTransactionId],
      );
      const number = rows[0]?.ledger_account_number;

      if (number) {
        const account = await this.charts.findAccountByNumber(chartId, number, manager);

        if (account?.isActive) {
          return account.id;
        }
      }
    }

    if (
      settlement.source === SettlementSource.PROCESSOR_WEBHOOK ||
      settlement.source === SettlementSource.AUTO_CHARGE ||
      settlement.source === SettlementSource.PROCESSOR_SYNC ||
      settlement.processor
    ) {
      return await this.role(manager, chartId, R.PROCESSOR_CLEARING);
    }

    return await this.role(manager, chartId, R.BANK);
  }

  private async fxFor(currency: string, date: string, manager: EntityManager): Promise<DocumentFxConversion> {
    const conversion = await this.fx.convert(1, currency, date, manager);
    const rate = conversion.rate;
    const fn = ((amount: number) =>
      rate === 1 ? amount : Math.round((amount / rate) * 100) / 100) as DocumentFxConversion;

    fn.rate = rate;
    fn.currency = currency.toUpperCase();
    fn.foreign = fn.currency !== this.config.getConfig().functionalCurrency.toUpperCase();

    return fn;
  }

  /** Books exchange differences of a settlement (cash at today's rate vs. open item at the invoice rate). */
  private async addFxDifference(
    manager: EntityManager,
    chartId: string,
    builder: EntryBuilder,
    tenantId: string | null,
  ): Promise<void> {
    const diff = builder.imbalanceCents();

    if (diff === 0) {
      return;
    }

    // Debits exceed credits → the difference is income; otherwise an expense.
    const account = await this.role(manager, chartId, diff > 0 ? R.FX_GAIN : R.FX_LOSS);

    builder.add(account, -fromCents(diff), { tenantId });
  }

  /** Puts rounding differences (≤ 0.05 per entry, from FX conversion of single lines) on the rounding account. */
  private async balance(manager: EntityManager, chartId: string, builder: EntryBuilder): Promise<JournalLineInput[]> {
    const diff = builder.imbalanceCents();

    if (diff !== 0) {
      if (Math.abs(diff) > 5) {
        throw new Error(`Booking is unbalanced by ${fromCents(diff)} (document totals do not match its lines)`);
      }

      builder.add(await this.role(manager, chartId, R.ROUNDING), -fromCents(diff));
    }

    return builder.lines;
  }

  /** Used by the catch-up job: whether an automatic entry exists. */
  async hasEntry(sourceType: JournalSourceType, sourceId: string, event: string): Promise<boolean> {
    return Boolean(await this.journal.findByKey(AccountingJournalService.automaticKey(sourceType, sourceId, event)));
  }

  async entryFor(
    sourceType: JournalSourceType,
    sourceId: string,
    event: string,
  ): Promise<AccountingJournalEntryEntity | null> {
    return await this.journal.findByKey(AccountingJournalService.automaticKey(sourceType, sourceId, event));
  }

  /** Runs a posting outside an existing transaction (catch-up, retries). */
  async runStandalone(fn: (manager: EntityManager) => Promise<void>): Promise<void> {
    await this.dataSource.transaction(fn);
  }
}
