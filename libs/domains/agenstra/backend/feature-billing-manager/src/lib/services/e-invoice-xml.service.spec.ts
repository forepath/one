import { TaxCategory } from '../constants/tax-category.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { buildCreditNoteDocumentOptions, buildInvoiceDocumentOptions } from './e-invoice-document-options';
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
    expect(xml).toContain('>0<');
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
});
