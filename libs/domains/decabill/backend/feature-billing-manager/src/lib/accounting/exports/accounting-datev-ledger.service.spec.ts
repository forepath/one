import {
  AccountingPeriodStatus,
  CounterpartyType,
  JournalLinkType,
  TaxCodeKind,
} from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingEntryLinkEntity } from '../entities/accounting-entry-link.entity';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import { AccountingTaxCodeEntity } from '../entities/accounting-tax-code.entity';

import { AccountingDatevLedgerService } from './accounting-datev-ledger.service';

describe('AccountingDatevLedgerService', () => {
  const accounts = [
    { id: 'ar', number: '1400', isAutomatic: false },
    { id: 'rev', number: '8400', isAutomatic: true },
    { id: 'vat', number: '1776', isAutomatic: false },
    { id: 'oss-rev', number: '8331', isAutomatic: false },
    { id: 'oss-vat', number: '1767', isAutomatic: false },
    { id: 'bank', number: '1200', isAutomatic: false },
  ];
  const taxCodes = [
    { id: 'tc-std', kind: TaxCodeKind.OUTPUT, datevBuKey: '3', oss: false, ecSalesList: false },
    { id: 'tc-oss', kind: TaxCodeKind.OUTPUT, datevBuKey: null, oss: true, ecSalesList: false },
  ];
  let entries: unknown[];
  let links: unknown[];
  const dataSource = {
    getRepository: (entity: unknown) => {
      if (entity === AccountingAccountEntity) return { find: async () => accounts };

      if (entity === AccountingTaxCodeEntity) return { find: async () => taxCodes };

      if (entity === AccountingPeriodEntity)
        return { find: async () => [{ id: 'p1', status: AccountingPeriodStatus.LOCKED }] };

      if (entity === AccountingEntryLinkEntity) return { find: async () => links };

      const qb = {
        leftJoinAndSelect: () => qb,
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        getMany: async () => entries,
      };

      return { createQueryBuilder: () => qb };
    },
  };
  const config = { isEnabled: () => true, getConfig: () => ({ functionalCurrency: 'EUR' }) };
  const service = new AccountingDatevLedgerService(dataSource as never, config as never);
  const params = {
    tenantId: null,
    periodStart: new Date('2026-03-01T00:00:00Z'),
    periodEnd: new Date('2026-03-31T00:00:00Z'),
    includeBankPostings: true,
    unified: true,
    resolveDebtor: jest.fn(async () => 10001),
    resolveCreditor: jest.fn(async () => 70001),
    documentLink: jest.fn(() => 'BEDI "belege/INV-1.pdf"'),
  };
  const invoiceEntry = {
    id: 'e1',
    periodId: 'p1',
    documentDate: '2026-03-10',
    documentNumber: 'INV-2026-00001',
    description: 'Invoice INV-2026-00001',
    tenantId: 'acme',
    currency: 'EUR',
    fxRate: '1',
    lines: [
      {
        accountId: 'ar',
        debit: '238',
        credit: '0',
        counterpartyType: CounterpartyType.CUSTOMER,
        counterpartyId: 'u1',
        tenantId: 'acme',
      },
      {
        accountId: 'rev',
        debit: '0',
        credit: '100',
        taxCodeId: 'tc-std',
        taxRate: '19',
        taxRole: 'base',
        serviceDate: '2026-03-10',
      },
      { accountId: 'vat', debit: '0', credit: '19', taxCodeId: 'tc-std', taxRate: '19', taxRole: 'tax' },
      {
        accountId: 'oss-rev',
        debit: '0',
        credit: '100',
        taxCodeId: 'tc-oss',
        taxRate: '19',
        taxRole: 'base',
        euCountry: 'AT',
      },
      {
        accountId: 'oss-vat',
        debit: '0',
        credit: '19',
        taxCodeId: 'tc-oss',
        taxRate: '19',
        taxRole: 'tax',
        euCountry: 'AT',
      },
    ],
  };

  beforeEach(() => {
    entries = [invoiceEntry];
    links = [{ entryId: 'e1', linkType: JournalLinkType.INVOICE, targetId: 'inv-1' }];
  });

  it('folds VAT into gross rows against the debtor; automatic accounts get no BU key, OSS gets country + rate', async () => {
    const { rows, allLocked } = await service.buildRows(params);

    expect(allLocked).toBe(true);
    expect(rows).toHaveLength(2);

    const [domestic, oss] = rows;

    expect([domestic[0], domestic[1], domestic[6], domestic[7], domestic[8]]).toEqual([
      '119,00',
      'S',
      '10001',
      '8400',
      '',
    ]);
    expect(domestic[114]).toBe('10032026');
    expect(domestic[113]).toBe('1');
    expect(domestic[36]).toBe('acme');
    expect(domestic[13]).toBe('[acme] Invoice INV-2026-00001');
    expect(domestic[19]).toBe('BEDI "belege/INV-1.pdf"');
    expect([oss[0], oss[7], oss[39], oss[40]]).toEqual(['119,00', '8331', 'AT', '19,00']);
  });

  it('can leave out bank postings (the advisor imports bank data directly)', async () => {
    links = [{ entryId: 'e1', linkType: JournalLinkType.BANK_TRANSACTION, targetId: 'bt-1' }];

    const { rows } = await service.buildRows({ ...params, includeBankPostings: false });

    expect(rows).toHaveLength(0);
  });

  it('writes the foreign amount with a per-row rate and keeps Belegdatum inside the batch period', async () => {
    entries = [
      {
        id: 'e2',
        periodId: 'p1',
        postingDate: '2026-03-02',
        // Late booking: the document is from February, posted into the first open period (March).
        documentDate: '2026-02-27',
        documentNumber: 'INV-USD',
        description: 'Invoice INV-USD',
        tenantId: 'acme',
        currency: 'USD',
        fxRate: '1.1',
        lines: [
          {
            accountId: 'ar',
            debit: '100',
            credit: '0',
            originalAmount: '125',
            originalCurrency: 'USD',
            counterpartyType: CounterpartyType.CUSTOMER,
            counterpartyId: 'u1',
            tenantId: 'acme',
          },
          { accountId: 'rev', debit: '0', credit: '100', originalAmount: '-125', originalCurrency: 'USD' },
        ],
      },
    ];
    links = [];

    const [row] = (await service.buildRows(params)).rows;

    expect([row[0], row[2], row[3], row[4], row[5]]).toEqual(['125,00', 'USD', '1,25', '100,00', 'EUR']);
    expect(row[9]).toBe('02032026');
  });
});
