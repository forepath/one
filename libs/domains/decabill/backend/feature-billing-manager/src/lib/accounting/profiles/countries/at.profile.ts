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
 * Austria: curated subset following the Einheitskontenrahmen (EKR / ÖKR, customary, not mandatory). Class and group
 * structure per EKR (0 Anlagen, 1 Vorräte, 2 Forderungen/Geld, 3 Verbindlichkeiten, 4 Erträge, 5 Material,
 * 6 Personal, 7 sonstiger Aufwand, 8 Finanzerfolg, 9 Eigenkapital/Abschluss). Labels by Decabill.
 */

const u = undefined;
/** Custom template code: innergemeinschaftliche Lieferungen (UVA Kz 017 + ZM). */
const OUT_ICL = 'OUT_ICL';
/** Custom template code: 4,9 % für Grundnahrungsmittel (Anlage 3 UStG, BGBl. I Nr. 37/2026, ab 1.7.2026). */
const OUT_FOOD = 'OUT_RED49';
const ROWS: TemplateRow[] = [
  // Anlagevermögen
  // unverified: EKR group 01 sub-accounts (011 Patentrechte und Lizenzen vs. 012 Datenverarbeitungsprogramme)
  ['0110', 'Software (EDV-Programme)', T.ASSET, 'BS.A.I'],
  ['0620', 'EDV-Anlagen (Hardware)', T.ASSET, 'BS.A.II', R.FIXED_ASSETS],
  [
    '0660',
    'Betriebs- und Geschäftsausstattung (kein Sammelposten im österreichischen Recht)',
    T.ASSET,
    'BS.A.II',
    R.ASSET_POOL,
  ],
  ['0680', 'Geringwertige Wirtschaftsgüter (§ 13 EStG)', T.ASSET, 'BS.A.II', R.LOW_VALUE_ASSETS],
  // Umlaufvermögen
  ['1600', 'Handelswaren', T.ASSET, 'BS.B.I', R.INVENTORY],
  ['2000', 'Lieferforderungen Inland', T.ASSET, 'BS.B.II.1', R.RECEIVABLES],
  // unverified: 2390 / 2810 / 2880 are customary picks, not checked against the KFS/BW 6 edition
  ['2390', 'Verrechnungskonto / Klärungskonto', T.ASSET, 'BS.B.II.4', R.SUSPENSE],
  ['2500', 'Vorsteuer 20 %', T.ASSET, 'BS.B.II.4', R.VAT_INPUT_STANDARD, u, 'EAR.A.vst'],
  ['2505', 'Vorsteuer 10 % / 13 %', T.ASSET, 'BS.B.II.4', R.VAT_INPUT_REDUCED, u, 'EAR.A.vst'],
  ['2510', 'Vorsteuer Reverse Charge (§ 19 UStG)', T.ASSET, 'BS.B.II.4', R.VAT_INPUT_REVERSE_CHARGE, u, 'EAR.A.vst'],
  ['2700', 'Kassa', T.ASSET, 'BS.B.IV', R.CASH],
  ['2800', 'Bank', T.ASSET, 'BS.B.IV', R.BANK],
  ['2810', 'Zahlungsdienstleister (Verrechnung)', T.ASSET, 'BS.B.IV', R.PROCESSOR_CLEARING],
  ['2880', 'Schwebende Geldbewegungen', T.ASSET, 'BS.B.IV', R.CASH_IN_TRANSIT],
  // Verbindlichkeiten
  ['3200', 'Erhaltene Anzahlungen', T.LIABILITY, 'BS.P.C.3', R.CUSTOMER_PREPAYMENTS],
  ['3300', 'Lieferverbindlichkeiten Inland', T.LIABILITY, 'BS.P.C.4', R.PAYABLES],
  ['3500', 'Umsatzsteuer 20 %', T.LIABILITY, 'BS.P.C.8', R.VAT_OUTPUT_STANDARD, u, 'EAR.E.ust'],
  ['3501', 'Umsatzsteuer 10 % / 13 % / 4,9 %', T.LIABILITY, 'BS.P.C.8', R.VAT_OUTPUT_REDUCED, u, 'EAR.E.ust'],
  [
    '3505',
    'Umsatzsteuer Reverse Charge (§ 19 UStG)',
    T.LIABILITY,
    'BS.P.C.8',
    R.VAT_OUTPUT_REVERSE_CHARGE,
    u,
    'EAR.E.ust',
  ],
  [
    '3506',
    'Umsatzsteuer OSS (im übrigen Gemeinschaftsgebiet geschuldet)',
    T.LIABILITY,
    'BS.P.C.8',
    R.VAT_OUTPUT_OSS,
    u,
    'EAR.E.ust',
  ],
  ['3520', 'Umsatzsteuer-Zahllast', T.LIABILITY, 'BS.P.C.8', R.VAT_SETTLEMENT, u, 'EAR.A.ust'],
  ['3540', 'Finanzamt-Verrechnungskonto (Abgabenkonto)', T.LIABILITY, 'BS.P.C.8', R.VAT_PREPAYMENTS, u, 'EAR.A.ust'],
  // Erträge
  ['4000', 'Erlöse 20 %', T.REVENUE, 'PL.1', R.REVENUE_STANDARD, C.OUT_STANDARD, 'EAR.E.erl'],
  ['4010', 'Erlöse 10 %', T.REVENUE, 'PL.1', R.REVENUE_REDUCED, C.OUT_REDUCED, 'EAR.E.erl'],
  ['4013', 'Erlöse 13 %', T.REVENUE, 'PL.1', u, C.OUT_REDUCED_2, 'EAR.E.erl'],
  ['4015', 'Erlöse 4,9 % (Grundnahrungsmittel, ab 1.7.2026)', T.REVENUE, 'PL.1', u, OUT_FOOD, 'EAR.E.erl'],
  ['4100', 'Steuerfreie Ausfuhrlieferungen (§ 7 UStG)', T.REVENUE, 'PL.1', R.REVENUE_TAX_FREE, C.OUT_ZERO, 'EAR.E.erl'],
  ['4110', 'Innergemeinschaftliche Lieferungen (Art. 7 UStG-Binnenmarkt)', T.REVENUE, 'PL.1', u, OUT_ICL, 'EAR.E.erl'],
  [
    '4120',
    'Erlöse sonstige Leistungen EU (Reverse Charge, § 3a Abs. 6 UStG)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    'EAR.E.erl',
  ],
  [
    '4130',
    'Erlöse OSS (im übrigen Gemeinschaftsgebiet steuerpflichtig)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_OSS,
    u,
    'EAR.E.erl',
  ],
  [
    '4140',
    'Erlöse sonstige Leistungen Drittland (nicht steuerbar)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    'EAR.E.erl',
  ],
  ['4150', 'Nicht steuerbare Erlöse (Leistungsort im Ausland)', T.REVENUE, 'PL.1', u, C.OUT_NON_TAXABLE, 'EAR.E.erl'],
  ['4400', 'Erlösberichtigungen', T.REVENUE, 'PL.1', R.REVENUE_REDUCTIONS, u, 'EAR.E.erl'],
  ['4410', 'Kundenskonti', T.REVENUE, 'PL.1', R.CASH_DISCOUNTS_GRANTED, u, 'EAR.E.erl'],
  ['4600', 'Erträge aus dem Abgang von Anlagevermögen', T.REVENUE, 'PL.4a', R.ASSET_DISPOSAL_GAIN, u, 'EAR.E.sonst'],
  // unverified: 4880 / 7860 for exchange gains / losses and 7700 for software licences (EKR group 77 is usually
  // Versicherungen und Beiträge, licence expenses usually group 74) are Decabill picks
  ['4880', 'Kursgewinne', T.REVENUE, 'PL.4c', R.FX_GAIN, u, 'EAR.E.sonst'],
  // Material und bezogene Leistungen
  ['5000', 'Wareneinsatz', T.EXPENSE, 'PL.5a', R.COST_OF_GOODS_SOLD, u, 'EAR.A.waren'],
  ['5010', 'Wareneinkauf 20 % Vorsteuer', T.EXPENSE, 'PL.5a', u, C.IN_STANDARD, 'EAR.A.waren'],
  ['5011', 'Wareneinkauf 10 % Vorsteuer', T.EXPENSE, 'PL.5a', u, C.IN_REDUCED, 'EAR.A.waren'],
  ['5800', 'Bezogene Leistungen (Fremdleistungen)', T.EXPENSE, 'PL.5b', R.EXPENSE_DEFAULT, u, 'EAR.A.fremd'],
  [
    '5810',
    'Bezogene Leistungen EU (Reverse Charge § 19 UStG)',
    T.EXPENSE,
    'PL.5b',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    'EAR.A.fremd',
  ],
  [
    '5820',
    'Bezogene Leistungen Drittland (Reverse Charge § 19 UStG)',
    T.EXPENSE,
    'PL.5b',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    'EAR.A.fremd',
  ],
  ['5880', 'Lieferantenskonti', T.EXPENSE, 'PL.5a', R.CASH_DISCOUNTS_RECEIVED, u, 'EAR.A.waren'],
  // Abschreibungen und sonstiger Aufwand
  ['7010', 'Abschreibungen auf Sachanlagen', T.EXPENSE, 'PL.7', R.DEPRECIATION, u, 'EAR.A.afa'],
  ['7020', 'Sofortabschreibung geringwertiger Wirtschaftsgüter', T.EXPENSE, 'PL.7', u, u, 'EAR.A.afa'],
  ['7380', 'Telefon und Internet', T.EXPENSE, 'PL.8b', u, u, 'EAR.A.sonst'],
  ['7700', 'Software, Lizenzen und Wartung', T.EXPENSE, 'PL.8b', u, u, 'EAR.A.sonst'],
  ['7790', 'Spesen des Geldverkehrs', T.EXPENSE, 'PL.8b', R.PAYMENT_FEES, u, 'EAR.A.sonst'],
  ['7800', 'Forderungsverluste', T.EXPENSE, 'PL.8b', R.BAD_DEBT, u, 'EAR.A.sonst'],
  ['7820', 'Buchwert abgegangener Anlagen', T.EXPENSE, 'PL.8b', R.ASSET_DISPOSAL_LOSS, u, 'EAR.A.sonst'],
  ['7860', 'Kursverluste', T.EXPENSE, 'PL.8b', R.FX_LOSS, u, 'EAR.A.sonst'],
  ['7890', 'Rundungsdifferenzen', T.EXPENSE, 'PL.8b', R.ROUNDING, u, 'EAR.A.sonst'],
  ['7900', 'Sonstiger betrieblicher Aufwand', T.EXPENSE, 'PL.8b', u, u, 'EAR.A.sonst'],
  // Eigenkapital und Abschluss
  ['9000', 'Kapital', T.EQUITY, 'BS.P.A.I'],
  ['9390', 'Bilanzgewinn / Gewinnvortrag', T.EQUITY, 'BS.P.A.IV', R.RETAINED_EARNINGS],
  ['9400', 'Jahresergebnis', T.EQUITY, 'BS.P.A.IV', R.ANNUAL_RESULT],
  ['9600', 'Privatentnahmen', T.EQUITY, 'BS.P.A.P', R.OWNER_DRAWINGS],
  ['9610', 'Privateinlagen', T.EQUITY, 'BS.P.A.P', R.OWNER_CONTRIBUTIONS],
  ['9800', 'Eröffnungsbilanzkonto', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9801', 'Eröffnungsbilanzkonto Debitoren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9802', 'Eröffnungsbilanzkonto Kreditoren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/**
 * UVA (U 30) Kennzahlen: bases are entered per rate (`022`, `029`, `006`), the tax is derived (`…T` boxes are
 * Decabill's own ids for the derived tax). Sonstige Leistungen with place of supply abroad (EU B2B § 3a Abs. 6,
 * Drittland) are not steuerbar in Austria and are not entered in the UVA (only ZM for EU B2B).
 */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'Umsatzsteuer 20 %',
    kind: K.OUTPUT,
    rate: 20,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '022',
    taxBox: '022T',
  },
  {
    code: C.OUT_REDUCED,
    name: 'Umsatzsteuer 10 %',
    kind: K.OUTPUT,
    rate: 10,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '029',
    taxBox: '029T',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'Umsatzsteuer 13 %',
    kind: K.OUTPUT,
    rate: 13,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '006',
    taxBox: '006T',
  },
  {
    // unverified: Kz 124 assumed to be the 4,9 % base (BMF Prüfungen UVA ab 7/2026 list 124 among the rate Kennzahlen)
    code: OUT_FOOD,
    name: 'Umsatzsteuer 4,9 % (Grundnahrungsmittel, Anlage 3)',
    kind: K.OUTPUT,
    rate: 4.9,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '124',
    taxBox: '124T',
  },
  {
    code: C.OUT_ZERO,
    name: 'Steuerfreie Ausfuhrlieferungen (§ 6 Abs. 1 Z 1 iVm § 7)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '011',
  },
  {
    code: OUT_ICL,
    name: 'Innergemeinschaftliche Lieferungen (Art. 6 Abs. 1)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '017',
    ecSalesList: true,
  },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Sonstige Leistungen EU, Übergang der Steuerschuld (nur ZM)',
    kind: K.EXEMPT,
    rate: 0,
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS: im übrigen Gemeinschaftsgebiet steuerpflichtige Leistungen',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    oss: true,
  },
  { code: C.OUT_EXPORT_SERVICES, name: 'Nicht steuerbare sonstige Leistungen (Drittland)', kind: K.EXEMPT, rate: 0 },
  { code: C.OUT_NON_TAXABLE, name: 'Nicht steuerbare Umsätze (Leistungsort im Ausland)', kind: K.EXEMPT, rate: 0 },
  {
    code: C.IN_STANDARD,
    name: 'Vorsteuer 20 %',
    kind: K.INPUT,
    rate: 20,
    accountRole: R.VAT_INPUT_STANDARD,
    taxBox: '060',
  },
  {
    code: C.IN_REDUCED,
    name: 'Vorsteuer 10 %',
    kind: K.INPUT,
    rate: 10,
    accountRole: R.VAT_INPUT_REDUCED,
    taxBox: '060',
  },
  { code: C.IN_NONE, name: 'Ohne Vorsteuer', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: 'Reverse Charge § 19 Abs. 1 UStG – Leistungen EU-Unternehmer 20 %',
    kind: K.REVERSE_CHARGE,
    rate: 20,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    taxBox: '057',
    reverseTaxBox: '066',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Reverse Charge § 19 Abs. 1 UStG – Leistungen Drittlandsunternehmer 20 %',
    kind: K.REVERSE_CHARGE,
    rate: 20,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    taxBox: '057',
    reverseTaxBox: '066',
  },
];

