import { Injectable } from '@nestjs/common';

import { TaxCategory } from '../constants/tax-category.constants';
import { TaxMode } from '../constants/tax-mode.constants';
import { DatevExportScope, DATEV_BOOKING_ROW_FIELD_COUNT } from '../constants/datev-export.constants';
import type { InvoiceCreditDocumentEntity } from '../entities/invoice-credit-document.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { formatDatevAmount, formatDatevDate, truncateDatevText } from '../utils/datev-format.util';
import { buildCreditNoteNumber } from './e-invoice-document-options';
import type { DatevTenantExportConfig } from './datev-export-config.service';

export interface DatevBookingRowInput {
  amountGross: number;
  debitCredit: 'S' | 'H';
  debtorAccount: number;
  revenueAccount: string;
  buKey: string;
  documentDate: Date;
  documentNumber: string;
  bookingText: string;
  documentLink?: string;
}

@Injectable()
export class DatevBookingMapperService {
  mapIssuedLineItem(params: {
    line: InvoiceLineItemEntity;
    invoice: InvoiceEntity;
    debtorAccount: number;
    config: DatevTenantExportConfig;
    scope: DatevExportScope;
    tenantSlug?: string;
    documentLink?: string;
  }): string[] {
    const { revenueAccount, buKey } = this.resolveAccounts(params.invoice, params.line.taxCategory, params.config);

    return this.toRow({
      amountGross: Number(params.line.lineGross),
      debitCredit: 'S',
      debtorAccount: params.debtorAccount,
      revenueAccount,
      buKey,
      documentDate: params.invoice.issuedAt ?? params.invoice.createdAt,
      documentNumber: params.invoice.invoiceNumber ?? params.invoice.id,
      bookingText: this.buildBookingText(
        params.line.description,
        params.scope,
        params.tenantSlug,
        params.invoice.buyerVatId,
      ),
      documentLink: params.documentLink,
    });
  }

  mapVoidedLineItem(params: {
    line: InvoiceLineItemEntity;
    invoice: InvoiceEntity;
    debtorAccount: number;
    config: DatevTenantExportConfig;
    scope: DatevExportScope;
    tenantSlug?: string;
    voidedAt: Date;
    documentLink?: string;
  }): string[] {
    const { revenueAccount, buKey } = this.resolveAccounts(params.invoice, params.line.taxCategory, params.config);
    const creditNoteNumber = params.invoice.invoiceNumber
      ? buildCreditNoteNumber(params.invoice.invoiceNumber)
      : `${params.invoice.id}-CN`;

    return this.toRow({
      amountGross: Number(params.line.lineGross),
      debitCredit: 'H',
      debtorAccount: params.debtorAccount,
      revenueAccount,
      buKey,
      documentDate: params.voidedAt,
      documentNumber: creditNoteNumber,
      bookingText: this.buildBookingText(
        params.line.description,
        params.scope,
        params.tenantSlug,
        params.invoice.buyerVatId,
      ),
      documentLink: params.documentLink,
    });
  }

  mapPartialCreditDocument(params: {
    credit: InvoiceCreditDocumentEntity;
    invoice: InvoiceEntity;
    debtorAccount: number;
    config: DatevTenantExportConfig;
    scope: DatevExportScope;
    tenantSlug?: string;
    documentLink?: string;
  }): string[] {
    const { revenueAccount, buKey } = this.resolveAccounts(
      params.invoice,
      params.credit.taxCategory as TaxCategory,
      params.config,
    );
    const bookingText = params.credit.description?.trim() || `Withdrawal credit ${params.credit.documentNumber}`;

    return this.toRow({
      amountGross: Number(params.credit.creditGross),
      debitCredit: 'H',
      debtorAccount: params.debtorAccount,
      revenueAccount,
      buKey,
      documentDate: params.credit.withdrawnAt,
      documentNumber: params.credit.documentNumber,
      bookingText: this.buildBookingText(bookingText, params.scope, params.tenantSlug, params.invoice.buyerVatId),
      documentLink: params.documentLink,
    });
  }

  toRow(input: DatevBookingRowInput): string[] {
    const fields = Array.from({ length: DATEV_BOOKING_ROW_FIELD_COUNT }, () => '');

    fields[0] = formatDatevAmount(input.amountGross);
    fields[1] = input.debitCredit;
    fields[2] = 'EUR';
    fields[6] = String(input.debtorAccount);
    fields[7] = input.revenueAccount;
    fields[8] = input.buKey;
    fields[9] = formatDatevDate(input.documentDate);
    fields[10] = input.documentNumber;
    fields[13] = truncateDatevText(input.bookingText, 60);

    if (input.documentLink) {
      fields[19] = input.documentLink;
    }

    return fields;
  }

  private resolveAccounts(
    invoice: InvoiceEntity,
    taxCategory: TaxCategory | string,
    config: DatevTenantExportConfig,
  ): { revenueAccount: string; buKey: string } {
    const mode = invoice.taxMode;

    if (mode === TaxMode.EU_REVERSE_CHARGE) {
      return { revenueAccount: config.revenueAccountReverseCharge, buKey: config.buKeyReverseCharge };
    }

    if (mode === TaxMode.EU_B2C_OSS || mode === TaxMode.NON_EU_ISSUER_EU_B2C) {
      return { revenueAccount: config.revenueAccountOss, buKey: config.buKeyOss };
    }

    if (
      mode === TaxMode.THIRD_COUNTRY_B2B_NO_VAT ||
      mode === TaxMode.THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT ||
      mode === TaxMode.NON_EU_ISSUER_EU_B2B
    ) {
      return { revenueAccount: config.revenueAccountThirdCountry, buKey: config.buKeyThirdCountry };
    }

    if (taxCategory === TaxCategory.REDUCED) {
      return { revenueAccount: config.revenueAccountReduced, buKey: config.buKeyReduced };
    }

    return { revenueAccount: config.revenueAccountStandard, buKey: config.buKeyStandard };
  }

  private buildBookingText(
    description: string,
    scope: DatevExportScope,
    tenantSlug?: string,
    buyerVatId?: string | null,
  ): string {
    const parts: string[] = [];

    if (scope === DatevExportScope.UNIFIED && tenantSlug) {
      parts.push(`[${tenantSlug}]`);
    }

    parts.push(description.trim());

    if (buyerVatId?.trim()) {
      parts.push(`VAT ${buyerVatId.trim()}`);
    }

    return truncateDatevText(parts.filter(Boolean).join(' '), 60);
  }
}
