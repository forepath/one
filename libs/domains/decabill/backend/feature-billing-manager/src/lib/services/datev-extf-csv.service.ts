import { Injectable } from '@nestjs/common';

import { buildDatevBookingColumnHeaders, DATEV_DEBTOR_ROW_FIELD_COUNT } from '../constants/datev-export.constants';
import {
  encodeDatevCsv,
  formatDatevHeaderDate,
  formatDatevTimestamp,
  joinDatevLines,
  joinDatevRow,
} from '../utils/datev-format.util';

import type { DatevTenantExportConfig } from './datev-export-config.service';

export interface DatevExtfBookingBatchParams {
  config: DatevTenantExportConfig;
  periodStart: Date;
  periodEnd: Date;
  batchLabel: string;
  bookingRows: string[][];
  /** Festschreibung flag of the batch (all contained periods locked). */
  locked?: boolean;
  /** Batch currency (functional currency of the ledger). */
  currency?: string;
}

export interface DatevExtfDebtorBatchParams {
  config: DatevTenantExportConfig;
  debtorRows: string[][];
  /** Period the master data belongs to (decides the fiscal-year start in the header). */
  periodStart?: Date;
}

export interface DatevExtfAccountLabelsParams {
  config: DatevTenantExportConfig;
  periodStart: Date;
  /** [account number, label] pairs. */
  accounts: Array<[string, string]>;
}

/** DATEV `Sachkontenrahmen` header value of the configured chart (`03` / `04`). */
function skrCode(chart: string): string {
  return /04/.test(chart) ? '04' : '03';
}

@Injectable()
export class DatevExtfCsvService {
  buildBookingBatchCsv(params: DatevExtfBookingBatchParams): Buffer {
    const fiscalYearStart = this.resolveFiscalYearStart(params.periodStart, params.config.fiscalYearStartMonth);
    const headerFields = [
      'EXTF',
      '700',
      '21',
      'Buchungsstapel',
      '13',
      formatDatevTimestamp(new Date()),
      '',
      '',
      '',
      '',
      params.config.consultantNumber,
      params.config.clientNumber,
      formatDatevHeaderDate(fiscalYearStart),
      String(params.config.accountLength),
      formatDatevHeaderDate(params.periodStart),
      formatDatevHeaderDate(params.periodEnd),
      params.batchLabel,
      params.config.dictationAbbr,
      '1',
      '',
      params.locked ? '1' : '0',
      (params.currency ?? 'EUR').toUpperCase(),
      '',
      '',
      '',
      '',
      skrCode(params.config.chartOfAccounts),
    ];
    const lines = [
      joinDatevRow(headerFields),
      joinDatevRow(buildDatevBookingColumnHeaders()),
      ...params.bookingRows.map((row) => joinDatevRow(row)),
    ];

    return encodeDatevCsv(joinDatevLines(lines));
  }

  buildCreditorBatchCsv(params: DatevExtfDebtorBatchParams): Buffer {
    return this.buildDebtorBatchCsv(params);
  }

  buildDebtorBatchCsv(params: DatevExtfDebtorBatchParams): Buffer {
    const headerFields = [
      'EXTF',
      '700',
      '16',
      'Debitoren/Kreditoren',
      '5',
      formatDatevTimestamp(new Date()),
      '',
      '',
      '',
      '',
      params.config.consultantNumber,
      params.config.clientNumber,
      formatDatevHeaderDate(
        this.resolveFiscalYearStart(params.periodStart ?? new Date(), params.config.fiscalYearStartMonth),
      ),
      String(params.config.accountLength),
    ];
    const debtorHeaders = Array.from({ length: DATEV_DEBTOR_ROW_FIELD_COUNT }, () => '');

    debtorHeaders[0] = 'Konto';
    debtorHeaders[1] = 'Name (Adressattyp Unternehmen)';
    debtorHeaders[2] = 'Unternehmensgegenstand';
    debtorHeaders[3] = 'Strasse';
    debtorHeaders[4] = 'Postfach';
    debtorHeaders[5] = 'Postleitzahl';
    debtorHeaders[6] = 'Ort';
    debtorHeaders[7] = 'Land';
    debtorHeaders[8] = 'E-Mail';
    debtorHeaders[9] = 'Telefon';

    const lines = [
      joinDatevRow(headerFields),
      joinDatevRow(debtorHeaders),
      ...params.debtorRows.map((row) => joinDatevRow(row)),
    ];

    return encodeDatevCsv(joinDatevLines(lines));
  }

  /** Kontenbeschriftungen (EXTF category 20): labels of the general-ledger accounts used. */
  buildAccountLabelsCsv(params: DatevExtfAccountLabelsParams): Buffer {
    const headerFields = [
      'EXTF',
      '700',
      '20',
      'Kontenbeschriftungen',
      '2',
      formatDatevTimestamp(new Date()),
      '',
      '',
      '',
      '',
      params.config.consultantNumber,
      params.config.clientNumber,
      formatDatevHeaderDate(this.resolveFiscalYearStart(params.periodStart, params.config.fiscalYearStartMonth)),
      String(params.config.accountLength),
    ];
    const lines = [
      joinDatevRow(headerFields),
      joinDatevRow(['Konto', 'Kontenbeschriftung', 'Sprach-ID']),
      ...params.accounts.map(([number, label]) => joinDatevRow([number, label.slice(0, 40), 'de-DE'])),
    ];

    return encodeDatevCsv(joinDatevLines(lines));
  }

  private resolveFiscalYearStart(periodStart: Date, fiscalYearStartMonth: number): Date {
    const year =
      periodStart.getUTCMonth() + 1 >= fiscalYearStartMonth
        ? periodStart.getUTCFullYear()
        : periodStart.getUTCFullYear() - 1;

    return new Date(Date.UTC(year, fiscalYearStartMonth - 1, 1));
  }
}
