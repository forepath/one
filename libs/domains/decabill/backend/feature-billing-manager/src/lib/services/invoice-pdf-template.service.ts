import { Injectable, Optional } from '@nestjs/common';
import * as Handlebars from 'handlebars';

import { AccountingConfigService } from '../accounting/services/accounting-config.service';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { loadInvoicePdfTemplate } from '../templates/invoice-pdf-template.loader';
import { resolveCountryDisplayName } from '../utils/country-display-name.util';
import { normalizeDocumentNote } from '../utils/document-note.utils';
import { deliveryTermsFromColumns, formatDeliveryTerms, formatPaymentTerms } from '../utils/document-terms.utils';
import { buildEpcQrDataUri } from '../utils/epc-qr.util';
import { formatPaymentReference } from '../utils/payment-reference.util';

import {
  BillingDocumentBrandingConfigService,
  DEFAULT_DOCUMENT_BRANDING,
  NEUTRAL_DOCUMENT_BRANDING,
} from './billing-document-branding-config.service';
import type { BillingIssuerConfig } from './billing-issuer-config.service';
import { formatAmount, formatDate, formatServicePeriod, toAmount } from './invoice-pdf-amount.util';
import type { InvoicePdfPresentationOptions } from './invoice-pdf-presentation.util';
import { buildInvoicePdfPresentation } from './invoice-pdf-presentation.util';
import type {
  InvoicePdfAddressView,
  InvoicePdfPaymentDetailsView,
  InvoicePdfViewModel,
} from './invoice-pdf-view.model';

@Injectable()
export class InvoicePdfTemplateService {
  private readonly compiledTemplate = Handlebars.compile(loadInvoicePdfTemplate());

  constructor(
    @Optional() private readonly accountingConfig?: AccountingConfigService,
    @Optional() private readonly brandingConfig?: BillingDocumentBrandingConfigService,
  ) {}

  buildHtml(
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    presentation: InvoicePdfPresentationOptions = buildInvoicePdfPresentation(invoice),
    authenticityShortSha?: string,
  ): string {
    return this.compiledTemplate(
      this.buildViewModel(invoice, lineItems, issuer, buyer, presentation, authenticityShortSha),
    );
  }

