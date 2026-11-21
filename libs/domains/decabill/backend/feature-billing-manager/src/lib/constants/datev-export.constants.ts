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

/** 0-based indices of booking columns Decabill fills beyond the first 14 (EXTF Buchungsstapel, format 13). */
export const DATEV_BOOKING_FIELD = {
  generalReversal: 17,
  documentLink: 19,
  costCenter1: 36,
  costCenter2: 37,
  euCountryVatId: 39,
  euTaxRate: 40,
  lock: 113,
  serviceDate: 114,
} as const;

const DATEV_EXTRA_COLUMN_NAMES: Record<number, string> = {
  17: 'Generalumkehr (GU)',
  19: 'Beleglink',
  36: 'KOST1 - Kostenstelle',
  37: 'KOST2 - Kostenstelle',
  39: 'EU-Land u. UStID (Bestimmung)',
  40: 'EU-Steuersatz (Bestimmung)',
  113: 'Festschreibung',
  114: 'Leistungsdatum',
};

export function buildDatevBookingColumnHeaders(): string[] {
  const headers = [...DATEV_BOOKING_COLUMN_NAMES];

  while (headers.length < DATEV_BOOKING_ROW_FIELD_COUNT) {
    headers.push(DATEV_EXTRA_COLUMN_NAMES[headers.length] ?? '');
  }

  return headers.slice(0, DATEV_BOOKING_ROW_FIELD_COUNT);
}
