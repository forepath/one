import {
  AccountingAccountRole as R,
  AccountingAccountType as T,
  TaxCodeKind as K,
} from '../../constants/accounting.constants';
import {
  type AccountingCountryProfile,
  CanonicalTaxCode as C,
  type ChartTemplate,
  type ChartTemplateAccount,
  type ChartTemplateTaxCode,
  type StatementLayout,
  type VatReturnDefinition,
} from '../accounting-profile.types';

/**
 * Germany: DATEV SKR 03 (process structure) and SKR 04 (statement structure) curated templates — the accounts
 * Decabill posts to plus the structural accounts for statements. Numbers follow the DATEV standard charts; labels
 * are Decabill's own. Admins can edit everything and import the full chart (DATEV Kontenbeschriftungen / CSV).
 */

type AccountRow = [
  skr03: string,
  skr04: string,
  name: string,
  type: T,
  position: string,
  role?: R,
  auto?: string,
  eur?: string,
];

/** HGB §266 balance sheet / §275(2) P&L positions and Anlage EÜR lines used by `statementPosition` / `cashBasis`. */
const ROWS: AccountRow[] = [
  // Fixed assets
  ['0027', '0135', 'EDV-Software', T.ASSET, 'BS.A.I', R.FIXED_ASSETS],
  ['0650', '0650', 'Büroeinrichtung', T.ASSET, 'BS.A.II'],
  ['0420', '0400', 'Technische Anlagen (Server, Hardware)', T.ASSET, 'BS.A.II'],
  ['0670', '0670', 'Geringwertige Wirtschaftsgüter', T.ASSET, 'BS.A.II', R.LOW_VALUE_ASSETS],
  ['0485', '0675', 'Wirtschaftsgüter (Sammelposten)', T.ASSET, 'BS.A.II', R.ASSET_POOL],
  // Equity
  ['0800', '2900', 'Gezeichnetes Kapital', T.EQUITY, 'BS.P.A.I'],
  ['0860', '2970', 'Gewinnvortrag vor Verwendung', T.EQUITY, 'BS.P.A.IV', R.RETAINED_EARNINGS],
  ['0868', '2978', 'Jahresergebnis (Vortrag Abschluss)', T.EQUITY, 'BS.P.A.V', R.ANNUAL_RESULT],
  ['1800', '2100', 'Privatentnahmen allgemein', T.EQUITY, 'BS.P.A.P', R.OWNER_DRAWINGS],
  ['1890', '2180', 'Privateinlagen', T.EQUITY, 'BS.P.A.P', R.OWNER_CONTRIBUTIONS],
  // Current assets
  ['3980', '1140', 'Bestand Waren', T.ASSET, 'BS.B.I', R.INVENTORY],
  ['1400', '1200', 'Forderungen aus Lieferungen und Leistungen', T.ASSET, 'BS.B.II.1', R.RECEIVABLES],
  ['1571', '1401', 'Abziehbare Vorsteuer 7 %', T.ASSET, 'BS.B.II.4', R.VAT_INPUT_REDUCED, undefined, 'EUR.A.vst'],
  ['1576', '1406', 'Abziehbare Vorsteuer 19 %', T.ASSET, 'BS.B.II.4', R.VAT_INPUT_STANDARD, undefined, 'EUR.A.vst'],
  [
    '1577',
    '1407',
    'Abziehbare Vorsteuer nach § 13b UStG 19 %',
    T.ASSET,
    'BS.B.II.4',
    R.VAT_INPUT_REVERSE_CHARGE,
    undefined,
    'EUR.A.vst',
  ],
  ['1780', '3820', 'Umsatzsteuer-Vorauszahlungen', T.LIABILITY, 'BS.P.C.8', R.VAT_PREPAYMENTS, undefined, 'EUR.A.ust'],
  ['1000', '1600', 'Kasse', T.ASSET, 'BS.B.IV', R.CASH],
  ['1200', '1800', 'Bank', T.ASSET, 'BS.B.IV', R.BANK],
  ['1210', '1810', 'Zahlungsdienstleister (Verrechnung)', T.ASSET, 'BS.B.IV', R.PROCESSOR_CLEARING],
  ['1360', '1460', 'Geldtransit', T.ASSET, 'BS.B.IV', R.CASH_IN_TRANSIT],
  ['1590', '1370', 'Durchlaufende Posten / Klärungskonto', T.ASSET, 'BS.B.II.4', R.SUSPENSE],
  // Liabilities
  ['1600', '3300', 'Verbindlichkeiten aus Lieferungen und Leistungen', T.LIABILITY, 'BS.P.C.4', R.PAYABLES],
  ['1710', '3250', 'Erhaltene Anzahlungen / Kundenguthaben', T.LIABILITY, 'BS.P.C.3', R.CUSTOMER_PREPAYMENTS],
  ['1771', '3801', 'Umsatzsteuer 7 %', T.LIABILITY, 'BS.P.C.8', R.VAT_OUTPUT_REDUCED, undefined, 'EUR.E.ust'],
  ['1776', '3806', 'Umsatzsteuer 19 %', T.LIABILITY, 'BS.P.C.8', R.VAT_OUTPUT_STANDARD, undefined, 'EUR.E.ust'],
  [
    '1787',
    '3837',
    'Umsatzsteuer nach § 13b UStG 19 %',
    T.LIABILITY,
    'BS.P.C.8',
    R.VAT_OUTPUT_REVERSE_CHARGE,
    undefined,
    'EUR.E.ust',
  ],
  [
    '1767',
    '3817',
    'Umsatzsteuer aus im anderen EU-Land steuerpflichtigen Leistungen (OSS)',
    T.LIABILITY,
    'BS.P.C.8',
    R.VAT_OUTPUT_OSS,
    undefined,
    'EUR.E.ust',
  ],
  ['1789', '3840', 'Umsatzsteuer laufendes Jahr', T.LIABILITY, 'BS.P.C.8', R.VAT_SETTLEMENT, undefined, 'EUR.A.ust'],
  ['1781', '3830', 'Umsatzsteuer-Vorauszahlung 1/11', T.LIABILITY, 'BS.P.C.8', undefined, undefined, 'EUR.A.ust'],
  // Revenue
  ['8400', '4400', 'Erlöse 19 % USt', T.REVENUE, 'PL.1', R.REVENUE_STANDARD, C.OUT_STANDARD, 'EUR.E.umsatz'],
  ['8300', '4300', 'Erlöse 7 % USt', T.REVENUE, 'PL.1', R.REVENUE_REDUCED, C.OUT_REDUCED, 'EUR.E.umsatz'],
  [
    '8120',
    '4120',
    'Steuerfreie Umsätze § 4 Nr. 1a UStG (Ausfuhr)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_TAX_FREE,
    C.OUT_ZERO,
    'EUR.E.frei',
  ],
  [
    '8336',
    '4336',
    'Erlöse sonstige Leistungen EU (Steuerschuldner Leistungsempfänger)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    'EUR.E.frei',
  ],
  [
    '8331',
    '4331',
    'Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (OSS)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_OSS,
    undefined,
    'EUR.E.umsatz',
  ],
  [
    '8338',
    '4338',
    'Erlöse aus im Drittland steuerbaren Leistungen',
    T.REVENUE,
    'PL.1',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    'EUR.E.frei',
  ],
  [
    '8339',
    '4339',
    'Erlöse aus im anderen EU-Land steuerbaren Leistungen (nicht steuerbar)',
    T.REVENUE,
    'PL.1',
    undefined,
    C.OUT_NON_TAXABLE,
    'EUR.E.frei',
  ],
  ['8700', '4700', 'Erlösschmälerungen', T.REVENUE, 'PL.1', R.REVENUE_REDUCTIONS, undefined, 'EUR.E.umsatz'],
  ['8730', '4730', 'Gewährte Skonti', T.REVENUE, 'PL.1', R.CASH_DISCOUNTS_GRANTED, undefined, 'EUR.E.umsatz'],
  ['2660', '4840', 'Erträge aus Kursdifferenzen', T.REVENUE, 'PL.4', R.FX_GAIN, undefined, 'EUR.E.sonst'],
  [
    '2315',
    '4855',
    'Anlagenabgänge Sachanlagen (Restbuchwert bei Buchgewinn)',
    T.REVENUE,
    'PL.4',
    R.ASSET_DISPOSAL_GAIN,
    undefined,
    'EUR.E.sonst',
  ],
  // Expenses
  ['3100', '5900', 'Fremdleistungen', T.EXPENSE, 'PL.5b', R.EXPENSE_DEFAULT, undefined, 'EUR.A.fremd'],
  [
    '3123',
    '5923',
    'Sonstige Leistungen EU-Unternehmer § 13b UStG 19 % VSt / 19 % USt',
    T.EXPENSE,
    'PL.5b',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    'EUR.A.fremd',
  ],
  [
    '3125',
    '5925',
    'Leistungen ausländischer Unternehmer § 13b UStG 19 % VSt / 19 % USt',
    T.EXPENSE,
    'PL.5b',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    'EUR.A.fremd',
  ],
  ['3400', '5400', 'Wareneingang 19 % Vorsteuer', T.EXPENSE, 'PL.5a', undefined, C.IN_STANDARD, 'EUR.A.waren'],
  ['3300', '5300', 'Wareneingang 7 % Vorsteuer', T.EXPENSE, 'PL.5a', undefined, C.IN_REDUCED, 'EUR.A.waren'],
  [
    '3200',
    '5200',
    'Wareneinsatz (Bestandsführung)',
    T.EXPENSE,
    'PL.5a',
    R.COST_OF_GOODS_SOLD,
    undefined,
    'EUR.A.waren',
  ],
  [
    '3736',
    '5736',
    'Erhaltene Skonti 19 % Vorsteuer',
    T.EXPENSE,
    'PL.5a',
    R.CASH_DISCOUNTS_RECEIVED,
    undefined,
    'EUR.A.waren',
  ],
  ['4830', '6220', 'Abschreibungen auf Sachanlagen', T.EXPENSE, 'PL.7', R.DEPRECIATION, undefined, 'EUR.A.afa'],
  [
    '4855',
    '6260',
    'Sofortabschreibung geringwertiger Wirtschaftsgüter',
    T.EXPENSE,
    'PL.7',
    undefined,
    undefined,
    'EUR.A.gwg',
  ],
  ['4806', '6495', 'Wartungskosten für Hard- und Software', T.EXPENSE, 'PL.8', undefined, undefined, 'EUR.A.sonst'],
  ['4920', '6805', 'Telefon', T.EXPENSE, 'PL.8', undefined, undefined, 'EUR.A.sonst'],
  ['4925', '6810', 'Telefax und Internetkosten', T.EXPENSE, 'PL.8', undefined, undefined, 'EUR.A.sonst'],
  [
    '4964',
    '6837',
    'Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen)',
    T.EXPENSE,
    'PL.8',
    undefined,
    undefined,
    'EUR.A.sonst',
  ],
  ['4970', '6855', 'Nebenkosten des Geldverkehrs', T.EXPENSE, 'PL.8', R.PAYMENT_FEES, undefined, 'EUR.A.sonst'],
  ['4900', '6300', 'Sonstige betriebliche Aufwendungen', T.EXPENSE, 'PL.8', undefined, undefined, 'EUR.A.sonst'],
  ['2400', '6930', 'Forderungsverluste (übliche Höhe)', T.EXPENSE, 'PL.8', R.BAD_DEBT, undefined, 'EUR.A.sonst'],
  ['2150', '6880', 'Aufwendungen aus Kursdifferenzen', T.EXPENSE, 'PL.8', R.FX_LOSS, undefined, 'EUR.A.sonst'],
  [
    '2310',
    '6895',
    'Anlagenabgänge Sachanlagen (Restbuchwert bei Buchverlust)',
    T.EXPENSE,
    'PL.8',
    R.ASSET_DISPOSAL_LOSS,
    undefined,
    'EUR.A.sonst',
  ],
  ['4909', '6309', 'Rundungsdifferenzen', T.EXPENSE, 'PL.8', R.ROUNDING, undefined, 'EUR.A.sonst'],
  // Carry-forward (statistical)
  ['9000', '9000', 'Saldenvorträge Sachkonten', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9008', '9008', 'Saldenvorträge Debitoren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9009', '9009', 'Saldenvorträge Kreditoren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/**
 * Tax codes: VAT return boxes per USt 1 A 2026 (`81`/`86` bases with derived tax `81T`/`86T`), BU keys only for
 * codes used on non-automatic accounts (OSS: DATEV country-specific keys are set per line via EU-Land/EU-Steuersatz).
 */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'Umsatzsteuer 19 %',
    kind: K.OUTPUT,
    rate: 19,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '81',
    taxBox: '81T',
    datevBuKey: '3',
  },
  {
    code: C.OUT_REDUCED,
    name: 'Umsatzsteuer 7 %',
    kind: K.OUTPUT,
    rate: 7,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '86',
    taxBox: '86T',
    datevBuKey: '2',
  },
  {
    code: C.OUT_ZERO,
    name: 'Steuerfreie Umsätze mit Vorsteuerabzug (§ 4 Nr. 1a)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '43',
    datevBuKey: '1',
  },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Sonstige Leistungen EU, Steuerschuldner Leistungsempfänger (§ 18b)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '21',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS: im anderen EU-Land steuerpflichtige Leistungen',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    oss: true,
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Nicht steuerbare Leistungen (Drittland)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '45',
  },
  {
    code: C.OUT_NON_TAXABLE,
    name: 'Nicht steuerbare Umsätze (Leistungsort im Ausland)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '45',
  },
  {
    code: C.IN_STANDARD,
    name: 'Vorsteuer 19 %',
    kind: K.INPUT,
    rate: 19,
    accountRole: R.VAT_INPUT_STANDARD,
    taxBox: '66',
    datevBuKey: '9',
  },
  {
    code: C.IN_REDUCED,
    name: 'Vorsteuer 7 %',
    kind: K.INPUT,
    rate: 7,
    accountRole: R.VAT_INPUT_REDUCED,
    taxBox: '66',
    datevBuKey: '8',
  },
  { code: C.IN_NONE, name: 'Ohne Vorsteuer', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: '§ 13b Leistungen EU-Unternehmer 19 %',
    kind: K.REVERSE_CHARGE,
    rate: 19,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '46',
    taxBox: '47',
    reverseTaxBox: '67',
    datevBuKey: '94',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: '§ 13b Leistungen ausländischer Unternehmer 19 %',
    kind: K.REVERSE_CHARGE,
    rate: 19,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '84',
    taxBox: '85',
    reverseTaxBox: '67',
    datevBuKey: '94',
  },
];

