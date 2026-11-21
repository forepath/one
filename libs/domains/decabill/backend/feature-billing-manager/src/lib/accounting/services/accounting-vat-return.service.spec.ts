import { TaxCodeKind } from '../constants/accounting.constants';
import { DE_PROFILE } from '../profiles/countries/de.profile';

import { AccountingVatReturnService } from './accounting-vat-return.service';

describe('AccountingVatReturnService', () => {
  const config = { getConfig: jest.fn(() => ({ profile: DE_PROFILE, vatBasis: 'invoice' })) };
  const dataSource = { query: jest.fn() };
  const service = new AccountingVatReturnService(
    dataSource as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const ustva = DE_PROFILE.vatReturns.find((r) => r.key === 'DE-USTVA')!;
  const box = (
    kind: TaxCodeKind,
    role: string,
    amount: number,
    boxes: Partial<Record<'base_box' | 'tax_box' | 'reverse_tax_box', string>>,
    extra = {},
  ) => ({
    kind,
    tax_role: role,
    base_box: null,
    tax_box: null,
    reverse_tax_box: null,
    ec_sales_list: false,
    oss: false,
    eu_country: null,
    eu_vat_id: null,
    tax_rate: '19',
    amount: String(amount),
    ...boxes,
    ...extra,
  });

  it('computes UStVA boxes with correct signs and the payable result (Kz 83)', async () => {
    dataSource.query.mockResolvedValue([
      // Revenue 1000.99 (credit → negative debit−credit), output VAT 190.19
      box(TaxCodeKind.OUTPUT, 'base', -1000.99, { base_box: '81', tax_box: '81T' }),
      box(TaxCodeKind.OUTPUT, 'tax', -190.19, { base_box: '81', tax_box: '81T' }),
      // EU B2B services (Kz 21) and input VAT (Kz 66)
      box(
        TaxCodeKind.EXEMPT,
        'base',
        -500,
        { base_box: '21' },
        { ec_sales_list: true, eu_vat_id: 'FR123', eu_country: 'FR' },
      ),
      box(TaxCodeKind.INPUT, 'tax', 38, { tax_box: '66' }),
      // § 13b: base 200, output 38 (credit), input 38 (debit)
      box(TaxCodeKind.REVERSE_CHARGE, 'base', 200, { base_box: '46', tax_box: '47', reverse_tax_box: '67' }),
      box(TaxCodeKind.REVERSE_CHARGE, 'tax', -38, { base_box: '46', tax_box: '47', reverse_tax_box: '67' }),
      box(TaxCodeKind.REVERSE_CHARGE, 'reverse_tax', 38, { base_box: '46', tax_box: '47', reverse_tax_box: '67' }),
      // OSS lines never go into the UStVA
      box(TaxCodeKind.OUTPUT, 'base', -300, {}, { oss: true, eu_country: 'AT' }),
    ]);

    const { figures } = await service.calculate(ustva, '2026-01-01', '2026-01-31', { '39': 0 });

    expect(figures['81']).toBe(1000);
    expect(figures['81T']).toBe(190.19);
    expect(figures['21']).toBe(500);
    expect(figures['46']).toBe(200);
    expect(figures['47']).toBe(38);
    expect(figures['67']).toBe(38);
    expect(figures['66']).toBe(38);
    expect(figures['83']).toBe(152.19);
  });

  it('builds the EC sales list per customer VAT id and the OSS return per country and rate', async () => {
    dataSource.query.mockResolvedValue([
      box(
        TaxCodeKind.EXEMPT,
        'base',
        -500,
        { base_box: '21' },
        { ec_sales_list: true, eu_vat_id: 'FR123', eu_country: 'FR' },
      ),
      box(
        TaxCodeKind.EXEMPT,
        'base',
        -250.6,
        { base_box: '21' },
        { ec_sales_list: true, eu_vat_id: 'FR123', eu_country: 'FR' },
      ),
      box(TaxCodeKind.OUTPUT, 'base', -100, {}, { oss: true, eu_country: 'AT', tax_rate: '20' }),
      box(TaxCodeKind.OUTPUT, 'tax', -20, {}, { oss: true, eu_country: 'AT', tax_rate: '20' }),
    ]);

    const zm = await service.calculate(
      DE_PROFILE.vatReturns.find((r) => r.key === 'DE-ZM')!,
      '2026-01-01',
      '2026-03-31',
      {},
    );
    const oss = await service.calculate(
      DE_PROFILE.vatReturns.find((r) => r.key === 'EU-OSS')!,
      '2026-01-01',
      '2026-03-31',
      {},
    );

    expect(zm.details).toEqual([{ vatId: 'FR123', country: 'FR', amount: 751, type: 'S' }]);
    expect(oss.details).toEqual([{ country: 'AT', rate: 20, base: 100, tax: 20 }]);
    expect(oss.figures['tax']).toBe(20);
  });

  it('evaluates +/- formulas over boxes', () => {
    expect(service.evaluate('81T + 86T - 66 - 39', { '81T': 100, '86T': 7.5, '66': 20.25, '39': 1 })).toBe(86.25);
  });

  it('resolves computed boxes regardless of their order and rejects circular formulas', () => {
    // 105 references 103 / 104, which are defined after it; numeric box ids must not be read as literals.
    const def = {
      key: 'LU-TEST',
      boxes: [
        { box: '105', kind: 'computed', formula: '103 - 104' },
        { box: '103', kind: 'computed', formula: '046 + 056' },
        { box: '104', kind: 'computed', formula: '093' },
        { box: '046', kind: 'base' },
        { box: '056', kind: 'tax' },
        { box: '093', kind: 'tax' },
      ],
    } as never;
    const figures: Record<string, number> = { '046': 170, '056': 30, '093': 50.5 };

    service.resolveComputedBoxes(def, figures);

    expect(figures).toEqual(expect.objectContaining({ '103': 200, '104': 50.5, '105': 149.5 }));

    const circular = {
      key: 'X',
      boxes: [
        { box: 'A', kind: 'computed', formula: 'B + 1' },
        { box: 'B', kind: 'computed', formula: 'A' },
      ],
    } as never;

    expect(() => service.resolveComputedBoxes(circular, {})).toThrow(/Circular VAT box formula/);
  });

  it('derives month / quarter / year periods', () => {
    expect(service.periodBounds('quarter', '2026-11-20')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(service.periodBounds('month', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});
