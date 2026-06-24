export enum DatevExportScope {
  TENANT = 'tenant',
  UNIFIED = 'unified',
}

export enum DatevExportStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export const DATEV_BOOKING_ROW_FIELD_COUNT = 120;
export const DATEV_DEBTOR_ROW_FIELD_COUNT = 243;

const DATEV_BOOKING_COLUMN_NAMES = [
  'Umsatz (ohne Soll/Haben-Kz)',
  'Soll/Haben-Kennzeichen',
  'WKZ Umsatz',
  'Kurs',
  'Basis-Umsatz',
  'WKZ Basis-Umsatz',
  'Konto',
  'Gegenkonto (ohne BU-Schluessel)',
  'BU-Schluessel',
  'Belegdatum',
  'Belegfeld 1',
  'Belegfeld 2',
  'Skonto',
  'Buchungstext',
];

export function buildDatevBookingColumnHeaders(): string[] {
  const headers = [...DATEV_BOOKING_COLUMN_NAMES];

  while (headers.length < DATEV_BOOKING_ROW_FIELD_COUNT) {
    headers.push('');
  }

  return headers.slice(0, DATEV_BOOKING_ROW_FIELD_COUNT);
}
