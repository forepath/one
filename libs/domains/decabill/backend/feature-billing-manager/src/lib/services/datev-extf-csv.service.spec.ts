import { DATEV_BOOKING_ROW_FIELD_COUNT } from '../constants/datev-export.constants';

import type { DatevTenantExportConfig } from './datev-export-config.service';
import { DatevExtfCsvService } from './datev-extf-csv.service';

describe('DatevExtfCsvService', () => {
  const service = new DatevExtfCsvService();
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
    expenseAccountStandard: '4900',
    expenseAccountReduced: '4800',
    expenseAccountReverseCharge: '4836',
    expenseAccountOss: '4900',
    expenseAccountThirdCountry: '4838',
    debtorAccountStart: 10_000,
    debtorAccountEnd: 69_999,
    creditorAccountStart: 70_000,
    creditorAccountEnd: 99_999,
    buKeyStandard: '',
    buKeyReduced: '',
    buKeyReverseCharge: '',
    buKeyOss: '',
    buKeyThirdCountry: '',
    expenseBuKeyStandard: '',
    expenseBuKeyReduced: '',
    includeDocuments: true,
    dictationAbbr: 'DEC',
    fiscalYearStartMonth: 1,
  };

  it('builds Buchungsstapel CSV starting with EXTF header', () => {
    const bookingRow = Array.from({ length: DATEV_BOOKING_ROW_FIELD_COUNT }, () => '');

    bookingRow[0] = '119,00';
    bookingRow[1] = 'S';

    const csv = service.buildBookingBatchCsv({
      config,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
      batchLabel: '2026-01',
      bookingRows: [bookingRow],
    });
    const text = csv.toString('latin1');

    expect(text.startsWith('EXTF;700;21;Buchungsstapel')).toBe(true);
    expect(text).toContain('119,00');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('builds debtor batch CSV with format 16 header', () => {
    const debtorRow = Array.from({ length: 243 }, () => '');

    debtorRow[0] = '10001';
    debtorRow[1] = 'Acme GmbH';

    const csv = service.buildDebtorBatchCsv({
      config,
      debtorRows: [debtorRow],
    });
    const text = csv.toString('latin1');

    expect(text.startsWith('EXTF;700;16;Debitoren/Kreditoren')).toBe(true);
    expect(text).toContain('10001');
  });
});
