import { Injectable } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces';

import { EAS_VAT_SCHEME_BY_COUNTRY, type EInvoiceFormatDefinition } from '../constants/e-invoice-format.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { normalizeDocumentNote } from '../utils/document-note.utils';
import { formatPaymentTerms } from '../utils/document-terms.utils';

import type { BillingIssuerConfig } from './billing-issuer-config.service';
import { assertCustomerPostalAddress, resolveCustomerPostalAddress } from './customer-postal-address.util';
import type { EInvoiceDocumentOptions } from './e-invoice-document-options';
import type { InvoicingPeriod } from './invoicing-period.util';

const NS_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const NS_CREDIT_NOTE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

/**
 * UBL 2.1 Invoice / CreditNote per EN 16931 (XRechnung UBL, Peppol BIS Billing 3.0, plain EN 16931). Built from
 * the same frozen invoice data as the embedded CII. Credit notes (type 381) use the CreditNote document as Peppol
 * requires.
 */
@Injectable()
export class EInvoiceUblService {
  build(
    definition: EInvoiceFormatDefinition,
    invoice: InvoiceEntity,
    lineItems: InvoiceLineItemEntity[],
    issuer: BillingIssuerConfig,
    buyer: CustomerProfileEntity,
    purchaseOrderReference: string,
    invoicingPeriod: InvoicingPeriod,
    options: EInvoiceDocumentOptions,
  ): string {
    assertCustomerPostalAddress(buyer);

    const isCredit = options.typeCode === '381';
    const root = isCredit ? 'CreditNote' : 'Invoice';
    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(isCredit ? NS_CREDIT_NOTE : NS_INVOICE, root, {
      'xmlns:cac': NS_CAC,
      'xmlns:cbc': NS_CBC,
    });
    const currency = invoice.currency;
    const cbc = (parent: XMLBuilder, name: string, value: string, attrs?: Record<string, string>): XMLBuilder =>
      parent.ele(NS_CBC, `cbc:${name}`, attrs).txt(value).up();

    cbc(doc, 'CustomizationID', definition.customizationId);

    if (definition.profileId) {
      cbc(doc, 'ProfileID', definition.profileId);
    }

    cbc(doc, 'ID', options.documentId);
    cbc(doc, 'IssueDate', options.issueDate.toISOString().slice(0, 10));

    if (!isCredit && options.includeDueDate && invoice.dueDate) {
      cbc(doc, 'DueDate', new Date(invoice.dueDate).toISOString().slice(0, 10));
    }

    cbc(
      doc,
      isCredit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode',
      options.typeCode === '325' ? '380' : options.typeCode,
    );

    const note = normalizeDocumentNote(options.note);

    if (note) {
      cbc(doc, 'Note', note);
    }

    if (invoice.taxNote?.trim()) {
      cbc(doc, 'Note', invoice.taxNote.trim());
    }

    cbc(doc, 'DocumentCurrencyCode', currency);

    const buyerReference = buyer.buyerReference?.trim() || purchaseOrderReference.trim();

    cbc(doc, 'BuyerReference', buyerReference);

    const period = doc.ele(NS_CAC, 'cac:InvoicePeriod');

    cbc(period, 'StartDate', invoicingPeriod.periodStart.toISOString().slice(0, 10));
    cbc(period, 'EndDate', invoicingPeriod.periodEnd.toISOString().slice(0, 10));

    const order = doc.ele(NS_CAC, 'cac:OrderReference');

    cbc(order, 'ID', purchaseOrderReference.trim() || options.documentId);

    if (options.referencedInvoiceNumber) {
      const billing = doc.ele(NS_CAC, 'cac:BillingReference').ele(NS_CAC, 'cac:InvoiceDocumentReference');

      cbc(billing, 'ID', options.referencedInvoiceNumber);
    }

    this.party(doc, 'cac:AccountingSupplierParty', {
      name: issuer.name,
      street: issuer.addressLine1,
      city: issuer.city,
      postalCode: issuer.postalCode,
      country: issuer.country,
      vatId: issuer.vatId,
      email: issuer.email,
      endpoint: this.endpoint(issuer.vatId, issuer.country, issuer.email),
      requireEndpoint: definition.requiresEndpoints,
    });

    const address = resolveCustomerPostalAddress(buyer)!;
    const buyerName =
      buyer.company?.trim() || [buyer.firstName, buyer.lastName].filter(Boolean).join(' ').trim() || 'Customer';
    const buyerVat = (invoice.buyerVatId ?? buyer.vatId)?.trim() || undefined;

    this.party(doc, 'cac:AccountingCustomerParty', {
      name: buyerName,
      street: address.street,
      street2: address.streetLine2,
      city: address.city,
      postalCode: address.postalCode,
      country: address.country,
      vatId: buyerVat,
      email: buyer.email ?? undefined,
      endpoint:
        this.explicitEndpoint(buyer.einvoiceEndpoint) ??
        this.endpoint(buyerVat, address.country, buyer.email ?? undefined),
      requireEndpoint: definition.requiresEndpoints,
    });

    const delivery = doc.ele(NS_CAC, 'cac:Delivery');

    cbc(delivery, 'ActualDeliveryDate', invoicingPeriod.periodEnd.toISOString().slice(0, 10));

    const iban = (issuer.iban ?? '').replace(/\s/g, '').toUpperCase();

    if (options.includePaymentMeans && iban) {
      const means = doc.ele(NS_CAC, 'cac:PaymentMeans');

      cbc(means, 'PaymentMeansCode', '58', { name: 'SEPA credit transfer' });

      if (invoice.paymentReference) {
        cbc(means, 'PaymentID', invoice.paymentReference);
      }

      const account = means.ele(NS_CAC, 'cac:PayeeFinancialAccount');

      cbc(account, 'ID', iban);

      if (issuer.bank?.trim()) {
        cbc(account, 'Name', issuer.bank.trim());
      }

      if (issuer.bic?.trim()) {
        cbc(account.ele(NS_CAC, 'cac:FinancialInstitutionBranch'), 'ID', issuer.bic.trim().toUpperCase());
      }
    }

    const termsText =
      options.paymentTermsDescription ??
      (options.includeDocumentTerms ? formatPaymentTerms(invoice.paymentDueDays) : undefined);

    if (termsText) {
      cbc(doc.ele(NS_CAC, 'cac:PaymentTerms'), 'Note', termsText);
    }

    const category = String(invoice.einvoiceTaxCategoryCode ?? 'S');
    const groups = this.taxGroups(lineItems, invoice);
    const taxTotal = doc.ele(NS_CAC, 'cac:TaxTotal');

    cbc(taxTotal, 'TaxAmount', this.amount(invoice.taxTotal), { currencyID: currency });

    for (const group of groups) {
      const sub = taxTotal.ele(NS_CAC, 'cac:TaxSubtotal');

      cbc(sub, 'TaxableAmount', this.amount(group.basis), { currencyID: currency });
      cbc(sub, 'TaxAmount', this.amount(group.tax), { currencyID: currency });

      const cat = sub.ele(NS_CAC, 'cac:TaxCategory');

      cbc(cat, 'ID', category);
      cbc(cat, 'Percent', group.rate);

      if (category !== 'S' && invoice.taxNote?.trim()) {
        cbc(cat, 'TaxExemptionReason', invoice.taxNote.trim());
      }

      cbc(cat.ele(NS_CAC, 'cac:TaxScheme'), 'ID', 'VAT');
    }

    const totals = doc.ele(NS_CAC, 'cac:LegalMonetaryTotal');
    const dueCents = Math.round(Number(options.duePayableAmount) * 100);
    const grossCents = Math.round(Number(invoice.totalGross) * 100);

    cbc(totals, 'LineExtensionAmount', this.amount(invoice.subtotalNet), { currencyID: currency });
    cbc(totals, 'TaxExclusiveAmount', this.amount(invoice.subtotalNet), { currencyID: currency });
    cbc(totals, 'TaxInclusiveAmount', this.amount(invoice.totalGross), { currencyID: currency });

    if (grossCents !== dueCents) {
      cbc(totals, 'PrepaidAmount', ((grossCents - dueCents) / 100).toFixed(2), { currencyID: currency });
    }

    cbc(totals, 'PayableAmount', (dueCents / 100).toFixed(2), { currencyID: currency });

    for (const line of lineItems) {
      const el = doc.ele(NS_CAC, isCredit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine');

      cbc(el, 'ID', String(line.position + 1));
      cbc(el, isCredit ? 'CreditedQuantity' : 'InvoicedQuantity', String(Number(line.quantity)), { unitCode: 'C62' });
      cbc(el, 'LineExtensionAmount', this.amount(line.lineNet), { currencyID: currency });

      const item = el.ele(NS_CAC, 'cac:Item');

      cbc(item, 'Name', (line.description || 'Item').slice(0, 255));

      const cat = item.ele(NS_CAC, 'cac:ClassifiedTaxCategory');

      cbc(cat, 'ID', category);
      cbc(cat, 'Percent', String(Number(line.taxRate)));
      cbc(cat.ele(NS_CAC, 'cac:TaxScheme'), 'ID', 'VAT');

      cbc(el.ele(NS_CAC, 'cac:Price'), 'PriceAmount', String(Number(line.unitPriceNet)), { currencyID: currency });
    }

    return doc.end({ prettyPrint: true });
  }

  private party(
    doc: XMLBuilder,
    element: string,
    p: {
      name: string;
      street: string;
      street2?: string | null;
      city: string;
      postalCode: string;
      country: string;
      vatId?: string;
      email?: string;
      endpoint?: { scheme: string; id: string } | null;
      requireEndpoint: boolean;
    },
  ): void {
    const party = doc.ele(NS_CAC, element).ele(NS_CAC, 'cac:Party');
    const cbc = (parent: XMLBuilder, name: string, value: string, attrs?: Record<string, string>): XMLBuilder =>
      parent.ele(NS_CBC, `cbc:${name}`, attrs).txt(value).up();

    if (p.endpoint) {
      cbc(party, 'EndpointID', p.endpoint.id, { schemeID: p.endpoint.scheme });
    } else if (p.requireEndpoint) {
      throw new Error(
        `An electronic address (EndpointID) is required for ${p.name}; set the customer's e-invoice endpoint`,
      );
    }

    cbc(party.ele(NS_CAC, 'cac:PartyName'), 'Name', p.name);

    const address = party.ele(NS_CAC, 'cac:PostalAddress');

    cbc(address, 'StreetName', p.street);

    if (p.street2) {
      cbc(address, 'AdditionalStreetName', p.street2);
    }

    cbc(address, 'CityName', p.city);
    cbc(address, 'PostalZone', p.postalCode);
    cbc(address.ele(NS_CAC, 'cac:Country'), 'IdentificationCode', p.country.toUpperCase());

    if (p.vatId) {
      const tax = party.ele(NS_CAC, 'cac:PartyTaxScheme');

      cbc(tax, 'CompanyID', p.vatId);
      cbc(tax.ele(NS_CAC, 'cac:TaxScheme'), 'ID', 'VAT');
    }

    cbc(party.ele(NS_CAC, 'cac:PartyLegalEntity'), 'RegistrationName', p.name);

    if (p.email) {
      cbc(party.ele(NS_CAC, 'cac:Contact'), 'ElectronicMail', p.email);
    }
  }

  /** VAT-number endpoint with the country's EAS scheme, else e-mail (`EM`, XRechnung) when known. */
  private endpoint(
    vatId: string | undefined | null,
    country: string,
    email?: string | null,
  ): { scheme: string; id: string } | null {
    const scheme = EAS_VAT_SCHEME_BY_COUNTRY[(country ?? '').toUpperCase()];

    if (vatId?.trim() && scheme) {
      return { scheme, id: vatId.replace(/\s/g, '').toUpperCase() };
    }

    if (email?.trim()) {
      return { scheme: 'EM', id: email.trim() };
    }

    return null;
  }

  /** `scheme:id` set on the customer profile (e.g. `0088:4012345000009`, `0204:991-12345-67`). */
  private explicitEndpoint(value: string | null | undefined): { scheme: string; id: string } | null {
    const match = /^([0-9A-Z]{2,4}):(.{1,128})$/.exec((value ?? '').trim());

    return match ? { scheme: match[1], id: match[2] } : null;
  }

  private taxGroups(
    lineItems: InvoiceLineItemEntity[],
    invoice: InvoiceEntity,
  ): Array<{ rate: string; basis: number; tax: number }> {
    const groups = new Map<string, { rate: string; basis: number; tax: number }>();

    for (const line of lineItems) {
      const rate = String(Number(line.taxRate));
      const g = groups.get(rate) ?? { rate, basis: 0, tax: 0 };

      g.basis = Math.round((g.basis + Number(line.lineNet)) * 100) / 100;
      g.tax = Math.round((g.tax + Number(line.lineTax)) * 100) / 100;
      groups.set(rate, g);
    }

    return groups.size > 0
      ? [...groups.values()]
      : [
          {
            rate: String(Number(invoice.resolvedTaxRate ?? 0)),
            basis: Number(invoice.subtotalNet),
            tax: Number(invoice.taxTotal),
          },
        ];
  }

  private amount(value: number | string | null | undefined): string {
    return (Math.round(Number(value ?? 0) * 100) / 100).toFixed(2);
  }
}
