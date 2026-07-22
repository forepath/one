import { TaxCategory } from '../constants/tax-category.constants';
import { DatevExportScope, DATEV_BOOKING_ROW_FIELD_COUNT } from '../constants/datev-export.constants';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { DatevBookingMapperService } from './datev-booking-mapper.service';
import type { DatevTenantExportConfig } from './datev-export-config.service';

describe('DatevBookingMapperService', () => {
  const service = new DatevBookingMapperService();
  const config: DatevTenantExportConfig = {
    consultantNumber: '1234567',
    clientNumber: '56789',
    chartOfAccounts: 'SKR03',
    accountLength: 4,
    revenueAccountStandard: '8400',
    revenueAccountReduced: '8300',
    revenueAccountReverseCharge: '8336',
    revenueAccountOss: '8400',
    revenueAccountThirdCountry: '8338',
    debtorAccountStart: 10_000,
    debtorAccountEnd: 69_999,
    buKeyStandard: '',
    buKeyReduced: '',
    buKeyReverseCharge: '',
    buKeyOss: '',
    buKeyThirdCountry: '',
    includeDocuments: true,
    dictationAbbr: 'DEC',
    fiscalYearStartMonth: 1,
  };

  const line = (overrides: Partial<InvoiceLineItemEntity> = {}): InvoiceLineItemEntity =>
    ({
      description: 'Hosting subscription',
      lineGross: 119,
      taxCategory: TaxCategory.STANDARD,
      ...overrides,
    }) as InvoiceLineItemEntity;

  const invoice = (overrides: Partial<InvoiceEntity> = {}): InvoiceEntity =>
    ({
      id: 'inv-1',
      invoiceNumber: 'INV-2026-00001',
      issuedAt: new Date('2026-01-15T12:00:00Z'),
      createdAt: new Date('2026-01-15T12:00:00Z'),
      ...overrides,
    }) as InvoiceEntity;

  it('maps issued line item with S and standard revenue account', () => {
    const row = service.mapIssuedLineItem({
      line: line(),
      invoice: invoice(),
      debtorAccount: 10_001,
      config,
      scope: DatevExportScope.TENANT,
    });

    expect(row).toHaveLength(DATEV_BOOKING_ROW_FIELD_COUNT);
    expect(row[0]).toBe('119,00');
    expect(row[1]).toBe('S');
    expect(row[6]).toBe('10001');
    expect(row[7]).toBe('8400');
    expect(row[10]).toBe('INV-2026-00001');
  });

  it('maps reduced tax to 8300 revenue account', () => {
    const row = service.mapIssuedLineItem({
      line: line({ taxCategory: TaxCategory.REDUCED }),
      invoice: invoice(),
      debtorAccount: 10_001,
      config,
      scope: DatevExportScope.TENANT,
    });

    expect(row[7]).toBe('8300');
  });

  it('maps voided line item with H and credit note number', () => {
    const row = service.mapVoidedLineItem({
      line: line(),
      invoice: invoice(),
      debtorAccount: 10_001,
      config,
      scope: DatevExportScope.TENANT,
      voidedAt: new Date('2026-02-01T12:00:00Z'),
    });

    expect(row[1]).toBe('H');
    expect(row[10]).toBe('INV-2026-00001-CN');
  });

  it('maps voided reduced line item to 8300 revenue account', () => {
    const row = service.mapVoidedLineItem({
      line: line({ taxCategory: TaxCategory.REDUCED }),
      invoice: invoice(),
      debtorAccount: 10_001,
      config,
      scope: DatevExportScope.TENANT,
      voidedAt: new Date('2026-02-01T12:00:00Z'),
    });

    expect(row[1]).toBe('H');
    expect(row[7]).toBe('8300');
  });

  it('maps partial credit document with H and reduced revenue account', () => {
    const row = service.mapPartialCreditDocument({
      credit: {
        documentNumber: 'PCN-2026-00001',
        creditGross: 50,
        taxCategory: TaxCategory.REDUCED,
        description: 'Unused subscription period (SUB-1)',
        withdrawnAt: new Date('2026-02-01T12:00:00Z'),
      } as never,
      invoice: invoice(),
      debtorAccount: 10_001,
      config,
      scope: DatevExportScope.TENANT,
    });

    expect(row[0]).toBe('50,00');
    expect(row[1]).toBe('H');
    expect(row[7]).toBe('8300');
    expect(row[10]).toBe('PCN-2026-00001');
    expect(row[13]).toContain('Unused subscription period');
  });

  it('prefixes booking text with tenant slug for unified exports', () => {
    const row = service.mapIssuedLineItem({
      line: line(),
      invoice: invoice(),
      debtorAccount: 10_001,
      config,
      scope: DatevExportScope.UNIFIED,
      tenantSlug: 'acme',
    });

    expect(row[13]).toContain('[acme]');
  });

  it('sets Beleglink when document link provided', () => {
    const row = service.mapIssuedLineItem({
      line: line(),
      invoice: invoice(),
      debtorAccount: 10_001,
      config,
      scope: DatevExportScope.TENANT,
      documentLink: 'BEDI "belege/INV-2026-00001.pdf"',
    });

    expect(row[19]).toBe('BEDI "belege/INV-2026-00001.pdf"');
  });
});
