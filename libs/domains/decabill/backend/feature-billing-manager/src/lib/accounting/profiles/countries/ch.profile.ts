import {
  AccountingAccountRole as R,
  AccountingAccountType as T,
  TaxCodeKind as K,
} from '../../constants/accounting.constants';
import {
  type AccountingCountryProfile,
  CanonicalTaxCode as C,
  type ChartTemplate,
  type ChartTemplateTaxCode,
  type StatementLayout,
  type VatReturnDefinition,
} from '../accounting-profile.types';

import { buildAccounts, type TemplateRow } from './template-rows';

/**
 * Switzerland: minimal own-labelled chart using the customary SME numbering (classes 1 Aktiven, 2 Passiven,
 * 3 Betriebsertrag, 4 Material/Waren/DL, 5 Personal, 6 übriger Betriebsaufwand, 7 Nebenbetriebe, 8 betriebsfremd/
 * ausserordentlich, 9 Abschluss). Not a copy of the copyrighted KMU-Kontenrahmen.
 */

const u = undefined;
const ROWS: TemplateRow[] = [
  // Umlaufvermögen
  ['1000', 'Kasse', T.ASSET, 'BS.UV.a', R.CASH],
  ['1020', 'Bank', T.ASSET, 'BS.UV.a', R.BANK],
  ['1029', 'Zahlungsdienstleister (Verrechnung)', T.ASSET, 'BS.UV.a', R.PROCESSOR_CLEARING],
  ['1090', 'Transferkonto (Geld unterwegs)', T.ASSET, 'BS.UV.a', R.CASH_IN_TRANSIT],
  ['1099', 'Unklare Beträge (Klärungskonto)', T.ASSET, 'BS.UV.c', R.SUSPENSE],
  ['1100', 'Forderungen aus Lieferungen und Leistungen (Debitoren)', T.ASSET, 'BS.UV.b', R.RECEIVABLES],
  // KMU numbering splits input tax by Ziffer (1170 Material/Waren/DL = Ziff. 400, 1171 Investitionen/übriger
  // Betriebsaufwand = Ziff. 405), not by rate; the reduced-rate input tax therefore uses own sub-account 1173.
  [
    '1170',
    'Vorsteuer MWST Material, Waren, Dienstleistungen, Energie (Normalsatz)',
    T.ASSET,
    'BS.UV.c',
    R.VAT_INPUT_STANDARD,
  ],
  ['1173', 'Vorsteuer MWST reduzierte Sätze', T.ASSET, 'BS.UV.c', R.VAT_INPUT_REDUCED],
  ['1172', 'Vorsteuer MWST auf Bezugsteuer', T.ASSET, 'BS.UV.c', R.VAT_INPUT_REVERSE_CHARGE],
  ['1200', 'Handelswaren', T.ASSET, 'BS.UV.d', R.INVENTORY],
  // Anlagevermögen
  ['1510', 'Mobiliar und Einrichtungen', T.ASSET, 'BS.AV.c'],
  ['1520', 'Büromaschinen, Informatik', T.ASSET, 'BS.AV.c', R.FIXED_ASSETS],
  ['1521', 'Kleinanschaffungen Informatik (aktiviert)', T.ASSET, 'BS.AV.c', R.LOW_VALUE_ASSETS],
  ['1590', 'Übrige Sachanlagen (kein Sammelposten im Schweizer Recht)', T.ASSET, 'BS.AV.c', R.ASSET_POOL],
  ['1700', 'Software und Lizenzen', T.ASSET, 'BS.AV.d'],
  // Fremdkapital
  ['2000', 'Verbindlichkeiten aus Lieferungen und Leistungen (Kreditoren)', T.LIABILITY, 'BS.KFK.a', R.PAYABLES],
  ['2030', 'Erhaltene Anzahlungen von Kunden', T.LIABILITY, 'BS.KFK.c', R.CUSTOMER_PREPAYMENTS],
  ['2200', 'Geschuldete MWST Normalsatz', T.LIABILITY, 'BS.KFK.c', R.VAT_OUTPUT_STANDARD],
  ['2201', 'Abrechnungskonto MWST', T.LIABILITY, 'BS.KFK.c', R.VAT_SETTLEMENT],
  ['2202', 'Geschuldete MWST reduzierte Sätze', T.LIABILITY, 'BS.KFK.c', R.VAT_OUTPUT_REDUCED],
  ['2203', 'Geschuldete Bezugsteuer', T.LIABILITY, 'BS.KFK.c', R.VAT_OUTPUT_REVERSE_CHARGE],
  // 2206 is the Verrechnungssteuerschuld in the KMU numbering; MWST payments / Akontozahlungen use own 2204.
  ['2204', 'MWST-Zahlungen und Akontozahlungen an die ESTV', T.LIABILITY, 'BS.KFK.c', R.VAT_PREPAYMENTS],
  // Eigenkapital
  ['2800', 'Grundkapital / Eigenkapital', T.EQUITY, 'BS.EK.a'],
  ['2850', 'Privat (Entnahmen)', T.EQUITY, 'BS.EK.P', R.OWNER_DRAWINGS],
  ['2851', 'Privat (Einlagen)', T.EQUITY, 'BS.EK.P', R.OWNER_CONTRIBUTIONS],
  ['2970', 'Gewinnvortrag / Verlustvortrag', T.EQUITY, 'BS.EK.f', R.RETAINED_EARNINGS],
  ['2979', 'Jahresgewinn / Jahresverlust', T.EQUITY, 'BS.EK.g', R.ANNUAL_RESULT],
  // Betriebsertrag
  ['3200', 'Handelserlöse Export (steuerbefreit, Ziff. 220)', T.REVENUE, 'PL.1', R.REVENUE_TAX_FREE, C.OUT_ZERO],
  ['3400', 'Dienstleistungserlöse Normalsatz', T.REVENUE, 'PL.1', R.REVENUE_STANDARD, C.OUT_STANDARD],
  ['3401', 'Dienstleistungserlöse reduzierter Satz', T.REVENUE, 'PL.1', R.REVENUE_REDUCED, C.OUT_REDUCED],
  ['3402', 'Erlöse Beherbergung (Sondersatz)', T.REVENUE, 'PL.1', u, C.OUT_REDUCED_2],
  [
    '3410',
    'Dienstleistungserlöse an Empfänger in der EU (Leistungsort Ausland, Ziff. 221)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_EU_REVERSE_CHARGE,
  ],
  [
    '3411',
    'Dienstleistungserlöse an Empfänger im übrigen Ausland (Ziff. 221)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
  ],
  ['3420', 'Nicht steuerbare Erlöse (übrige, Leistungsort im Ausland)', T.REVENUE, 'PL.1', u, C.OUT_NON_TAXABLE],
  ['3800', 'Erlösminderungen (Rabatte, Preisnachlässe)', T.REVENUE, 'PL.1', R.REVENUE_REDUCTIONS],
  ['3801', 'Gewährte Skonti', T.REVENUE, 'PL.1', R.CASH_DISCOUNTS_GRANTED],
  ['3805', 'Verluste aus Forderungen (Debitorenverluste)', T.REVENUE, 'PL.1', R.BAD_DEBT],
  // Aufwand für Material, Waren und Dienstleistungen
  ['4200', 'Einkauf Handelswaren Normalsatz', T.EXPENSE, 'PL.3', u, C.IN_STANDARD],
  ['4201', 'Einkauf Handelswaren reduzierter Satz', T.EXPENSE, 'PL.3', u, C.IN_REDUCED],
  ['4280', 'Bestandesänderungen Handelswaren (Warenaufwand)', T.EXPENSE, 'PL.3', R.COST_OF_GOODS_SOLD],
  ['4400', 'Aufwand für bezogene Dienstleistungen', T.EXPENSE, 'PL.3', R.EXPENSE_DEFAULT],
  [
    '4401',
    'Bezogene Dienstleistungen aus der EU (Bezugsteuer)',
    T.EXPENSE,
    'PL.3',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
  ],
  [
    '4402',
    'Bezogene Dienstleistungen aus dem übrigen Ausland (Bezugsteuer)',
    T.EXPENSE,
    'PL.3',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
  ],
  ['4900', 'Erhaltene Skonti', T.EXPENSE, 'PL.3', R.CASH_DISCOUNTS_RECEIVED],
  // Übriger Betriebsaufwand, Abschreibungen, Finanzerfolg
  ['6510', 'Telefon und Internet', T.EXPENSE, 'PL.5'],
  ['6570', 'Informatikaufwand und Lizenzen', T.EXPENSE, 'PL.5'],
  ['6599', 'Rundungsdifferenzen', T.EXPENSE, 'PL.5', R.ROUNDING],
  ['6800', 'Abschreibungen Sachanlagen', T.EXPENSE, 'PL.6', R.DEPRECIATION],
  ['6940', 'Bankspesen und Zahlungsverkehrsgebühren', T.EXPENSE, 'PL.7b', R.PAYMENT_FEES],
  // 6900–6949 Finanzaufwand, 6950–6999 Finanzertrag (KMU numbering)
  ['6945', 'Kursverluste', T.EXPENSE, 'PL.7b', R.FX_LOSS],
  ['6990', 'Kursgewinne', T.REVENUE, 'PL.7a', R.FX_GAIN],
  // Ausserordentlicher Erfolg
  ['8500', 'Verluste aus Veräusserung von Anlagevermögen', T.EXPENSE, 'PL.9', R.ASSET_DISPOSAL_LOSS],
  ['8510', 'Gewinne aus Veräusserung von Anlagevermögen', T.REVENUE, 'PL.9', R.ASSET_DISPOSAL_GAIN],
  // Abschluss
  ['9100', 'Eröffnungsbilanz', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9101', 'Eröffnungsbilanz Debitoren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9102', 'Eröffnungsbilanz Kreditoren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/** MWST-Abrechnung effektive Methode (Formular ab 2024): `…T` boxes are the tax column of the respective Ziffer. */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'MWST Normalsatz 8,1 %',
    kind: K.OUTPUT,
    rate: 8.1,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '303',
    taxBox: '303T',
  },
  {
    code: C.OUT_REDUCED,
    name: 'MWST reduzierter Satz 2,6 %',
    kind: K.OUTPUT,
    rate: 2.6,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '313',
    taxBox: '313T',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'MWST Sondersatz Beherbergung 3,8 %',
    kind: K.OUTPUT,
    rate: 3.8,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '343',
    taxBox: '343T',
  },
  {
    code: C.OUT_ZERO,
    name: 'Von der Steuer befreite Leistungen (Exporte, Art. 23 MWSTG)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '220',
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Leistungen im Ausland (Ort der Leistung im Ausland)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '221',
  },
  {
    code: C.OUT_NON_TAXABLE,
    name: 'Nicht steuerbare Leistungen im Ausland (übrige)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '221',
  },
  {
    code: C.IN_STANDARD,
    name: 'Vorsteuer Normalsatz 8,1 %',
    kind: K.INPUT,
    rate: 8.1,
    accountRole: R.VAT_INPUT_STANDARD,
    taxBox: '400',
  },
  {
    code: C.IN_REDUCED,
    name: 'Vorsteuer reduzierter Satz 2,6 %',
    kind: K.INPUT,
    rate: 2.6,
    accountRole: R.VAT_INPUT_REDUCED,
    taxBox: '400',
  },
  { code: C.IN_NONE, name: 'Ohne Vorsteuer', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: 'Bezugsteuer – Dienstleistungen aus der EU 8,1 %',
    kind: K.REVERSE_CHARGE,
    rate: 8.1,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '383',
    taxBox: '383T',
    reverseTaxBox: '400',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Bezugsteuer – Dienstleistungen aus dem übrigen Ausland 8,1 %',
    kind: K.REVERSE_CHARGE,
    rate: 8.1,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '383',
    taxBox: '383T',
    reverseTaxBox: '400',
  },
];

