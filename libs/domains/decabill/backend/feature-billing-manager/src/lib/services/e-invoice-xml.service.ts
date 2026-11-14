import { Injectable } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';

import type { BillingIssuerConfig } from './billing-issuer-config.service';
import { assertCustomerPostalAddress, resolveCustomerPostalAddress } from './customer-postal-address.util';
import type { EInvoiceDocumentOptions } from './e-invoice-document-options';
import type { InvoicingPeriod } from './invoicing-period.util';
import { deliveryTermsFromColumns, formatDeliveryTerms, formatPaymentTerms } from '../utils/document-terms.utils';

@Injectable()
export class EInvoiceXmlService {
  buildEn16931Xml(
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    purchaseOrderReference: string,
    invoicingPeriod: InvoicingPeriod,
    documentOptions: EInvoiceDocumentOptions,
  ): string {
    const issueDate = documentOptions.issueDate.toISOString().slice(0, 10);
    const buyerName =
      buyer.company?.trim() || [buyer.firstName, buyer.lastName].filter(Boolean).join(' ').trim() || 'Customer';

    assertCustomerPostalAddress(buyer);
    const buyerAddress = resolveCustomerPostalAddress(buyer)!;
    const exchangedDocument = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('rsm:CrossIndustryInvoice', {
        'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
        'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
        'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
      })
      .ele('rsm:ExchangedDocumentContext')
      .ele('ram:GuidelineSpecifiedDocumentContextParameter')
      .ele('ram:ID')
      .txt('urn:cen.eu:en16931:2017')
      .up()
      .up()
      .up()
      .ele('rsm:ExchangedDocument')
      .ele('ram:ID')
      .txt(documentOptions.documentId)
      .up()
      .ele('ram:TypeCode')
      .txt(documentOptions.typeCode)
      .up()
      .ele('ram:IssueDateTime')
      .ele('udt:DateTimeString', { format: '102' })
      .txt(issueDate.replace(/-/g, ''))
      .up()
      .up();

    const deliveryTermsNote = documentOptions.includeDocumentTerms
      ? formatDeliveryTerms(deliveryTermsFromColumns(invoice))
      : undefined;

    if (deliveryTermsNote) {
      // BT-21/BT-22 invoice note; UNTDID 4451 subject code AAR = terms of delivery (EN16931 has no dedicated term).
      exchangedDocument
        .ele('ram:IncludedNote')
        .ele('ram:Content')
        .txt(deliveryTermsNote)
        .up()
        .ele('ram:SubjectCode')
        .txt('AAR')
        .up()
        .up();
    }

    const doc = exchangedDocument.up().ele('rsm:SupplyChainTradeTransaction');

    for (const line of lineItems) {
      const categoryCode = String(invoice.einvoiceTaxCategoryCode ?? 'S');
      doc
        .ele('ram:IncludedSupplyChainTradeLineItem')
        .ele('ram:AssociatedDocumentLineDocument')
        .ele('ram:LineID')
        .txt(String(line.position + 1))
        .up()
        .up()
        .ele('ram:SpecifiedTradeProduct')
        .ele('ram:Name')
        .txt(line.description)
        .up()
        .up()
        .ele('ram:SpecifiedLineTradeAgreement')
        .ele('ram:NetPriceProductTradePrice')
        .ele('ram:ChargeAmount')
        .txt(this.formatPrice(line.unitPriceNet))
        .up()
        .up()
        .up()
        .ele('ram:SpecifiedLineTradeDelivery')
        .ele('ram:BilledQuantity', { unitCode: 'C62' })
        .txt(String(line.quantity))
        .up()
        .up()
        .ele('ram:SpecifiedLineTradeSettlement')
        .ele('ram:ApplicableTradeTax')
        .ele('ram:TypeCode')
        .txt('VAT')
        .up()
        .ele('ram:CategoryCode')
        .txt(categoryCode)
        .up()
        .ele('ram:RateApplicablePercent')
        .txt(String(line.taxRate))
        .up()
        .up()
        .ele('ram:SpecifiedTradeSettlementLineMonetarySummation')
        .ele('ram:LineTotalAmount')
        .txt(this.formatAmount(line.lineNet))
        .up()
        .up()
        .up()
        .up();
    }

    let chain = doc
      .ele('ram:ApplicableHeaderTradeAgreement')
      .ele('ram:SellerTradeParty')
      .ele('ram:Name')
      .txt(issuer.name)
      .up()
      .ele('ram:PostalTradeAddress')
      .ele('ram:PostcodeCode')
      .txt(issuer.postalCode)
      .up()
      .ele('ram:LineOne')
      .txt(issuer.addressLine1)
      .up()
      .ele('ram:CityName')
      .txt(issuer.city)
      .up()
      .ele('ram:CountryID')
      .txt(issuer.country)
      .up()
      .up()
      .ele('ram:SpecifiedTaxRegistration')
      .ele('ram:ID', { schemeID: 'VA' })
      .txt(issuer.vatId)
      .up()
      .up()
      .up()
      .ele('ram:BuyerTradeParty')
      .ele('ram:Name')
      .txt(buyerName)
      .up()
      .ele('ram:PostalTradeAddress')
      .ele('ram:PostcodeCode')
      .txt(buyerAddress.postalCode)
      .up()
      .ele('ram:LineOne')
      .txt(buyerAddress.street)
      .up();

    if (buyerAddress.streetLine2) {
      chain = chain.ele('ram:LineTwo').txt(buyerAddress.streetLine2).up();
    }

    chain = chain
      .ele('ram:CityName')
      .txt(buyerAddress.city)
      .up()
      .ele('ram:CountryID')
      .txt(buyerAddress.country)
      .up()
      .up();

    const buyerVatId = (invoice.buyerVatId ?? buyer.vatId)?.trim();

    if (buyerVatId) {
      chain = chain.ele('ram:SpecifiedTaxRegistration').ele('ram:ID', { schemeID: 'VA' }).txt(buyerVatId).up().up();
    }

    chain = chain
      .up()
      .ele('ram:BuyerOrderReferencedDocument')
      .ele('ram:IssuerAssignedID')
      .txt(purchaseOrderReference.trim())
      .up()
      .up()
      .up()
      .ele('ram:ApplicableHeaderTradeDelivery')
      .ele('ram:ActualDeliverySupplyChainEvent')
      .ele('ram:OccurrenceDateTime')
      .ele('udt:DateTimeString', { format: '102' })
      .txt(this.formatDate102(invoicingPeriod.periodEnd))
      .up()
      .up()
      .up()
      .up()
      .ele('ram:ApplicableHeaderTradeSettlement')
      .ele('ram:InvoiceCurrencyCode')
      .txt(invoice.currency)
      .up();

    // Children follow the CII HeaderTradeSettlement sequence: payment means → tax → billing period → payment
    // terms → monetary summation → referenced invoice.
    if (documentOptions.includePaymentMeans) {
      chain = this.appendPaymentMeans(chain, issuer);
    }

    const headerCategory = String(invoice.einvoiceTaxCategoryCode ?? 'S');
    const headerRate =
      invoice.resolvedTaxRate != null ? String(invoice.resolvedTaxRate) : String(lineItems[0]?.taxRate ?? 0);

    let taxBlock = chain
      .ele('ram:ApplicableTradeTax')
      .ele('ram:CalculatedAmount')
      .txt(this.formatAmount(invoice.taxTotal))
      .up()
      .ele('ram:TypeCode')
      .txt('VAT')
      .up();

    if (invoice.taxNote?.trim()) {
      taxBlock = taxBlock.ele('ram:ExemptionReason').txt(invoice.taxNote.trim()).up();
    }

    chain = taxBlock
      .ele('ram:BasisAmount')
      .txt(this.formatAmount(invoice.subtotalNet))
      .up()
      .ele('ram:CategoryCode')
      .txt(headerCategory)
      .up()
      .ele('ram:RateApplicablePercent')
      .txt(headerRate)
      .up()
      .up();

    chain = this.appendBillingPeriod(chain, invoicingPeriod);

    if (documentOptions.includeDocumentTerms || documentOptions.paymentTermsDescription) {
      chain = this.appendPaymentTerms(chain, invoice, documentOptions);
    }

    let summation = chain
      .ele('ram:SpecifiedTradeSettlementHeaderMonetarySummation')
      .ele('ram:LineTotalAmount')
      .txt(this.formatAmount(invoice.subtotalNet))
      .up()
      .ele('ram:TaxBasisTotalAmount')
      .txt(this.formatAmount(invoice.subtotalNet))
      .up()
      .ele('ram:TaxTotalAmount', { currencyID: invoice.currency })
      .txt(this.formatAmount(invoice.taxTotal))
      .up()
      .ele('ram:GrandTotalAmount')
      .txt(this.formatAmount(invoice.totalGross))
      .up();

    // BR-CO-16: amount due = total − paid amount; promotions / earlier payments / voids reduce the amount due.
    const grandTotalCents = this.toCents(invoice.totalGross);
    const dueCents = this.toCents(documentOptions.duePayableAmount);

    if (grandTotalCents !== dueCents) {
      summation = summation
        .ele('ram:TotalPrepaidAmount')
        .txt(((grandTotalCents - dueCents) / 100).toFixed(2))
        .up();
    }

    chain = summation
      .ele('ram:DuePayableAmount')
      .txt((dueCents / 100).toFixed(2))
      .up()
      .up();

    if (documentOptions.referencedInvoiceNumber) {
      chain
        .ele('ram:InvoiceReferencedDocument')
        .ele('ram:IssuerAssignedID')
        .txt(documentOptions.referencedInvoiceNumber)
        .up()
        .up();
    }

    return doc.end({ prettyPrint: true });
  }