export const AT_EKR_TEMPLATE: ChartTemplate = {
  key: 'AT-EKR',
  country: 'AT',
  name: 'Einheitskontenrahmen (EKR / ÖKR)',
  description:
    'Österreichischer Einheitskontenrahmen – Kontenklassen 0–9, üblich für UGB-Abschlüsse und Einnahmen-Ausgaben-Rechnung.',
  accountLength: 4,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Curated subset following the class/group structure of the Austrian Einheitskontenrahmen (EKR, customary, not ' +
    "legally mandatory); individual 4-digit account numbers within the groups are Decabill's selection and labels are " +
    "Decabill's own (verify against your EKR edition, e.g. 9400 Jahresergebnis, 2390 Klärungskonto). Statements per " +
    'UGB § 224 / § 231 Abs. 2 (GKV). UVA Kennzahlen per form U 30 and the BMF plausibility rules valid from 7/2026 ' +
    '(Kz 124 / 125 added for the 4,9 % rate on staple foods from 1 July 2026, BGBl. I Nr. 37/2026); ' +
    'innergemeinschaftliche Erwerbe and Einfuhrumsatzsteuer are manual. Austria has no Sammelposten: the asset-pool ' +
    'role is mapped to Betriebs- und Geschäftsausstattung.',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'AT-UGB-224',
  name: 'Bilanz (§ 224 UGB)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.A',
      label: 'A. Anlagevermögen',
      children: [
        { code: 'BS.A.I', label: 'I. Immaterielle Vermögensgegenstände' },
        { code: 'BS.A.II', label: 'II. Sachanlagen' },
        { code: 'BS.A.III', label: 'III. Finanzanlagen' },
      ],
    },
    {
      code: 'BS.B',
      label: 'B. Umlaufvermögen',
      children: [
        { code: 'BS.B.I', label: 'I. Vorräte' },
        {
          code: 'BS.B.II',
          label: 'II. Forderungen und sonstige Vermögensgegenstände',
          children: [
            { code: 'BS.B.II.1', label: '1. Forderungen aus Lieferungen und Leistungen' },
            { code: 'BS.B.II.4', label: '4. Sonstige Forderungen und Vermögensgegenstände' },
          ],
        },
        { code: 'BS.B.III', label: 'III. Wertpapiere und Anteile' },
        { code: 'BS.B.IV', label: 'IV. Kassenbestand, Schecks, Guthaben bei Kreditinstituten' },
      ],
    },
    { code: 'BS.C', label: 'C. Rechnungsabgrenzungsposten' },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.P.A',
      label: 'A. Eigenkapital',
      children: [
        { code: 'BS.P.A.I', label: 'I. Eingefordertes Nennkapital / Kapital' },
        { code: 'BS.P.A.IV', label: 'IV. Bilanzgewinn (Bilanzverlust), davon Gewinnvortrag' },
        { code: 'BS.P.A.P', label: 'Privatkonten (Einzelunternehmen / Personengesellschaften)' },
      ],
    },
    { code: 'BS.P.B', label: 'B. Rückstellungen' },
    {
      code: 'BS.P.C',
      label: 'C. Verbindlichkeiten',
      children: [
        { code: 'BS.P.C.3', label: '3. Erhaltene Anzahlungen auf Bestellungen' },
        { code: 'BS.P.C.4', label: '4. Verbindlichkeiten aus Lieferungen und Leistungen' },
        { code: 'BS.P.C.8', label: '8. Sonstige Verbindlichkeiten (davon aus Steuern)' },
      ],
    },
    { code: 'BS.P.D', label: 'D. Rechnungsabgrenzungsposten' },
  ],
  resultPosition: 'BS.P.A.IV',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'AT-UGB-231-2',
  name: 'Gewinn- und Verlustrechnung (§ 231 Abs. 2 UGB, Gesamtkostenverfahren)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.1', label: '1. Umsatzerlöse', sign: 1 },
    { code: 'PL.2', label: '2. Veränderung des Bestands an fertigen und unfertigen Erzeugnissen', sign: 1 },
    {
      code: 'PL.4',
      label: '4. Sonstige betriebliche Erträge',
      sign: 1,
      children: [
        {
          code: 'PL.4a',
          label: 'a) Erträge aus dem Abgang vom und der Zuschreibung zum Anlagevermögen mit Ausnahme der Finanzanlagen',
          sign: 1,
        },
        { code: 'PL.4c', label: 'c) Übrige', sign: 1 },
      ],
    },
    {
      code: 'PL.5',
      label: '5. Aufwendungen für Material und sonstige bezogene Herstellungsleistungen',
      sign: -1,
      children: [
        { code: 'PL.5a', label: 'a) Materialaufwand', sign: -1 },
        { code: 'PL.5b', label: 'b) Aufwendungen für bezogene Leistungen', sign: -1 },
      ],
    },
    { code: 'PL.6', label: '6. Personalaufwand', sign: -1 },
    { code: 'PL.7', label: '7. Abschreibungen', sign: -1 },
    {
      code: 'PL.8',
      label: '8. Sonstige betriebliche Aufwendungen',
      sign: -1,
      children: [
        { code: 'PL.8a', label: 'a) Steuern, soweit sie nicht unter Z 18 fallen', sign: -1 },
        { code: 'PL.8b', label: 'b) Übrige', sign: -1 },
      ],
    },
    { code: 'PL.12', label: '12. Sonstige Zinsen und ähnliche Erträge', sign: 1 },
    { code: 'PL.15', label: '15. Zinsen und ähnliche Aufwendungen', sign: -1 },
    { code: 'PL.18', label: '18. Steuern vom Einkommen und vom Ertrag', sign: -1 },
  ],
};
const CASH_BASIS: StatementLayout = {
  key: 'AT-EAR',
  name: 'Einnahmen-Ausgaben-Rechnung (§ 4 Abs. 3 EStG)',
  kind: 'cash_basis',
  lines: [
    {
      code: 'EAR.E',
      label: 'Betriebseinnahmen',
      sign: 1,
      children: [
        { code: 'EAR.E.erl', label: 'Erlöse (Waren- und Leistungserlöse)', sign: 1 },
        { code: 'EAR.E.sonst', label: 'Übrige Erträge', sign: 1 },
        { code: 'EAR.E.ust', label: 'Vereinnahmte Umsatzsteuer (Bruttomethode)', sign: 1 },
      ],
    },
    {
      code: 'EAR.A',
      label: 'Betriebsausgaben',
      sign: -1,
      children: [
        { code: 'EAR.A.waren', label: 'Waren, Rohstoffe, Hilfsstoffe', sign: -1 },
        { code: 'EAR.A.fremd', label: 'Fremdpersonal und Fremdleistungen', sign: -1 },
        { code: 'EAR.A.afa', label: 'Abschreibungen (AfA, geringwertige Wirtschaftsgüter)', sign: -1 },
        { code: 'EAR.A.sonst', label: 'Übrige Betriebsausgaben', sign: -1 },
        { code: 'EAR.A.vst', label: 'Bezahlte Vorsteuer (Bruttomethode)', sign: -1 },
        { code: 'EAR.A.ust', label: 'An das Finanzamt bezahlte Umsatzsteuer (Bruttomethode)', sign: -1 },
      ],
    },
  ],
};
const UVA: VatReturnDefinition = {
  key: 'AT-UVA',
  name: 'Umsatzsteuervoranmeldung (U 30)',
  kind: 'periodic',
  periods: ['month', 'quarter'],
  boxes: [
    {
      box: '000',
      label: 'Gesamtbetrag der Bemessungsgrundlagen für Lieferungen und sonstige Leistungen',
      kind: 'computed',
      formula: '022 + 029 + 006 + 124 + 011 + 017 + 021 - 001',
    },
    { box: '001', label: 'Zuzüglich Eigenverbrauch (§ 1 Abs. 1 Z 2, § 3 Abs. 2 und § 3a Abs. 1a)', kind: 'manual' },
    {
      box: '021',
      label:
        'Abzüglich Umsätze, für die die Steuerschuld auf den Leistungsempfänger übergeht (§ 19 Abs. 1 zweiter Satz, 1a–1e)',
      kind: 'manual',
    },
    { box: '011', label: 'Steuerfrei mit Vorsteuerabzug: Ausfuhrlieferungen (§ 6 Abs. 1 Z 1 iVm § 7)', kind: 'base' },
    {
      box: '017',
      label: 'Steuerfrei mit Vorsteuerabzug: Innergemeinschaftliche Lieferungen (Art. 6 Abs. 1)',
      kind: 'base',
    },
    { box: '022', label: 'Zu versteuern mit 20 % (Bemessungsgrundlage)', kind: 'base' },
    { box: '022T', label: 'Steuer auf Kz 022', kind: 'tax' },
    { box: '029', label: 'Zu versteuern mit 10 % (Bemessungsgrundlage)', kind: 'base' },
    { box: '029T', label: 'Steuer auf Kz 029', kind: 'tax' },
    { box: '006', label: 'Zu versteuern mit 13 % (Bemessungsgrundlage)', kind: 'base' },
    { box: '006T', label: 'Steuer auf Kz 006', kind: 'tax' },
    { box: '124', label: 'Zu versteuern mit 4,9 % (Bemessungsgrundlage, ab 7/2026)', kind: 'base' },
    { box: '124T', label: 'Steuer auf Kz 124', kind: 'tax' },
    { box: '070', label: 'Gesamtbetrag der Bemessungsgrundlagen für innergemeinschaftliche Erwerbe', kind: 'manual' },
    {
      box: '072',
      label: 'Innergemeinschaftliche Erwerbe zu versteuern mit 20 % (Bemessungsgrundlage)',
      kind: 'manual',
    },
    { box: '072T', label: 'Steuer auf Kz 072', kind: 'manual' },
    {
      box: '073',
      label: 'Innergemeinschaftliche Erwerbe zu versteuern mit 10 % (Bemessungsgrundlage)',
      kind: 'manual',
    },
    { box: '073T', label: 'Steuer auf Kz 073', kind: 'manual' },
    { box: '057', label: 'Steuerschuld gemäß § 19 Abs. 1 zweiter Satz, Abs. 1c, 1e sowie Art. 25 Abs. 5', kind: 'tax' },
    { box: '060', label: 'Gesamtbetrag der Vorsteuern (ohne die gesondert anzuführenden Beträge)', kind: 'tax' },
    {
      box: '061',
      label: 'Vorsteuern betreffend die entrichtete Einfuhrumsatzsteuer (§ 12 Abs. 1 Z 2 lit. a)',
      kind: 'manual',
    },
    {
      box: '083',
      label:
        'Vorsteuern betreffend die geschuldete, auf dem Abgabenkonto verbuchte Einfuhrumsatzsteuer (§ 12 Abs. 1 Z 2 lit. b)',
      kind: 'manual',
    },
    { box: '065', label: 'Vorsteuern aus dem innergemeinschaftlichen Erwerb', kind: 'manual' },
    {
      box: '066',
      label: 'Vorsteuern betreffend die Steuerschuld gemäß § 19 Abs. 1 zweiter Satz, Abs. 1c, 1e sowie Art. 25 Abs. 5',
      kind: 'tax',
    },
    { box: '090', label: 'Sonstige Berichtigungen', kind: 'manual' },
    {
      box: '095',
      label: 'Vorauszahlung (+) / Überschuss (−)',
      kind: 'computed',
      formula: '022T + 029T + 006T + 124T + 057 + 072T + 073T - 060 - 061 - 083 - 065 - 066 + 090',
    },
  ],
  resultBox: '095',
  filingChannel: 'FinanzOnline',
  filingUrl: 'https://finanzonline.bmf.gv.at',
  dueRule: '15th day of the second month after the period',
};
const U1: VatReturnDefinition = {
  ...UVA,
  key: 'AT-U1',
  name: 'Umsatzsteuererklärung (U 1)',
  kind: 'annual',
  periods: ['year'],
  dueRule: '30 April of the following year (30 June when filed electronically; later via tax advisor)',
};
const ZM: VatReturnDefinition = {
  key: 'AT-ZM',
  name: 'Zusammenfassende Meldung (U 13)',
  kind: 'ec_sales_list',
  periods: ['month', 'quarter'],
  boxes: [],
  filingChannel: 'FinanzOnline',
  filingUrl: 'https://finanzonline.bmf.gv.at',
  dueRule: 'End of the month after the period (same period as the UVA)',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'OSS-Erklärung (EU-Regelung)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'FinanzOnline',
  filingUrl: 'https://finanzonline.bmf.gv.at',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const AT_PROFILE: AccountingCountryProfile = {
  country: 'AT',
  name: 'Österreich',
  defaultTemplate: 'AT-EKR',
  templates: ['AT-EKR'],
  vatReturns: [UVA, ZM, OSS, U1],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  cashBasis: CASH_BASIS,
  exports: ['saft', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [{ env: 'BILLING_ISSUER_TAX_NUMBER', label: 'Steuernummer', requiredFor: ['AT-UVA', 'AT-U1'] }],
  retention: { booksYears: 7, vouchersYears: 7 },
  defaultEinvoiceFormat: 'ubl-en16931',
  mandatoryChart: false,
};
