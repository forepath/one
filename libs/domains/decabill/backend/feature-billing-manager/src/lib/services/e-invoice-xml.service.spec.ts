import { DeliveryTermsCode } from '../constants/document-terms.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';

import {
  buildCreditNoteDocumentOptions,
  buildInvoiceDocumentOptions,
  buildOfferDocumentOptions,
  buildPartialCreditNoteDocumentOptions,
  buildZeroBalancePromotionalInvoiceDocumentOptions,
} from './e-invoice-document-options';
import { EInvoiceXmlService } from './e-invoice-xml.service';

describe('EInvoiceXmlService', () => {
  const service = new EInvoiceXmlService();
  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'INV-2026-00001',
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 19,
    totalGross: 119,
    balanceDue: 119,
    issuedAt: new Date('2026-06-01T12:00:00Z'),
    createdAt: new Date('2026-06-01T10:00:00Z'),
  } as InvoiceEntity;
  const lineItems = [
    {
      position: 0,
      description: 'Hosting June',
      quantity: 1,
      unitPriceNet: 100,
      taxRate: 19,
      lineNet: 100,
      lineTax: 19,
      lineGross: 119,
      taxCategory: TaxCategory.STANDARD,
    },
  ] as InvoiceLineItemEntity[];
  const issuer = {
    name: 'Forepath GmbH',
    vatId: 'DE999',
    addressLine1: 'Main St 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
  };
  const purchaseOrderReference = 'SUB-2026-00001';
  const invoicingPeriod = {
    periodStart: new Date('2026-05-01T00:00:00Z'),
    periodEnd: new Date('2026-06-01T00:00:00Z'),
  };
  const buyer = {
    firstName: 'Jane',
    lastName: 'Doe',
    company: null,
    addressLine1: 'Buyer St 2',
    postalCode: '20095',
    city: 'Hamburg',
    country: 'DE',
  } as CustomerProfileEntity;

  it('builds EN 16931 XML with invoice and party data', () => {
    const xml = service.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      buildInvoiceDocumentOptions(invoice),
    );

    expect(xml).toContain('urn:cen.eu:en16931:2017');
    expect(xml).toContain('INV-2026-00001');
    expect(xml).toContain('Forepath GmbH');
    expect(xml).toContain('Jane Doe');
    expect(xml).toContain('Hosting June');
    expect(xml).toContain('<ram:GrandTotalAmount');
    expect(xml).toContain('119');
    const buyerParty = xml.match(/<ram:BuyerTradeParty>[\s\S]*?<\/ram:BuyerTradeParty>/)?.[0];

    expect(buyerParty).toBeDefined();
    expect(buyerParty).toContain('<ram:PostalTradeAddress>');
    expect(buyerParty).toContain('<ram:LineOne>Buyer St 2</ram:LineOne>');
    expect(buyerParty).toContain('<ram:PostcodeCode>20095</ram:PostcodeCode>');
    expect(buyerParty).toContain('<ram:CityName>Hamburg</ram:CityName>');
    expect(buyerParty).toContain('<ram:CountryID>DE</ram:CountryID>');
    expect(buyerParty).not.toContain('ApplicableHeaderTradeSettlement');
    expect(xml).toMatch(
      /<\/ram:ApplicableHeaderTradeAgreement>\s*<ram:ApplicableHeaderTradeDelivery>[\s\S]*<\/ram:ApplicableHeaderTradeDelivery>\s*<ram:ApplicableHeaderTradeSettlement>/,
    );
    expect(xml).toContain('<ram:BuyerOrderReferencedDocument>');
    expect(xml).toContain(`<ram:IssuerAssignedID>${purchaseOrderReference}</ram:IssuerAssignedID>`);
    expect(xml).toContain('<ram:ApplicableHeaderTradeDelivery>');
    expect(xml).toContain('<ram:BillingSpecifiedPeriod>');
    expect(xml).toContain('<udt:DateTimeString format="102">20260501</udt:DateTimeString>');
    expect(xml).toContain('<udt:DateTimeString format="102">20260601</udt:DateTimeString>');
  });

  it('uses company name as buyer when set', () => {
    const xml = service.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      {
        ...buyer,
        company: 'Buyer AG',
      } as CustomerProfileEntity,
      purchaseOrderReference,
      invoicingPeriod,
      buildInvoiceDocumentOptions(invoice),
    );

    expect(xml).toContain('Buyer AG');
    expect(xml).not.toContain('Jane Doe');
  });

  it('includes SEPA payment means with normalized IBAN and BIC when configured', () => {
    const xml = service.buildEn16931Xml(
      invoice,
      lineItems,
      {
        ...issuer,
        bank: 'Example Bank',
        iban: 'DE00 0000 0000 0000 00',
        bic: 'cobadeffxxx',
      },
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      buildInvoiceDocumentOptions(invoice),
    );

    expect(xml).toContain('<ram:SpecifiedTradeSettlementPaymentMeans>');
    expect(xml).toContain('<ram:TypeCode>58</ram:TypeCode>');
    expect(xml).toContain('<ram:IBANID>DE0000000000000000</ram:IBANID>');
    expect(xml).toContain('<ram:AccountName>Example Bank</ram:AccountName>');
    expect(xml).toContain('<ram:BICID>COBADEFFXXX</ram:BICID>');
  });

  it('includes address line two when provided', () => {
    const xml = service.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      {
        ...buyer,
        addressLine2: 'Floor 3',
      } as CustomerProfileEntity,
      purchaseOrderReference,
      invoicingPeriod,
      buildInvoiceDocumentOptions(invoice),
    );

    expect(xml).toContain('<ram:LineTwo>Floor 3</ram:LineTwo>');
  });

  it('throws when buyer address is incomplete', () => {
    expect(() =>
      service.buildEn16931Xml(
        invoice,
        lineItems,
        issuer,
        {
          ...buyer,
          postalCode: undefined,
        } as CustomerProfileEntity,
        purchaseOrderReference,
        invoicingPeriod,
        buildInvoiceDocumentOptions(invoice),
      ),
    ).toThrow('Buyer address is incomplete for e-invoice');
  });

  it('builds credit note XML with type 381 and referenced invoice', () => {
    const voidedAt = new Date('2026-06-10T12:00:00Z');
    const xml = service.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      buildCreditNoteDocumentOptions('INV-2026-00001-CN', voidedAt, 'INV-2026-00001'),
    );

    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(xml).toContain('INV-2026-00001-CN');
    expect(xml).toContain('<ram:InvoiceReferencedDocument>');
    expect(xml).toContain('<ram:IssuerAssignedID>INV-2026-00001</ram:IssuerAssignedID>');
    expect(xml).not.toContain('SpecifiedTradeSettlementPaymentMeans');
    expect(xml).toContain('<ram:DuePayableAmount');
    expect(xml).toContain('<ram:DuePayableAmount>0.00</ram:DuePayableAmount>');
  });

  it('omits payment means when IBAN is not configured', () => {
    const xml = service.buildEn16931Xml(
      invoice,
      lineItems,
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      buildInvoiceDocumentOptions(invoice),
    );

    expect(xml).not.toContain('SpecifiedTradeSettlementPaymentMeans');
    expect(xml).not.toContain('PayeePartyCreditorFinancialAccount');
  });

  describe('payment and delivery terms', () => {
    const termsInvoice = {
      ...invoice,
      dueDate: new Date('2026-06-15T00:00:00Z'),
      paymentDueDays: 14,
      deliveryTermsCode: DeliveryTermsCode.DAP,
      deliveryTermsPlace: 'Berlin',
      deliveryTermsText: null,
    } as InvoiceEntity;
    const build = (doc: InvoiceEntity, options = buildInvoiceDocumentOptions(doc)) =>
      service.buildEn16931Xml(doc, lineItems, issuer, buyer, purchaseOrderReference, invoicingPeriod, options);

    it('embeds delivery terms as an AAR note after the issue date', () => {
      const xml = build(termsInvoice);
      const exchanged = xml.match(/<rsm:ExchangedDocument>[\s\S]*?<\/rsm:ExchangedDocument>/)?.[0] ?? '';

      expect(exchanged).toMatch(
        /<ram:IssueDateTime>[\s\S]*<\/ram:IssueDateTime>\s*<ram:IncludedNote>\s*<ram:Content>DAP – Delivered at Place, Berlin \(Incoterms® 2020\)<\/ram:Content>\s*<ram:SubjectCode>AAR<\/ram:SubjectCode>\s*<\/ram:IncludedNote>/,
      );
    });

    it('embeds payment terms (BT-20) and the due date (BT-9)', () => {
      const xml = build(termsInvoice);
      const terms = xml.match(/<ram:SpecifiedTradePaymentTerms>[\s\S]*?<\/ram:SpecifiedTradePaymentTerms>/)?.[0] ?? '';

      expect(terms).toContain(
        '<ram:Description>Payable within 14 days of the invoice date without deduction.</ram:Description>',
      );
      expect(terms).toContain('<udt:DateTimeString format="102">20260615</udt:DateTimeString>');
    });

    it('orders settlement children per the CII schema', () => {
      const xml = build({ ...termsInvoice, taxNote: 'Reverse charge' } as InvoiceEntity, {
        ...buildInvoiceDocumentOptions(termsInvoice),
        referencedInvoiceNumber: 'INV-2026-00000',
      });
      const settlement =
        xml.match(/<ram:ApplicableHeaderTradeSettlement>[\s\S]*<\/ram:ApplicableHeaderTradeSettlement>/)?.[0] ?? '';
      const order = [
        '<ram:InvoiceCurrencyCode>',
        '<ram:ApplicableTradeTax>',
        '<ram:BillingSpecifiedPeriod>',
        '<ram:SpecifiedTradePaymentTerms>',
        '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
        '<ram:InvoiceReferencedDocument>',
      ].map((tag) => settlement.indexOf(tag));

      expect(order.every((position) => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      const tax = settlement.match(/<ram:ApplicableTradeTax>[\s\S]*?<\/ram:ApplicableTradeTax>/)?.[0] ?? '';

      expect(tax.indexOf('<ram:ExemptionReason>')).toBeGreaterThan(tax.indexOf('<ram:TypeCode>'));
      expect(tax.indexOf('<ram:ExemptionReason>')).toBeLessThan(tax.indexOf('<ram:BasisAmount'));
    });

    it('escapes custom delivery terms text', () => {
      const xml = build({
        ...termsInvoice,
        deliveryTermsCode: DeliveryTermsCode.CUSTOM,
        deliveryTermsPlace: null,
        deliveryTermsText: '<script>alert(1)</script> & access',
      } as InvoiceEntity);

      expect(xml).not.toContain('<script>');
      expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; access');
    });

    it('omits terms on credit notes', () => {
      const xml = build(
        termsInvoice,
        buildCreditNoteDocumentOptions('INV-2026-00001-CN', new Date(), 'INV-2026-00001'),
      );

      expect(xml).not.toContain('<ram:IncludedNote>');
      expect(xml).not.toContain('<ram:SpecifiedTradePaymentTerms>');
    });

    it('omits terms when the document has none (legacy invoices)', () => {
      const xml = build(invoice);

      expect(xml).not.toContain('<ram:IncludedNote>');
      expect(xml).not.toContain('<ram:SpecifiedTradePaymentTerms>');
    });

    it('keeps delivery terms but no due date on promotional zero-balance invoices', () => {
      const promo = { ...termsInvoice, paymentDueDays: null, dueDate: undefined } as InvoiceEntity;
      const xml = build(promo, buildZeroBalancePromotionalInvoiceDocumentOptions(promo));

      expect(xml).toContain('<ram:SubjectCode>AAR</ram:SubjectCode>');
      expect(xml).not.toContain('<ram:SpecifiedTradePaymentTerms>');
    });

    it('embeds settlement terms (BT-20) on partial credit notes with an amount due (BR-CO-25)', () => {
      const xml = build(
        termsInvoice,
        buildPartialCreditNoteDocumentOptions('INV-2026-00001-CN-x', new Date(), 'INV-2026-00001', 11.9),
      );
      const terms = xml.match(/<ram:SpecifiedTradePaymentTerms>[\s\S]*?<\/ram:SpecifiedTradePaymentTerms>/)?.[0] ?? '';

      expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>');
      expect(terms).toContain('Offset against the open balance of invoice INV-2026-00001');
      expect(terms).not.toContain('Payable within');
      expect(terms).not.toContain('<ram:DueDateDateTime>');
      expect(xml).not.toContain('<ram:IncludedNote>');
    });

    it('uses an EN 16931 type code (325) for offers', () => {
      const xml = build(
        termsInvoice,
        buildOfferDocumentOptions({ id: 'off-1', offerNumber: 'OFF-1', createdAt: new Date(), totalGross: 119 }),
      );

      expect(xml).toContain('<ram:TypeCode>325</ram:TypeCode>');
    });

    it('embeds offer payment terms without a due date', () => {
      const offerDoc = { ...termsInvoice, dueDate: undefined, paymentDueDays: 0 } as InvoiceEntity;
      const xml = build(
        offerDoc,
        buildOfferDocumentOptions({ id: 'off-1', offerNumber: 'OFF-1', createdAt: new Date(), totalGross: 119 }),
      );

      expect(xml).toContain('<ram:Description>Payable immediately without deduction.</ram:Description>');
      expect(xml).not.toContain('<ram:DueDateDateTime>');
    });
  });

  describe('EN 16931 conformance details', () => {
    const build = (doc: InvoiceEntity, options = buildInvoiceDocumentOptions(doc)) =>
      service.buildEn16931Xml(doc, lineItems, issuer, buyer, purchaseOrderReference, invoicingPeriod, options);

    it('writes postcode before the street (CII TradeAddress sequence)', () => {
      const xml = build(invoice);

      for (const party of ['SellerTradeParty', 'BuyerTradeParty']) {
        const address = xml.match(new RegExp(`<ram:${party}>[\\s\\S]*?</ram:PostalTradeAddress>`))?.[0] ?? '';

        expect(address.indexOf('<ram:PostcodeCode>')).toBeLessThan(address.indexOf('<ram:LineOne>'));
      }
    });

    it('formats amounts with two decimals and puts currencyID only on the tax total', () => {
      const xml = build({
        ...invoice,
        subtotalNet: '100.0000',
        taxTotal: '19.0000',
        totalGross: '119.0000',
        balanceDue: '119.0000',
      } as unknown as InvoiceEntity);

      expect(xml).toContain('<ram:GrandTotalAmount>119.00</ram:GrandTotalAmount>');
      expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">19.00</ram:TaxTotalAmount>');
      expect(xml.match(/currencyID=/g)).toHaveLength(1);
      expect(xml).not.toMatch(/Amount[^>]*>\d+\.\d{3,}</);
    });

    it('issues promotional zero-balance invoices as commercial invoices (380) with the total prepaid', () => {
      const xml = build(invoice, buildZeroBalancePromotionalInvoiceDocumentOptions(invoice));

      expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>');
      expect(xml).toContain('<ram:TotalPrepaidAmount>119.00</ram:TotalPrepaidAmount>');
      expect(xml).toContain('<ram:DuePayableAmount>0.00</ram:DuePayableAmount>');
    });

    it('states the prepaid amount when less than the total is due (BR-CO-16)', () => {
      const xml = build(invoice, buildCreditNoteDocumentOptions('INV-2026-00001-CN', new Date(), 'INV-2026-00001'));

      expect(xml).toContain('<ram:TotalPrepaidAmount>119.00</ram:TotalPrepaidAmount>');
      expect(xml).toContain('<ram:DuePayableAmount>0.00</ram:DuePayableAmount>');
      expect(build(invoice)).not.toContain('<ram:TotalPrepaidAmount>');
    });
  });
});