function buildTemplate(variant: 'SKR03' | 'SKR04'): ChartTemplate {
  const accounts: ChartTemplateAccount[] = ROWS.map(([skr03, skr04, name, type, position, role, auto, eur]) => ({
    number: variant === 'SKR03' ? skr03 : skr04,
    name,
    type,
    ...(role ? { role } : {}),
    statementPosition: position,
    ...(auto ? { automaticTaxCode: auto } : {}),
    ...(eur ? { externalCodes: { cashBasis: eur } } : {}),
  }));

  return {
    key: `DE-${variant}`,
    country: 'DE',
    name: variant === 'SKR03' ? 'DATEV SKR 03 (Prozessgliederung)' : 'DATEV SKR 04 (Abschlussgliederung)',
    description:
      variant === 'SKR03'
        ? 'Standardkontenrahmen 03 – nach dem Prozessgliederungsprinzip (Gemeinschaftskontenrahmen der Industrie).'
        : 'Standardkontenrahmen 04 – nach dem Abschlussgliederungsprinzip (Industriekontenrahmen).',
    accountLength: 4,
    accounts,
    taxCodes: TAX_CODES,
    source:
      'Curated subset of the DATEV standard chart (account numbers per DATEV Kontenrahmen 2026, Dok. 0907817; ' +
      'labels by Decabill). Import the full DATEV chart via Kontenbeschriftungen if needed. A chart change is only ' +
      'possible when a new fiscal year is opened (DATEV Dok. 5301516).',
  };
}

