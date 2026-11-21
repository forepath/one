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
 * Netherlands: no statutory chart. Curated chart with customary Dutch (decimal-system) numbering — 0 vaste activa /
 * eigen vermogen, 1 financiële rekeningen en btw, 2 tussenrekeningen, 3 voorraden, 4 kosten, 7 kostprijs, 8 omzet,
 * 9 technische rekeningen — plus level-3 Referentie Grootboekschema (RGS) reference codes in `externalCodes.rgs`
 * for mapping to SBR / XAF consumers. The account numbers are not RGS numbers.
 */

const u = undefined;
/** Custom template code: intracommunautaire leveringen (OB rubriek 3b + ICP). */
const OUT_ICL = 'OUT_ICL';
const rgs = (code: string): Record<string, string> => ({ rgs: code });
const ROWS: TemplateRow[] = [
  // Vaste activa
  ['0100', 'Software en licenties', T.ASSET, 'BS.VA.imm', u, u, u, rgs('BIva')],
  ['0200', 'Computerapparatuur', T.ASSET, 'BS.VA.mat', R.FIXED_ASSETS, u, u, rgs('BMva')],
  ['0210', 'Inventaris (geen fiscale pool in Nederland)', T.ASSET, 'BS.VA.mat', R.ASSET_POOL, u, u, rgs('BMva')],
  ['0220', 'Kleine bedrijfsmiddelen (geactiveerd)', T.ASSET, 'BS.VA.mat', R.LOW_VALUE_ASSETS, u, u, rgs('BMva')],
  // Eigen vermogen
  ['0500', 'Gestort en opgevraagd kapitaal', T.EQUITY, 'BS.EV.kap', u, u, u, rgs('BEivGok')],
  ['0510', 'Overige reserves', T.EQUITY, 'BS.EV.ovr', R.RETAINED_EARNINGS, u, u, rgs('BEivOvr')],
  ['0520', 'Onverdeeld resultaat boekjaar', T.EQUITY, 'BS.EV.res', R.ANNUAL_RESULT, u, u, rgs('BEivOre')],
  ['0530', 'Privé-opnamen', T.EQUITY, 'BS.EV.prive', R.OWNER_DRAWINGS, u, u, rgs('BEivKap')],
  ['0540', 'Privé-stortingen', T.EQUITY, 'BS.EV.prive', R.OWNER_CONTRIBUTIONS, u, u, rgs('BEivKap')],
  // Financiële rekeningen
  ['1000', 'Kas', T.ASSET, 'BS.VL.liq', R.CASH, u, u, rgs('BLimKas')],
  ['1100', 'Bank', T.ASSET, 'BS.VL.liq', R.BANK, u, u, rgs('BLimBan')],
  ['1110', 'Betaaldienstverleners (tussenrekening)', T.ASSET, 'BS.VL.liq', R.PROCESSOR_CLEARING, u, u, rgs('BLimBan')],
  ['1190', 'Kruisposten (geld onderweg)', T.ASSET, 'BS.VL.liq', R.CASH_IN_TRANSIT, u, u, rgs('BLimKru')],
  ['1300', 'Debiteuren', T.ASSET, 'BS.VL.deb', R.RECEIVABLES, u, u, rgs('BVorDebHad')],
  ['1500', 'Voorbelasting hoog tarief', T.ASSET, 'BS.VL.ovv', R.VAT_INPUT_STANDARD, u, u, rgs('BSchBepBtw')],
  ['1501', 'Voorbelasting laag tarief', T.ASSET, 'BS.VL.ovv', R.VAT_INPUT_REDUCED, u, u, rgs('BSchBepBtw')],
  ['1502', 'Voorbelasting verlegde btw', T.ASSET, 'BS.VL.ovv', R.VAT_INPUT_REVERSE_CHARGE, u, u, rgs('BSchBepBtw')],
  ['1510', 'Af te dragen btw hoog tarief', T.LIABILITY, 'BS.KS.bel', R.VAT_OUTPUT_STANDARD, u, u, rgs('BSchBepBtw')],
  ['1511', 'Af te dragen btw laag tarief', T.LIABILITY, 'BS.KS.bel', R.VAT_OUTPUT_REDUCED, u, u, rgs('BSchBepBtw')],
  ['1512', 'Af te dragen verlegde btw', T.LIABILITY, 'BS.KS.bel', R.VAT_OUTPUT_REVERSE_CHARGE, u, u, rgs('BSchBepBtw')],
  [
    '1513',
    'Btw OSS (verschuldigd in andere EU-lidstaten)',
    T.LIABILITY,
    'BS.KS.bel',
    R.VAT_OUTPUT_OSS,
    u,
    u,
    rgs('BSchBepBtw'),
  ],
  [
    '1520',
    'Btw-afdracht (af te dragen per aangifte)',
    T.LIABILITY,
    'BS.KS.bel',
    R.VAT_SETTLEMENT,
    u,
    u,
    rgs('BSchBepBtw'),
  ],
  [
    '1530',
    'Btw-betalingen aan de Belastingdienst',
    T.LIABILITY,
    'BS.KS.bel',
    R.VAT_PREPAYMENTS,
    u,
    u,
    rgs('BSchBepBtw'),
  ],
  ['1600', 'Crediteuren', T.LIABILITY, 'BS.KS.lev', R.PAYABLES, u, u, rgs('BSchCreHac')],
  [
    '1650',
    'Vooruitontvangen bedragen van klanten',
    T.LIABILITY,
    'BS.KS.voo',
    R.CUSTOMER_PREPAYMENTS,
    u,
    u,
    rgs('BSchVob'),
  ],
  ['2000', 'Vraagposten / tussenrekening', T.ASSET, 'BS.VL.ovv', R.SUSPENSE, u, u, rgs('BVorTus')],
  // Voorraden
  ['3000', 'Handelsgoederen', T.ASSET, 'BS.VL.voorraden', R.INVENTORY, u, u, rgs('BVrdHan')],
  // Kosten
  ['4000', 'Uitbesteed werk en externe diensten', T.EXPENSE, 'PL.uitbesteed', R.EXPENSE_DEFAULT, u, u, rgs('WKprKuw')],
  [
    '4010',
    'Diensten uit EU-landen (btw verlegd)',
    T.EXPENSE,
    'PL.uitbesteed',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    u,
    rgs('WKprKuw'),
  ],
  [
    '4020',
    'Diensten uit niet-EU-landen (btw verlegd)',
    T.EXPENSE,
    'PL.uitbesteed',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    u,
    rgs('WKprKuw'),
  ],
  ['4300', 'Telefoon en internet', T.EXPENSE, 'PL.ovbk', u, u, u, rgs('WBedKan')],
  ['4310', 'Software en licenties (kosten)', T.EXPENSE, 'PL.ovbk', u, u, u, rgs('WBedKan')],
  ['4400', 'Bankkosten en transactiekosten', T.EXPENSE, 'PL.ovbk', R.PAYMENT_FEES, u, u, rgs('WBedAdl')],
  ['4500', 'Afschrijvingen materiële vaste activa', T.EXPENSE, 'PL.afschr', R.DEPRECIATION, u, u, rgs('WAfsAmv')],
  ['4600', 'Oninbare vorderingen', T.EXPENSE, 'PL.ovbk', R.BAD_DEBT, u, u, rgs('WBedVkk')],
  ['4610', 'Boekverlies verkoop vaste activa', T.EXPENSE, 'PL.ovbk', R.ASSET_DISPOSAL_LOSS, u, u, rgs('WAfsRvm')],
  ['4620', 'Koersverschillen (verlies)', T.EXPENSE, 'PL.finl', R.FX_LOSS, u, u, rgs('WFbe')],
  ['4690', 'Afrondingsverschillen', T.EXPENSE, 'PL.ovbk', R.ROUNDING, u, u, rgs('WBedAdl')],
  // Kostprijs
  ['7000', 'Inkoopwaarde van de omzet', T.EXPENSE, 'PL.kostprijs', R.COST_OF_GOODS_SOLD, u, u, rgs('WKprInh')],
  ['7010', 'Inkopen hoog tarief', T.EXPENSE, 'PL.kostprijs', u, C.IN_STANDARD, u, rgs('WKprInh')],
  ['7011', 'Inkopen laag tarief', T.EXPENSE, 'PL.kostprijs', u, C.IN_REDUCED, u, rgs('WKprInh')],
  ['7090', 'Ontvangen betalingskortingen', T.EXPENSE, 'PL.kostprijs', R.CASH_DISCOUNTS_RECEIVED, u, u, rgs('WKprInh')],
  // Omzet
  ['8000', 'Omzet hoog tarief (21 %)', T.REVENUE, 'PL.omzet', R.REVENUE_STANDARD, C.OUT_STANDARD, u, rgs('WOmzNod')],
  ['8010', 'Omzet laag tarief (9 %)', T.REVENUE, 'PL.omzet', R.REVENUE_REDUCED, C.OUT_REDUCED, u, rgs('WOmzNod')],
  ['8020', 'Omzet export buiten de EU (0 %)', T.REVENUE, 'PL.omzet', R.REVENUE_TAX_FREE, C.OUT_ZERO, u, rgs('WOmzNoh')],
  ['8025', 'Omzet intracommunautaire leveringen', T.REVENUE, 'PL.omzet', u, OUT_ICL, u, rgs('WOmzNoh')],
  [
    '8030',
    'Omzet diensten binnen de EU (btw verlegd)',
    T.REVENUE,
    'PL.omzet',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    u,
    rgs('WOmzNod'),
  ],
  [
    '8040',
    'Omzet OSS (particulieren in andere EU-lidstaten)',
    T.REVENUE,
    'PL.omzet',
    R.REVENUE_OSS,
    u,
    u,
    rgs('WOmzNod'),
  ],
  [
    '8050',
    'Omzet diensten buiten de EU',
    T.REVENUE,
    'PL.omzet',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    u,
    rgs('WOmzNod'),
  ],
  ['8060', 'Omzet niet bij u belast (overig)', T.REVENUE, 'PL.omzet', u, C.OUT_NON_TAXABLE, u, rgs('WOmzNod')],
  ['8090', 'Kortingen en creditnota’s op omzet', T.REVENUE, 'PL.omzet', R.REVENUE_REDUCTIONS, u, u, rgs('WOmzKeb')],
  ['8095', 'Verleende betalingskortingen', T.REVENUE, 'PL.omzet', R.CASH_DISCOUNTS_GRANTED, u, u, rgs('WOmzKeb')],
  ['8400', 'Boekwinst verkoop vaste activa', T.REVENUE, 'PL.overig', R.ASSET_DISPOSAL_GAIN, u, u, rgs('WAfsRvm')],
  ['8410', 'Koersverschillen (winst)', T.REVENUE, 'PL.finb', R.FX_GAIN, u, u, rgs('WFbe')],
  // Technisch
  ['9990', 'Beginbalans (technische rekening)', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9991', 'Beginbalans debiteuren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9992', 'Beginbalans crediteuren', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/** OB-aangifte rubrieken; `…T` boxes are the btw columns of the respective rubriek. */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'Btw hoog tarief 21 %',
    kind: K.OUTPUT,
    rate: 21,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '1a',
    taxBox: '1aT',
  },
  {
    code: C.OUT_REDUCED,
    name: 'Btw laag tarief 9 %',
    kind: K.OUTPUT,
    rate: 9,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '1b',
    taxBox: '1bT',
  },
  { code: C.OUT_ZERO, name: 'Leveringen naar landen buiten de EU (uitvoer)', kind: K.EXEMPT, rate: 0, baseBox: '3a' },
  { code: OUT_ICL, name: 'Intracommunautaire leveringen', kind: K.EXEMPT, rate: 0, baseBox: '3b', ecSalesList: true },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Diensten in landen binnen de EU (btw verlegd)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '3b',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS: btw verschuldigd in andere EU-lidstaten',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    oss: true,
  },
  // Services to customers outside the EU that are taxed there are not reported in the aangifte (Belastingdienst:
  // "Btw-aangifte doen als u diensten levert aan afnemers in landen buiten de EU"); rubriek 1e is for domestic
  // 0 % / reverse-charge supplies.
  { code: C.OUT_EXPORT_SERVICES, name: 'Diensten buiten de EU (niet in de aangifte)', kind: K.EXEMPT, rate: 0 },
  { code: C.OUT_NON_TAXABLE, name: 'Leveringen/diensten buiten Nederland belast (overig)', kind: K.EXEMPT, rate: 0 },
  {
    code: C.IN_STANDARD,
    name: 'Voorbelasting 21 %',
    kind: K.INPUT,
    rate: 21,
    accountRole: R.VAT_INPUT_STANDARD,
    taxBox: '5b',
  },
  {
    code: C.IN_REDUCED,
    name: 'Voorbelasting 9 %',
    kind: K.INPUT,
    rate: 9,
    accountRole: R.VAT_INPUT_REDUCED,
    taxBox: '5b',
  },
  { code: C.IN_NONE, name: 'Geen voorbelasting', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: 'Verlegde btw – diensten uit EU-landen 21 %',
    kind: K.REVERSE_CHARGE,
    rate: 21,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '4b',
    taxBox: '4bT',
    reverseTaxBox: '5b',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Verlegde btw – diensten uit niet-EU-landen 21 %',
    kind: K.REVERSE_CHARGE,
    rate: 21,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '4a',
    taxBox: '4aT',
    reverseTaxBox: '5b',
  },
];