  buildViewModel(
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    presentation: InvoicePdfPresentationOptions = buildInvoicePdfPresentation(invoice),
    authenticityShortSha?: string,
  ): InvoicePdfViewModel {
    const basePaymentDetails = presentation.includePaymentDetails ? this.buildPaymentDetails(issuer) : undefined;
    const paymentDetails =
      basePaymentDetails && invoice.paymentReference && presentation.showBalanceDue
        ? { ...basePaymentDetails, paymentReference: formatPaymentReference(invoice.paymentReference) }
        : basePaymentDetails;
    const servicePeriod = formatServicePeriod(presentation.servicePeriod);
    const epcQrDataUri =
      paymentDetails && presentation.includePaymentQr && presentation.showBalanceDue
        ? buildEpcQrDataUri({
            beneficiaryName: issuer.name,
            iban: issuer.iban,
            bic: issuer.bic,
            currency: invoice.currency,
            amount: invoice.balanceDue,
            remittanceText: presentation.documentNumber,
            // EPC allows either the structured RF reference or free text. RF only pays off with bank reconciliation
            // (accounting); without it payers keep seeing the invoice number, which manual matching relies on.
            creditorReference: this.accountingConfig?.isEnabled() ? (invoice.paymentReference ?? undefined) : undefined,
          })
        : undefined;
    const paymentTerms =
      presentation.paymentTermsText ??
      (presentation.includeDocumentTerms ? formatPaymentTerms(invoice.paymentDueDays) : undefined);
    const deliveryTerms = presentation.includeDocumentTerms
      ? formatDeliveryTerms(deliveryTermsFromColumns(invoice))
      : undefined;
    const note = normalizeDocumentNote(presentation.note);

    return {
      documentTitle: presentation.documentTitle,
      documentNumberLabel: presentation.documentNumberLabel,
      invoiceNumber: presentation.documentNumber,
      issueDate: formatDate(presentation.issueDate) ?? '',
      dueDate: presentation.showDueDate ? formatDate(invoice.dueDate) : undefined,
      referencedInvoiceNumber: presentation.referencedInvoiceNumber,
      showDueDate: presentation.showDueDate,
      showBalanceDue: presentation.showBalanceDue,
      statusLabel: this.formatStatusLabel(invoice.status),
      currency: invoice.currency,
      issuer: this.buildIssuerAddress(issuer),
      buyer: this.buildBuyerAddress(buyer, invoice),
      lineItems: lineItems.map((line) => ({
        position: line.position + 1,
        description: line.description,
        quantity: formatAmount(line.quantity),
        unitPriceNet: formatAmount(line.unitPriceNet),
        taxRate: toAmount(line.taxRate).toFixed(2),
        lineNet: formatAmount(line.lineNet),
        lineTax: formatAmount(line.lineTax),
        lineGross: formatAmount(line.lineGross),
      })),
      subtotalNet: formatAmount(invoice.subtotalNet),
      taxTotal: formatAmount(invoice.taxTotal),
      totalGross: formatAmount(invoice.totalGross),
      balanceDue: presentation.showBalanceDue ? formatAmount(invoice.balanceDue) : '0.00',
      taxNote: invoice.taxNote?.trim() || undefined,
      taxModeLabel: invoice.taxMode?.replace(/_/g, ' ') || undefined,
      ...(paymentDetails ? { paymentDetails } : {}),
      ...(servicePeriod ? { servicePeriodLabel: servicePeriod.label, servicePeriod: servicePeriod.value } : {}),
      ...(paymentTerms ? { paymentTerms } : {}),
      ...(deliveryTerms ? { deliveryTerms } : {}),
      showDocumentTerms: Boolean(paymentTerms || deliveryTerms),
      ...(note ? { note } : {}),
      ...(epcQrDataUri ? { epcQrDataUri } : {}),
      ...(authenticityShortSha ? { authenticityShortSha } : {}),
      branding:
        presentation.ownBranding === false
          ? NEUTRAL_DOCUMENT_BRANDING
          : (this.brandingConfig?.getBranding() ?? DEFAULT_DOCUMENT_BRANDING),
    };
  }

  private buildIssuerAddress(issuer: BillingIssuerConfig): InvoicePdfAddressView {
    const countryLine = resolveCountryDisplayName(issuer.country);
    const lines = [`${issuer.addressLine1}`, `${issuer.postalCode} ${issuer.city}`, countryLine ?? ''].filter(
      (line) => line.trim().length > 0,
    );

    return {
      name: issuer.name,
      lines,
      vatId: issuer.vatId,
      email: issuer.email?.trim() || undefined,
    };
  }

  private buildBuyerAddress(buyer: CustomerProfileEntity, invoice?: InvoiceEntity): InvoicePdfAddressView {
    const name =
      buyer.company?.trim() || [buyer.firstName, buyer.lastName].filter(Boolean).join(' ').trim() || 'Customer';
    const lines: string[] = [];

    if (buyer.addressLine1?.trim()) {
      lines.push(buyer.addressLine1.trim());
    }

    if (buyer.addressLine2?.trim()) {
      lines.push(buyer.addressLine2.trim());
    }

    const cityLine = [buyer.postalCode, buyer.city].filter(Boolean).join(' ').trim();

    if (cityLine) {
      lines.push(cityLine);
    }

    const buyerCountry = resolveCountryDisplayName(buyer.country);

    if (buyerCountry) {
      lines.push(buyerCountry);
    }

    return {
      name,
      lines,
      vatId: (invoice?.buyerVatId ?? buyer.vatId)?.trim() || undefined,
      email: buyer.email?.trim() || undefined,
    };
  }

  private buildPaymentDetails(issuer: BillingIssuerConfig): InvoicePdfPaymentDetailsView | undefined {
    const bank = issuer.bank?.trim();
    const iban = issuer.iban?.trim();
    const bic = issuer.bic?.trim();

    if (!bank && !iban && !bic) {
      return undefined;
    }

    return {
      bank: bank || undefined,
      iban: iban || undefined,
      bic: bic || undefined,
    };
  }

  private formatStatusLabel(status: InvoiceStatus | undefined): string {
    if (!status) {
      return InvoiceStatus.ISSUED;
    }

    return status.replace(/_/g, ' ');
  }
}
