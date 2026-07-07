import { Injectable } from '@nestjs/common';

import { TaxCategory } from '../constants/tax-category.constants';
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
    const revenueAccount =
      params.line.taxCategory === TaxCategory.REDUCED
        ? params.config.revenueAccountReduced
        : params.config.revenueAccountStandard;
    const buKey =
      params.line.taxCategory === TaxCategory.REDUCED ? params.config.buKeyReduced : params.config.buKeyStandard;

    return this.toRow({
      amountGross: Number(params.line.lineGross),
      debitCredit: 'S',
      debtorAccount: params.debtorAccount,
      revenueAccount,
      buKey,
      documentDate: params.invoice.issuedAt ?? params.invoice.createdAt,
      documentNumber: params.invoice.invoiceNumber ?? params.invoice.id,
      bookingText: this.buildBookingText(params.line.description, params.scope, params.tenantSlug),
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
    const revenueAccount =
      params.line.taxCategory === TaxCategory.REDUCED
        ? params.config.revenueAccountReduced
        : params.config.revenueAccountStandard;
    const buKey =
      params.line.taxCategory === TaxCategory.REDUCED ? params.config.buKeyReduced : params.config.buKeyStandard;
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
      bookingText: this.buildBookingText(params.line.description, params.scope, params.tenantSlug),
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
    const revenueAccount =
      params.credit.taxCategory === TaxCategory.REDUCED
        ? params.config.revenueAccountReduced
        : params.config.revenueAccountStandard;
    const buKey =
      params.credit.taxCategory === TaxCategory.REDUCED ? params.config.buKeyReduced : params.config.buKeyStandard;
    const bookingText = params.credit.description?.trim() || `Withdrawal credit ${params.credit.documentNumber}`;

    return this.toRow({
      amountGross: Number(params.credit.creditGross),
      debitCredit: 'H',
      debtorAccount: params.debtorAccount,
      revenueAccount,
      buKey,
      documentDate: params.credit.withdrawnAt,
      documentNumber: params.credit.documentNumber,
      bookingText: this.buildBookingText(bookingText, params.scope, params.tenantSlug),
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

  private buildBookingText(description: string, scope: DatevExportScope, tenantSlug?: string): string {
    const base = description.trim();

    if (scope === DatevExportScope.UNIFIED && tenantSlug) {
      return truncateDatevText(`[${tenantSlug}] ${base}`, 60);
    }

    return truncateDatevText(base, 60);
  }
}