export const DE_SKR03_TEMPLATE = buildTemplate('SKR03');
export const DE_SKR04_TEMPLATE = buildTemplate('SKR04');

const BALANCE_SHEET: StatementLayout = {
  key: 'DE-HGB-266',
  name: 'Bilanz (§ 266 HGB)',
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
            { code: 'BS.B.II.4', label: '4. Sonstige Vermögensgegenstände' },
          ],
        },
        { code: 'BS.B.III', label: 'III. Wertpapiere' },
        { code: 'BS.B.IV', label: 'IV. Kassenbestand, Guthaben bei Kreditinstituten' },
      ],
    },
    { code: 'BS.C', label: 'C. Rechnungsabgrenzungsposten' },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.P.A',
      label: 'A. Eigenkapital',
      children: [
        { code: 'BS.P.A.I', label: 'I. Gezeichnetes Kapital' },
        { code: 'BS.P.A.IV', label: 'IV. Gewinnvortrag / Verlustvortrag' },
        { code: 'BS.P.A.V', label: 'V. Jahresüberschuss / Jahresfehlbetrag' },
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
  resultPosition: 'BS.P.A.V',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'DE-HGB-275-2',
  name: 'Gewinn- und Verlustrechnung (§ 275 Abs. 2 HGB, Gesamtkostenverfahren)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.1', label: '1. Umsatzerlöse', sign: 1 },
    { code: 'PL.2', label: '2. Bestandsveränderungen', sign: 1 },
    { code: 'PL.4', label: '4. Sonstige betriebliche Erträge', sign: 1 },
    {
      code: 'PL.5',
      label: '5. Materialaufwand',
      sign: -1,
      children: [
        {
          code: 'PL.5a',
          label: 'a) Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren',
          sign: -1,
        },
        { code: 'PL.5b', label: 'b) Aufwendungen für bezogene Leistungen', sign: -1 },
      ],
    },
    { code: 'PL.6', label: '6. Personalaufwand', sign: -1 },
    { code: 'PL.7', label: '7. Abschreibungen', sign: -1 },
    { code: 'PL.8', label: '8. Sonstige betriebliche Aufwendungen', sign: -1 },
    { code: 'PL.11', label: '11. Sonstige Zinsen und ähnliche Erträge', sign: 1 },
    { code: 'PL.13', label: '13. Zinsen und ähnliche Aufwendungen', sign: -1 },
    { code: 'PL.14', label: '14. Steuern vom Einkommen und vom Ertrag', sign: -1 },
    { code: 'PL.16', label: '16. Sonstige Steuern', sign: -1 },
  ],
};
const CASH_BASIS: StatementLayout = {
  key: 'DE-EUER',
  name: 'Einnahmenüberschussrechnung (§ 4 Abs. 3 EStG, Anlage EÜR)',
  kind: 'cash_basis',
  lines: [
    {
      code: 'EUR.E',
      label: 'Betriebseinnahmen',
      sign: 1,
      children: [
        { code: 'EUR.E.umsatz', label: 'Umsatzsteuerpflichtige Betriebseinnahmen', sign: 1 },
        { code: 'EUR.E.frei', label: 'Umsatzsteuerfreie, nicht steuerbare Betriebseinnahmen', sign: 1 },
        { code: 'EUR.E.ust', label: 'Vereinnahmte Umsatzsteuer', sign: 1 },
        { code: 'EUR.E.sonst', label: 'Sonstige Betriebseinnahmen', sign: 1 },
      ],
    },
    {
      code: 'EUR.A',
      label: 'Betriebsausgaben',
      sign: -1,
      children: [
        { code: 'EUR.A.waren', label: 'Waren, Roh- und Hilfsstoffe', sign: -1 },
        { code: 'EUR.A.fremd', label: 'Bezogene Fremdleistungen', sign: -1 },
        { code: 'EUR.A.afa', label: 'Absetzung für Abnutzung (AfA)', sign: -1 },
        { code: 'EUR.A.gwg', label: 'Geringwertige Wirtschaftsgüter / Sammelposten', sign: -1 },
        { code: 'EUR.A.sonst', label: 'Übrige Betriebsausgaben', sign: -1 },
        { code: 'EUR.A.vst', label: 'Gezahlte Vorsteuerbeträge', sign: -1 },
        { code: 'EUR.A.ust', label: 'An das Finanzamt gezahlte Umsatzsteuer', sign: -1 },
      ],
    },
  ],
};
const USTVA: VatReturnDefinition = {
  key: 'DE-USTVA',
  name: 'Umsatzsteuer-Voranmeldung',
  kind: 'periodic',
  periods: ['month', 'quarter'],
  boxes: [
    { box: '81', label: 'Steuerpflichtige Umsätze 19 % (Bemessungsgrundlage)', kind: 'base', roundDown: true },
    { box: '81T', label: 'Steuer auf Kz 81', kind: 'tax' },
    { box: '86', label: 'Steuerpflichtige Umsätze 7 % (Bemessungsgrundlage)', kind: 'base', roundDown: true },
    { box: '86T', label: 'Steuer auf Kz 86', kind: 'tax' },
    { box: '35', label: 'Umsätze zu anderen Steuersätzen (Bemessungsgrundlage)', kind: 'base', roundDown: true },
    { box: '36', label: 'Steuer auf Kz 35', kind: 'tax' },
    { box: '41', label: 'Innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.', kind: 'base', roundDown: true },
    { box: '43', label: 'Weitere steuerfreie Umsätze mit Vorsteuerabzug', kind: 'base', roundDown: true },
    { box: '48', label: 'Steuerfreie Umsätze ohne Vorsteuerabzug', kind: 'base', roundDown: true },
    {
      box: '21',
      label: 'Nicht steuerbare sonstige Leistungen EU (§ 18b, Leistungsempfänger schuldet die Steuer)',
      kind: 'base',
      roundDown: true,
    },
    {
      box: '45',
      label: 'Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)',
      kind: 'base',
      roundDown: true,
    },
    {
      box: '46',
      label: 'Sonstige Leistungen eines im übrigen Gemeinschaftsgebiet ansässigen Unternehmers (§ 13b)',
      kind: 'base',
      roundDown: true,
    },
    { box: '47', label: 'Steuer auf Kz 46', kind: 'tax' },
    { box: '84', label: 'Andere Leistungen (§ 13b Abs. 2 Nr. 1, 2, 4–12)', kind: 'base', roundDown: true },
    { box: '85', label: 'Steuer auf Kz 84', kind: 'tax' },
    { box: '66', label: 'Vorsteuerbeträge aus Rechnungen von anderen Unternehmern', kind: 'tax' },
    { box: '61', label: 'Vorsteuer aus innergemeinschaftlichem Erwerb', kind: 'tax' },
    { box: '62', label: 'Entstandene Einfuhrumsatzsteuer', kind: 'tax' },
    { box: '67', label: 'Vorsteuerbeträge aus Leistungen im Sinne des § 13b UStG', kind: 'tax' },
    { box: '39', label: 'Abzug der festgesetzten Sondervorauszahlung (nur Dezember / 4. Quartal)', kind: 'manual' },
    {
      box: '83',
      label: 'Verbleibende Umsatzsteuer-Vorauszahlung / Überschuss',
      kind: 'computed',
      formula: '81T + 86T + 36 + 47 + 85 - 66 - 61 - 62 - 67 - 39',
    },
  ],
  resultBox: '83',
  filingChannel: 'ELSTER (Mein ELSTER or tax advisor via DATEV)',
  filingUrl: 'https://www.elster.de',
  dueRule: '10th day after the period (one month later with Dauerfristverlängerung)',
};
const USTVA_ANNUAL: VatReturnDefinition = {
  ...USTVA,
  key: 'DE-UST-ANNUAL',
  name: 'Umsatzsteuererklärung (Jahreserklärung)',
  kind: 'annual',
  periods: ['year'],
  // No Sondervorauszahlung deduction in the annual return.
  boxes: USTVA.boxes
    .filter((b) => b.box !== '39')
    .map((b) =>
      b.box === '83'
        ? {
            ...b,
            label: 'Verbleibende Umsatzsteuer / Überschuss',
            formula: '81T + 86T + 36 + 47 + 85 - 66 - 61 - 62 - 67',
          }
        : b,
    ),
  dueRule: '31 July of the following year (later when filed by a tax advisor)',
};
const ZM: VatReturnDefinition = {
  key: 'DE-ZM',
  name: 'Zusammenfassende Meldung',
  kind: 'ec_sales_list',
  periods: ['month', 'quarter'],
  boxes: [],
  filingChannel: 'BZSt Online-Portal / ELSTER',
  filingUrl: 'https://www.elster.de',
  dueRule: '25th day after the period',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'OSS-Meldung (EU-Regelung)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'BZSt Online-Portal (form or CSV upload)',
  filingUrl: 'https://www.bzst.de',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const DE_PROFILE: AccountingCountryProfile = {
  country: 'DE',
  name: 'Deutschland',
  defaultTemplate: 'DE-SKR03',
  templates: ['DE-SKR03', 'DE-SKR04'],
  vatReturns: [USTVA, ZM, OSS, USTVA_ANNUAL],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  cashBasis: CASH_BASIS,
  exports: ['datev', 'gdpdu', 'saft', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [
    { env: 'BILLING_ISSUER_TAX_NUMBER', label: 'Steuernummer', requiredFor: ['DE-USTVA', 'DE-UST-ANNUAL'] },
    { env: 'BILLING_DATEV_CONSULTANT_NUMBER', label: 'DATEV Beraternummer', requiredFor: ['datev'] },
    { env: 'BILLING_DATEV_CLIENT_NUMBER', label: 'DATEV Mandantennummer', requiredFor: ['datev'] },
  ],
  retention: { booksYears: 10, vouchersYears: 8 },
  defaultEinvoiceFormat: 'factur-x-en16931',
  mandatoryChart: false,
};