export const NL_RGS_TEMPLATE: ChartTemplate = {
  key: 'NL-RGS',
  country: 'NL',
  name: 'Grootboekschema op basis van RGS',
  description: 'Beknopt grootboekschema met gangbare Nederlandse nummering en Referentie Grootboekschema-codes (RGS).',
  accountLength: 4,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Decabill chart (no statutory chart in the Netherlands) with customary numbering; RGS codes are level-3 ' +
    'reference codes checked against an RGS 3.8 selection (BLim…, BVorDebHad, BSchCreHac, BSchBepBtw, BSchVob, ' +
    'WOmzNod/WOmzNoh, WKprKuw/WKprInh, WAfsAmv/WAfsRvm, WBedKan/WBedAdl/WBedVkk, WFbe); BEivKap for privé-' +
    'rekeningen is unverified. Statements follow the Besluit modellen jaarrekening (model A balans, model E ' +
    'winst-en-verliesrekening). OB rubrieken per the current aangifte; services to non-EU customers taxed abroad are ' +
    'not reported; rubriek 5d (KOR-vermindering) is no longer used since the 2020 KOR reform.',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'NL-BW2-BALANS',
  name: 'Balans (BW2 Titel 9, Besluit modellen jaarrekening – model A)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.VA',
      label: 'Vaste activa',
      children: [
        { code: 'BS.VA.imm', label: 'Immateriële vaste activa' },
        { code: 'BS.VA.mat', label: 'Materiële vaste activa' },
        { code: 'BS.VA.fin', label: 'Financiële vaste activa' },
      ],
    },
    {
      code: 'BS.VL',
      label: 'Vlottende activa',
      children: [
        { code: 'BS.VL.voorraden', label: 'Voorraden' },
        { code: 'BS.VL.deb', label: 'Vorderingen op handelsdebiteuren' },
        { code: 'BS.VL.ovv', label: 'Overige vorderingen en overlopende activa' },
        { code: 'BS.VL.eff', label: 'Effecten' },
        { code: 'BS.VL.liq', label: 'Liquide middelen' },
      ],
    },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.EV',
      label: 'Eigen vermogen',
      children: [
        { code: 'BS.EV.kap', label: 'Gestort en opgevraagd kapitaal' },
        { code: 'BS.EV.ovr', label: 'Overige reserves' },
        { code: 'BS.EV.res', label: 'Onverdeeld resultaat' },
        { code: 'BS.EV.prive', label: 'Privé (eenmanszaak / vennootschap onder firma)' },
      ],
    },
    { code: 'BS.VZ', label: 'Voorzieningen' },
    { code: 'BS.LS', label: 'Langlopende schulden' },
    {
      code: 'BS.KS',
      label: 'Kortlopende schulden',
      children: [
        { code: 'BS.KS.lev', label: 'Schulden aan leveranciers en handelskredieten' },
        { code: 'BS.KS.voo', label: 'Ontvangen vooruitbetalingen op bestellingen' },
        { code: 'BS.KS.bel', label: 'Belastingen en premies sociale verzekeringen' },
        { code: 'BS.KS.ov', label: 'Overige schulden en overlopende passiva' },
      ],
    },
  ],
  resultPosition: 'BS.EV.res',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'NL-BW2-WV',
  name: 'Winst-en-verliesrekening (categoriale indeling, art. 2:377 lid 3 BW – model E)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.omzet', label: 'Netto-omzet', sign: 1 },
    { code: 'PL.overig', label: 'Overige bedrijfsopbrengsten', sign: 1 },
    { code: 'PL.kostprijs', label: 'Kosten van grond- en hulpstoffen / inkoopwaarde van de omzet', sign: -1 },
    { code: 'PL.uitbesteed', label: 'Kosten uitbesteed werk en andere externe kosten', sign: -1 },
    { code: 'PL.lonen', label: 'Lonen, salarissen en sociale lasten', sign: -1 },
    { code: 'PL.afschr', label: 'Afschrijvingen op immateriële en materiële vaste activa', sign: -1 },
    { code: 'PL.ovbk', label: 'Overige bedrijfskosten', sign: -1 },
    { code: 'PL.finb', label: 'Rentebaten en soortgelijke opbrengsten', sign: 1 },
    { code: 'PL.finl', label: 'Rentelasten en soortgelijke kosten', sign: -1 },
    { code: 'PL.bel', label: 'Belastingen over de winst', sign: -1 },
  ],
};
const OB: VatReturnDefinition = {
  key: 'NL-OB',
  name: 'Aangifte omzetbelasting',
  kind: 'periodic',
  periods: ['quarter', 'month'],
  boxes: [
    { box: '1a', label: 'Leveringen/diensten belast met hoog tarief (omzet)', kind: 'base', roundDown: true },
    { box: '1aT', label: 'Btw rubriek 1a', kind: 'tax' },
    { box: '1b', label: 'Leveringen/diensten belast met laag tarief (omzet)', kind: 'base', roundDown: true },
    { box: '1bT', label: 'Btw rubriek 1b', kind: 'tax' },
    { box: '1c', label: 'Leveringen/diensten belast met overige tarieven, behalve 0 %', kind: 'manual' },
    { box: '1cT', label: 'Btw rubriek 1c', kind: 'manual' },
    { box: '1d', label: 'Privégebruik', kind: 'manual' },
    { box: '1dT', label: 'Btw rubriek 1d', kind: 'manual' },
    { box: '1e', label: 'Leveringen/diensten belast met 0 % of niet bij u belast', kind: 'manual' },
    {
      box: '2a',
      label: 'Leveringen/diensten waarbij de heffing van omzetbelasting naar u is verlegd (binnenland)',
      kind: 'manual',
    },
    { box: '2aT', label: 'Btw rubriek 2a', kind: 'manual' },
    { box: '3a', label: 'Leveringen naar landen buiten de EU (uitvoer)', kind: 'base', roundDown: true },
    { box: '3b', label: 'Leveringen naar of diensten in landen binnen de EU', kind: 'base', roundDown: true },
    { box: '3c', label: 'Installatie/afstandsverkopen binnen de EU', kind: 'manual' },
    { box: '4a', label: 'Leveringen/diensten uit landen buiten de EU', kind: 'base', roundDown: true },
    { box: '4aT', label: 'Btw rubriek 4a', kind: 'tax' },
    { box: '4b', label: 'Leveringen/diensten uit landen binnen de EU', kind: 'base', roundDown: true },
    { box: '4bT', label: 'Btw rubriek 4b', kind: 'tax' },
    {
      box: '5a',
      label: 'Verschuldigde omzetbelasting (rubrieken 1a t/m 4b)',
      kind: 'computed',
      formula: '1aT + 1bT + 1cT + 1dT + 2aT + 4aT + 4bT',
    },
    { box: '5b', label: 'Voorbelasting', kind: 'tax' },
    {
      box: '5c',
      label: 'Subtotaal (5a min 5b)',
      kind: 'computed',
      formula: '1aT + 1bT + 1cT + 1dT + 2aT + 4aT + 4bT - 5b',
    },
    {
      box: '5d',
      label: 'Vermindering volgens de kleineondernemersregeling (niet meer in gebruik sinds 2020)',
      kind: 'manual',
    },
    // unverified: sign handling of the estimate rubrieken 5e / 5f in 5g; they are shown for manual entry only.
    { box: '5e', label: 'Schatting vorige aangifte(n)', kind: 'manual' },
    { box: '5f', label: 'Schatting deze aangifte', kind: 'manual' },
    {
      box: '5g',
      label: 'Totaal te betalen / terug te vragen',
      kind: 'computed',
      formula: '1aT + 1bT + 1cT + 1dT + 2aT + 4aT + 4bT - 5b - 5d',
    },
  ],
  resultBox: '5g',
  filingChannel: 'Mijn Belastingdienst Zakelijk (or SBR software)',
  filingUrl: 'https://www.belastingdienst.nl',
  dueRule: 'End of the month after the period',
};
const ICP: VatReturnDefinition = {
  key: 'NL-ICP',
  name: 'Opgaaf intracommunautaire prestaties (ICP)',
  kind: 'ec_sales_list',
  periods: ['quarter', 'month'],
  boxes: [],
  filingChannel: 'Mijn Belastingdienst Zakelijk',
  filingUrl: 'https://www.belastingdienst.nl',
  dueRule: 'End of the month after the period',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'OSS-aangifte (EU-regeling)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'Mijn Belastingdienst Zakelijk',
  filingUrl: 'https://www.belastingdienst.nl',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const NL_PROFILE: AccountingCountryProfile = {
  country: 'NL',
  name: 'Nederland',
  defaultTemplate: 'NL-RGS',
  templates: ['NL-RGS'],
  vatReturns: [OB, ICP, OSS],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  exports: ['xaf', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [
    {
      env: 'BILLING_ISSUER_TAX_NUMBER',
      label: 'Btw-identificatienummer (btw-id) / omzetbelastingnummer',
      requiredFor: ['NL-OB', 'NL-ICP'],
    },
  ],
  // 7 years (art. 52 lid 4 AWR, art. 2:10 lid 3 BW); 10 years for immovable-property data is not relevant here.
  retention: { booksYears: 7, vouchersYears: 7 },
  defaultEinvoiceFormat: 'peppol-bis-3',
  mandatoryChart: false,
};