export const CH_KMU_TEMPLATE: ChartTemplate = {
  key: 'CH-KMU',
  country: 'CH',
  name: 'Kontenplan KMU (Decabill-Auswahl)',
  description:
    'Schlanker Kontenplan in der in der Schweiz üblichen KMU-Nummerierung für OR-Abschlüsse und MWST (effektive Methode).',
  accountLength: 4,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Own minimal chart by Decabill using the customary Swiss SME account numbering. The KMU-Kontenrahmen (veb.ch / ' +
    'Sterchi) is copyrighted and is NOT reproduced; labels are Decabill’s own. Note: service revenue uses 3400 ' +
    '(3200 is customary for Handelserlöse). Statements per OR art. 959a / 959b (Produktionserfolgsrechnung). MWST ' +
    'Ziffern per the effective-method form valid from 2024 (8,1 / 2,6 / 3,8 %); Ziffern 302/312/342/382 cover ' +
    'pre-2024 rates and are manual. No OSS / ZM in Switzerland; EU B2B services are reported as Leistungen im ' +
    'Ausland (Ziffer 221). Saldosteuersatz method is not modelled. Account choices checked against the public ' +
    'Schulkontenrahmen KMU (kmu.admin.ch): 1170/1171 split by Ziffer, 2201 Abrechnungskonto MWST, 2206 ' +
    'Verrechnungssteuer, 6900/6950 Finanzaufwand/-ertrag, 8500/8510 ausserordentlicher Aufwand/Ertrag.',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'CH-OR-959A',
  name: 'Bilanz (Art. 959a OR)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.UV',
      label: '1. Umlaufvermögen',
      children: [
        { code: 'BS.UV.a', label: 'a. Flüssige Mittel und kurzfristig gehaltene Aktiven mit Börsenkurs' },
        { code: 'BS.UV.b', label: 'b. Forderungen aus Lieferungen und Leistungen' },
        { code: 'BS.UV.c', label: 'c. Übrige kurzfristige Forderungen' },
        { code: 'BS.UV.d', label: 'd. Vorräte und nicht fakturierte Dienstleistungen' },
        { code: 'BS.UV.e', label: 'e. Aktive Rechnungsabgrenzungen' },
      ],
    },
    {
      code: 'BS.AV',
      label: '2. Anlagevermögen',
      children: [
        { code: 'BS.AV.a', label: 'a. Finanzanlagen' },
        { code: 'BS.AV.b', label: 'b. Beteiligungen' },
        { code: 'BS.AV.c', label: 'c. Sachanlagen' },
        { code: 'BS.AV.d', label: 'd. Immaterielle Werte' },
        { code: 'BS.AV.e', label: 'e. Nicht einbezahltes Grund-, Gesellschafter- oder Stiftungskapital' },
      ],
    },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.KFK',
      label: '1. Kurzfristiges Fremdkapital',
      children: [
        { code: 'BS.KFK.a', label: 'a. Verbindlichkeiten aus Lieferungen und Leistungen' },
        { code: 'BS.KFK.b', label: 'b. Kurzfristige verzinsliche Verbindlichkeiten' },
        { code: 'BS.KFK.c', label: 'c. Übrige kurzfristige Verbindlichkeiten' },
        { code: 'BS.KFK.d', label: 'd. Passive Rechnungsabgrenzungen' },
      ],
    },
    {
      code: 'BS.LFK',
      label: '2. Langfristiges Fremdkapital',
      children: [
        { code: 'BS.LFK.a', label: 'a. Langfristige verzinsliche Verbindlichkeiten' },
        { code: 'BS.LFK.b', label: 'b. Übrige langfristige Verbindlichkeiten' },
        { code: 'BS.LFK.c', label: 'c. Rückstellungen sowie vom Gesetz vorgesehene ähnliche Positionen' },
      ],
    },
    {
      code: 'BS.EK',
      label: '3. Eigenkapital',
      children: [
        { code: 'BS.EK.a', label: 'a. Grund-, Gesellschafter- oder Stiftungskapital' },
        { code: 'BS.EK.b', label: 'b. Gesetzliche Kapitalreserve' },
        { code: 'BS.EK.c', label: 'c. Gesetzliche Gewinnreserve' },
        { code: 'BS.EK.d', label: 'd. Freiwillige Gewinnreserven' },
        { code: 'BS.EK.e', label: 'e. Eigene Kapitalanteile (Minusposten)' },
        { code: 'BS.EK.f', label: 'f. Gewinnvortrag oder Verlustvortrag' },
        { code: 'BS.EK.g', label: 'g. Jahresgewinn oder Jahresverlust' },
        { code: 'BS.EK.P', label: 'Privatkonto (Einzelunternehmen / Personengesellschaften)' },
      ],
    },
  ],
  resultPosition: 'BS.EK.g',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'CH-OR-959B',
  name: 'Erfolgsrechnung (Art. 959b Abs. 2 OR, Produktionserfolgsrechnung)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.1', label: '1. Nettoerlöse aus Lieferungen und Leistungen', sign: 1 },
    { code: 'PL.2', label: '2. Bestandesänderungen an unfertigen und fertigen Erzeugnissen', sign: 1 },
    { code: 'PL.3', label: '3. Materialaufwand', sign: -1 },
    { code: 'PL.4', label: '4. Personalaufwand', sign: -1 },
    { code: 'PL.5', label: '5. Übriger betrieblicher Aufwand', sign: -1 },
    { code: 'PL.6', label: '6. Abschreibungen und Wertberichtigungen auf Positionen des Anlagevermögens', sign: -1 },
    { code: 'PL.7a', label: '7. Finanzertrag', sign: 1 },
    { code: 'PL.7b', label: '7. Finanzaufwand', sign: -1 },
    { code: 'PL.8', label: '8. Betriebsfremder Aufwand und betriebsfremder Ertrag', sign: 1 },
    { code: 'PL.9', label: '9. Ausserordentlicher, einmaliger oder periodenfremder Aufwand und Ertrag', sign: 1 },
    { code: 'PL.10', label: '10. Direkte Steuern', sign: -1 },
  ],
};
const SUPPLIES = '302 + 303 + 312 + 313 + 342 + 343';
const DEDUCTIONS = '220 + 221 + 225 + 230 + 235 + 280';
const OUTPUT_TAX = '302T + 303T + 312T + 313T + 342T + 343T + 382T + 383T';
const INPUT_TAX = '400 + 405 + 410 - 415 - 420';
const MWST: VatReturnDefinition = {
  key: 'CH-MWST',
  name: 'MWST-Abrechnung (effektive Methode)',
  kind: 'periodic',
  // Quarterly by default; monthly on request; yearly on request since 2025 (Art. 35 Abs. 1bis MWSTG, turnover up to
  // CHF 5,005,000, with Akontozahlungen). Semesters (Saldosteuersatz method) are not modelled.
  periods: ['quarter', 'month', 'year'],
  boxes: [
    {
      box: '200',
      label: 'Total der vereinbarten bzw. vereinnahmten Entgelte',
      kind: 'computed',
      formula: `${SUPPLIES} + ${DEDUCTIONS}`,
    },
    {
      box: '205',
      label: 'In Ziffer 200 enthaltene Entgelte aus optierten ausgenommenen Leistungen (Art. 22)',
      kind: 'manual',
    },
    { box: '220', label: 'Von der Steuer befreite Leistungen (u. a. Exporte, Art. 23)', kind: 'base' },
    { box: '221', label: 'Leistungen im Ausland (Ort der Leistung im Ausland)', kind: 'base' },
    { box: '225', label: 'Übertragung im Meldeverfahren (Art. 38)', kind: 'manual' },
    { box: '230', label: 'Von der Steuer ausgenommene Inlandleistungen (Art. 21), ohne Option', kind: 'manual' },
    { box: '235', label: 'Entgeltsminderungen', kind: 'manual' },
    { box: '280', label: 'Diverses', kind: 'manual' },
    { box: '289', label: 'Total Abzüge (Ziffern 220–280)', kind: 'computed', formula: DEDUCTIONS },
    {
      box: '299',
      label: 'Steuerbarer Gesamtumsatz (Ziffer 200 abzüglich Ziffer 289)',
      kind: 'computed',
      formula: SUPPLIES,
    },
    { box: '302', label: 'Normalsatz 7,7 % (bis 31.12.2023) – Leistungen', kind: 'manual' },
    { box: '302T', label: 'Normalsatz 7,7 % – Steuer', kind: 'manual' },
    { box: '303', label: 'Normalsatz 8,1 % (ab 1.1.2024) – Leistungen', kind: 'base' },
    { box: '303T', label: 'Normalsatz 8,1 % – Steuer', kind: 'tax' },
    { box: '312', label: 'Reduzierter Satz 2,5 % (bis 31.12.2023) – Leistungen', kind: 'manual' },
    { box: '312T', label: 'Reduzierter Satz 2,5 % – Steuer', kind: 'manual' },
    { box: '313', label: 'Reduzierter Satz 2,6 % (ab 1.1.2024) – Leistungen', kind: 'base' },
    { box: '313T', label: 'Reduzierter Satz 2,6 % – Steuer', kind: 'tax' },
    { box: '342', label: 'Beherbergungssatz 3,7 % (bis 31.12.2023) – Leistungen', kind: 'manual' },
    { box: '342T', label: 'Beherbergungssatz 3,7 % – Steuer', kind: 'manual' },
    { box: '343', label: 'Beherbergungssatz 3,8 % (ab 1.1.2024) – Leistungen', kind: 'base' },
    { box: '343T', label: 'Beherbergungssatz 3,8 % – Steuer', kind: 'tax' },
    { box: '382', label: 'Bezugsteuer (bis 31.12.2023) – Entgelte', kind: 'manual' },
    { box: '382T', label: 'Bezugsteuer (bis 31.12.2023) – Steuer', kind: 'manual' },
    { box: '383', label: 'Bezugsteuer (ab 1.1.2024) – Entgelte', kind: 'base' },
    { box: '383T', label: 'Bezugsteuer (ab 1.1.2024) – Steuer', kind: 'tax' },
    { box: '399', label: 'Total geschuldete Steuer', kind: 'computed', formula: OUTPUT_TAX },
    { box: '400', label: 'Vorsteuer auf Material- und Dienstleistungsaufwand', kind: 'tax' },
    { box: '405', label: 'Vorsteuer auf Investitionen und übrigem Betriebsaufwand', kind: 'manual' },
    { box: '410', label: 'Einlageentsteuerung (Art. 32)', kind: 'manual' },
    { box: '415', label: 'Vorsteuerkorrekturen: gemischte Verwendung, Eigenverbrauch', kind: 'manual' },
    { box: '420', label: 'Vorsteuerkürzungen: Nicht-Entgelte (Art. 33 Abs. 2)', kind: 'manual' },
    { box: '479', label: 'Total Vorsteuer', kind: 'computed', formula: INPUT_TAX },
    {
      box: '500',
      label: 'Zu bezahlender Betrag',
      kind: 'computed',
      formula: `${OUTPUT_TAX} - 400 - 405 - 410 + 415 + 420`,
    },
    {
      box: '510',
      label: 'Guthaben der steuerpflichtigen Person',
      kind: 'computed',
      formula: `${INPUT_TAX} - ${OUTPUT_TAX.replace(/ \+ /g, ' - ')}`,
    },
  ],
  resultBox: '500',
  filingChannel: 'ESTV-Portal (MWST-Abrechnung online)',
  filingUrl: 'https://estvportal.estv.admin.ch',
  dueRule: '60 days after the end of the period (Art. 71 MWSTG)',
};
const FINAL: VatReturnDefinition = {
  ...MWST,
  key: 'CH-MWST-FINAL',
  name: 'Finalisierung der MWST-Abrechnungen (Jahresabstimmung)',
  kind: 'annual',
  periods: ['year'],
  dueRule:
    'Corrections in the return of the period containing the 180th day after fiscal year end (Art. 72 MWSTG), i.e. ' +
    'at the latest 240 days after the end of the fiscal year',
};

export const CH_PROFILE: AccountingCountryProfile = {
  country: 'CH',
  name: 'Schweiz / Suisse / Svizzera',
  defaultTemplate: 'CH-KMU',
  templates: ['CH-KMU'],
  vatReturns: [MWST, FINAL],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  exports: ['journal_csv', 'trial_balance_csv'],
  prerequisites: [
    {
      env: 'BILLING_ISSUER_TAX_NUMBER',
      label: 'UID / MWST-Nummer (CHE-… MWST)',
      requiredFor: ['CH-MWST', 'CH-MWST-FINAL'],
    },
  ],
  retention: { booksYears: 10, vouchersYears: 10 },
  defaultEinvoiceFormat: 'factur-x-en16931',
  mandatoryChart: false,
};