  private appendBillingPeriod(settlement: XMLBuilder, invoicingPeriod: InvoicingPeriod): XMLBuilder {
    return settlement
      .ele('ram:BillingSpecifiedPeriod')
      .ele('ram:StartDateTime')
      .ele('udt:DateTimeString', { format: '102' })
      .txt(this.formatDate102(invoicingPeriod.periodStart))
      .up()
      .up()
      .ele('ram:EndDateTime')
      .ele('udt:DateTimeString', { format: '102' })
      .txt(this.formatDate102(invoicingPeriod.periodEnd))
      .up()
      .up()
      .up();
  }

  /** BT-20 payment terms (+ BT-9 due date on invoices); satisfies BR-CO-25 for positive amounts due. */
  private appendPaymentTerms(
    settlement: XMLBuilder,
    invoice: InvoiceEntity,
    documentOptions: EInvoiceDocumentOptions,
  ): XMLBuilder {
    const description =
      documentOptions.paymentTermsDescription ??
      (documentOptions.includeDocumentTerms ? formatPaymentTerms(invoice.paymentDueDays) : undefined);
    const dueDate = documentOptions.includeDueDate ? this.toDate(invoice.dueDate) : undefined;

    if (!description && !dueDate) {
      return settlement;
    }

    let terms = settlement.ele('ram:SpecifiedTradePaymentTerms');

    if (description) {
      terms = terms.ele('ram:Description').txt(description).up();
    }

    if (dueDate) {
      terms = terms
        .ele('ram:DueDateDateTime')
        .ele('udt:DateTimeString', { format: '102' })
        .txt(this.formatDate102(dueDate))
        .up()
        .up();
    }

    return terms.up();
  }

