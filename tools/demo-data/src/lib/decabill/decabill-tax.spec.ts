import { computeLines, resolveTax } from './decabill-tax';

describe('resolveTax', () => {
  it('should apply domestic VAT for buyers in the issuer country', () => {
    expect(resolveTax({ country: 'DE', customerType: 'consumer', vatId: null }, 'DE')).toMatchObject({
      taxMode: 'domestic_vat',
      standardRate: 19,
      reducedRate: 7,
    });
  });

  it('should use reverse charge for EU businesses with a VAT id', () => {
    expect(resolveTax({ country: 'NL', customerType: 'business', vatId: 'NL123' }, 'DE')).toMatchObject({
      taxMode: 'eu_reverse_charge',
      einvoiceCode: 'AE',
      standardRate: 0,
    });
  });

  it('should charge destination VAT for EU consumers', () => {
    expect(resolveTax({ country: 'AT', customerType: 'consumer', vatId: null }, 'DE')).toMatchObject({
      taxMode: 'eu_b2c_oss',
      standardRate: 20,
    });
  });

  it('should not charge VAT for third countries', () => {
    expect(resolveTax({ country: 'US', customerType: 'business', vatId: null }, 'DE').taxMode).toBe(
      'third_country_b2b_no_vat',
    );
    expect(resolveTax({ country: 'CH', customerType: 'consumer', vatId: null }, 'DE').taxMode).toBe(
      'third_country_b2c_no_domestic_vat',
    );
  });
});

describe('computeLines', () => {
  it('should compute line and invoice totals with standard and reduced rates', () => {
    const tax = resolveTax({ country: 'DE', customerType: 'business', vatId: null }, 'DE');
    const totals = computeLines(
      [
        { description: 'Hosting', quantity: 2, unitPriceNet: 10 },
        { description: 'Book', quantity: 1, unitPriceNet: 20, taxCategory: 'reduced' },
      ],
      tax,
    );

    expect(totals.lines.map((line) => line.lineTax)).toEqual([3.8, 1.4]);
    expect(totals.subtotalNet).toBe(40);
    expect(totals.taxTotal).toBe(5.2);
    expect(totals.totalGross).toBe(45.2);
  });
});
