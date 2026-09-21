import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';

import type { CustomerProfileEntity } from '../../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../../entities/invoice.entity';
import type { OfferEntity } from '../entities/offer.entity';
import type { OfferLineItemEntity } from '../entities/offer-line-item.entity';
import { loadOfferPdfTemplate } from '../templates/offer-pdf-template.loader';
import { resolveCountryDisplayName } from '../../utils/country-display-name.util';
import type { BillingIssuerConfig } from '../../services/billing-issuer-config.service';
import { formatAmount, formatDate, toAmount } from '../../services/invoice-pdf-amount.util';
import type { OfferPdfPresentationOptions } from './offer-pdf-presentation.util';
import { buildOfferPdfPresentation } from './offer-pdf-presentation.util';

export interface OfferPdfViewModel {
  documentTitle: string;
  documentNumberLabel: string;
  invoiceNumber: string;
  issueDate: string;
  expiresAt?: string;
  showExpiresAt: boolean;
  showDueDate: boolean;
  showBalanceDue: boolean;
  statusLabel: string;
  currency: string;
  issuer: {
    name: string;
    lines: string[];
    vatId?: string;
    email?: string;
  };
  buyer: {
    name: string;
    lines: string[];
    vatId?: string;
    email?: string;
  };
  lineItems: Array<{
    position: number;
    description: string;
    quantity: string;
    unitPriceNet: string;
    taxRate: string;
    lineNet: string;
    lineTax: string;
    lineGross: string;
  }>;
  subtotalNet: string;
  taxTotal: string;
  totalGross: string;
  balanceDue: string;
  taxNote?: string;
  taxModeLabel?: string;
}

@Injectable()
export class OfferPdfTemplateService {
  private readonly compiledTemplate = Handlebars.compile(loadOfferPdfTemplate());

  buildHtml(
    offer: OfferEntity,
    lineItems: OfferLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    presentation: OfferPdfPresentationOptions = buildOfferPdfPresentation(offer),
  ): string {
    return this.compiledTemplate(this.buildViewModel(offer, lineItems, issuer, buyer, presentation));
  }

  buildViewModel(
    offer: OfferEntity,
    lineItems: OfferLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    presentation: OfferPdfPresentationOptions = buildOfferPdfPresentation(offer),
  ): OfferPdfViewModel {
    return {
      documentTitle: presentation.documentTitle,
      documentNumberLabel: presentation.documentNumberLabel,
      invoiceNumber: presentation.documentNumber,
      issueDate: formatDate(presentation.issueDate) ?? '',
      expiresAt: presentation.showExpiresAt ? formatDate(presentation.expiresAt) : undefined,
      showExpiresAt: presentation.showExpiresAt,
      showDueDate: false,
      showBalanceDue: false,
      statusLabel: offer.status,
      currency: offer.currency,
      issuer: this.buildIssuerAddress(issuer),
      buyer: this.buildBuyerAddress(buyer, offer),
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
      subtotalNet: formatAmount(offer.subtotalNet),
      taxTotal: formatAmount(offer.taxTotal),
      totalGross: formatAmount(offer.totalGross),
      balanceDue: '0.00',
      taxNote: offer.taxNote?.trim() || undefined,
      taxModeLabel: offer.taxMode?.replace(/_/g, ' ') || undefined,
    };
  }

  private buildIssuerAddress(issuer: BillingIssuerConfig): OfferPdfViewModel['issuer'] {
    const countryLine = resolveCountryDisplayName(issuer.country);
    const lines = [`${issuer.addressLine1}`, `${issuer.postalCode} ${issuer.city}`, countryLine ?? ''].filter(
      (line) => line.trim().length > 0,
    );

    return {
      name: issuer.name,
      lines,
      vatId: issuer.vatId?.trim() || undefined,
      email: issuer.email?.trim() || undefined,
    };
  }

  private buildBuyerAddress(buyer: CustomerProfileEntity, offer: OfferEntity): OfferPdfViewModel['buyer'] {
    const name =
      buyer.company?.trim() || [buyer.firstName, buyer.lastName].filter(Boolean).join(' ').trim() || 'Customer';
    const countryLine = resolveCountryDisplayName(buyer.country);
    const lines = [`${buyer.addressLine1}`, `${buyer.postalCode} ${buyer.city}`, countryLine ?? ''].filter(
      (line) => line.trim().length > 0,
    );

    return {
      name,
      lines,
      vatId: offer.buyerVatId?.trim() || buyer.vatId?.trim() || undefined,
      email: buyer.email?.trim() || undefined,
    };
  }
}

export function mapOfferLinesToInvoiceLineItems(
  offerId: string,
  lines: OfferLineItemEntity[],
): InvoiceLineItemEntity[] {
  return lines.map(
    (line) =>
      ({
        id: line.id,
        invoiceId: offerId,
        position: line.position,
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        taxCategory: line.taxCategory,
        taxRate: line.taxRate,
        lineNet: line.lineNet,
        lineTax: line.lineTax,
        lineGross: line.lineGross,
      }) as InvoiceLineItemEntity,
  );
}

export function mapOfferToInvoiceDocument(offer: OfferEntity): InvoiceEntity {
  return {
    id: offer.id,
    userId: offer.userId,
    status: 'draft',
    currency: offer.currency,
    subtotalNet: offer.subtotalNet,
    taxTotal: offer.taxTotal,
    totalGross: offer.totalGross,
    balanceDue: offer.totalGross,
    taxMode: offer.taxMode,
    taxCountryCode: offer.taxCountryCode,
    taxNote: offer.taxNote,
    einvoiceTaxCategoryCode: offer.einvoiceTaxCategoryCode,
    resolvedTaxRate: offer.resolvedTaxRate,
    buyerVatId: offer.buyerVatId,
    buyerCountry: offer.buyerCountry,
    buyerCustomerType: offer.buyerCustomerType,
    issuerCountry: offer.issuerCountry,
    issuerIsInEu: offer.issuerIsInEu,
    invoiceNumber: offer.offerNumber ?? undefined,
    issuedAt: offer.archivedAt ?? undefined,
    createdAt: offer.createdAt,
  } as InvoiceEntity;
}