  private toDate(value: Date | string | null | undefined): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /** Monetary amounts: exactly two decimals (BR-DEC-*). */
  private formatAmount(value: number | string | null | undefined): string {
    return (this.toCents(value) / 100).toFixed(2);
  }

  /** Unit prices (BT-146) may carry more decimals; strip trailing zeros of the decimal(12,4) column. */
  private formatPrice(value: number | string | null | undefined): string {
    const parsed = Number(value ?? 0);

    return String(Number.isFinite(parsed) ? parsed : 0);
  }

  private toCents(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);

    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }

  private formatDate102(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private appendPaymentMeans(settlement: XMLBuilder, issuer: BillingIssuerConfig): XMLBuilder {
    const iban = this.normalizeIban(issuer.iban);

    if (!iban) {
      return settlement;
    }

    let paymentMeans = settlement.ele('ram:SpecifiedTradeSettlementPaymentMeans');

    paymentMeans = paymentMeans.ele('ram:TypeCode').txt('58').up();
    paymentMeans = paymentMeans.ele('ram:Information').txt('SEPA credit transfer').up();

    let account = paymentMeans.ele('ram:PayeePartyCreditorFinancialAccount');

    account = account.ele('ram:IBANID').txt(iban).up();

    const bankName = issuer.bank?.trim();

    if (bankName) {
      account = account.ele('ram:AccountName').txt(bankName).up();
    }

    paymentMeans = account.up();

    const bic = issuer.bic?.trim().toUpperCase();

    if (bic) {
      paymentMeans = paymentMeans
        .ele('ram:PayeeSpecifiedCreditorFinancialInstitution')
        .ele('ram:BICID')
        .txt(bic)
        .up()
        .up();
    }

    return paymentMeans.up();
  }

  private normalizeIban(iban: string | undefined): string | undefined {
    if (!iban?.trim()) {
      return undefined;
    }

    return iban.replace(/\s+/g, '').toUpperCase();
  }
}
