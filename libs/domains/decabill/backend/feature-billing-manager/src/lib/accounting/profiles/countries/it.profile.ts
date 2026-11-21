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
 * Italy: no statutory chart. Customary piano dei conti whose accounts map 1:1 to the schema CEE of the civil code
 * (art. 2424 stato patrimoniale, art. 2425 conto economico). Numbering and labels by Decabill.
 */

const u = undefined;
/** Custom template codes. */
const OUT_ICL = 'OUT_ICL';
const OUT_SUPER_RED = 'OUT_SUPER_RED';
const ROWS: TemplateRow[] = [
  // B) Immobilizzazioni
  ['0110', 'Software e licenze d’uso', T.ASSET, 'BS.B.I'],
  ['0210', 'Macchine d’ufficio elettroniche e computer', T.ASSET, 'BS.B.II', R.FIXED_ASSETS],
  ['0220', 'Beni strumentali di costo unitario non superiore a 516,46 €', T.ASSET, 'BS.B.II', R.LOW_VALUE_ASSETS],
  ['0230', 'Mobili, arredi e altri beni materiali (nessun pool fiscale)', T.ASSET, 'BS.B.II', R.ASSET_POOL],
  // C) Attivo circolante
  ['1010', 'Merci', T.ASSET, 'BS.C.I', R.INVENTORY],
  ['1110', 'Crediti verso clienti', T.ASSET, 'BS.C.II.1', R.RECEIVABLES],
  ['1210', 'IVA a credito (su acquisti) 22 %', T.ASSET, 'BS.C.II.5bis', R.VAT_INPUT_STANDARD],
  ['1211', 'IVA a credito (su acquisti) aliquote ridotte', T.ASSET, 'BS.C.II.5bis', R.VAT_INPUT_REDUCED],
  ['1212', 'IVA a credito – reverse charge (integrazione)', T.ASSET, 'BS.C.II.5bis', R.VAT_INPUT_REVERSE_CHARGE],
  ['1220', 'Erario c/acconto IVA', T.ASSET, 'BS.C.II.5bis', R.VAT_PREPAYMENTS],
  ['1290', 'Conto transitorio / partite da chiarire', T.ASSET, 'BS.C.II.5quater', R.SUSPENSE],
  ['1310', 'Banca c/c', T.ASSET, 'BS.C.IV.1', R.BANK],
  ['1320', 'Prestatori di servizi di pagamento c/transitorio', T.ASSET, 'BS.C.IV.1', R.PROCESSOR_CLEARING],
  ['1330', 'Giroconti / denaro in transito', T.ASSET, 'BS.C.IV.1', R.CASH_IN_TRANSIT],
  ['1340', 'Cassa', T.ASSET, 'BS.C.IV.3', R.CASH],
  // A) Patrimonio netto
  ['2010', 'Capitale sociale / capitale netto', T.EQUITY, 'BS.P.A.I'],
  ['2020', 'Utili (perdite) portati a nuovo', T.EQUITY, 'BS.P.A.VIII', R.RETAINED_EARNINGS],
  ['2030', 'Utile (perdita) dell’esercizio', T.EQUITY, 'BS.P.A.IX', R.ANNUAL_RESULT],
  ['2040', 'Titolare c/prelevamenti', T.EQUITY, 'BS.P.A.T', R.OWNER_DRAWINGS],
  ['2050', 'Titolare c/apporti', T.EQUITY, 'BS.P.A.T', R.OWNER_CONTRIBUTIONS],
  // D) Debiti
  ['2410', 'Clienti c/anticipi (acconti ricevuti)', T.LIABILITY, 'BS.P.D.6', R.CUSTOMER_PREPAYMENTS],
  ['2510', 'Debiti verso fornitori', T.LIABILITY, 'BS.P.D.7', R.PAYABLES],
  ['2610', 'IVA a debito (su vendite) 22 %', T.LIABILITY, 'BS.P.D.12', R.VAT_OUTPUT_STANDARD],
  ['2611', 'IVA a debito (su vendite) aliquote ridotte', T.LIABILITY, 'BS.P.D.12', R.VAT_OUTPUT_REDUCED],
  ['2612', 'IVA a debito – reverse charge (integrazione)', T.LIABILITY, 'BS.P.D.12', R.VAT_OUTPUT_REVERSE_CHARGE],
  ['2613', 'IVA dovuta in altri Stati membri (OSS)', T.LIABILITY, 'BS.P.D.12', R.VAT_OUTPUT_OSS],
  ['2620', 'Erario c/IVA (liquidazione periodica)', T.LIABILITY, 'BS.P.D.12', R.VAT_SETTLEMENT],
  // A) Valore della produzione
  [
    '3010',
    'Ricavi per prestazioni di servizi – IVA 22 %',
    T.REVENUE,
    'PL.A1',
    R.REVENUE_STANDARD,
    C.OUT_STANDARD,
    'SEMP.R.ricavi',
  ],
  [
    '3011',
    'Ricavi per prestazioni di servizi – IVA 10 %',
    T.REVENUE,
    'PL.A1',
    R.REVENUE_REDUCED,
    C.OUT_REDUCED,
    'SEMP.R.ricavi',
  ],
  ['3012', 'Ricavi per prestazioni di servizi – IVA 5 %', T.REVENUE, 'PL.A1', u, C.OUT_REDUCED_2, 'SEMP.R.ricavi'],
  ['3013', 'Ricavi per prestazioni di servizi – IVA 4 %', T.REVENUE, 'PL.A1', u, OUT_SUPER_RED, 'SEMP.R.ricavi'],
  [
    '3020',
    'Ricavi non imponibili – esportazioni (art. 8 DPR 633/72)',
    T.REVENUE,
    'PL.A1',
    R.REVENUE_TAX_FREE,
    C.OUT_ZERO,
    'SEMP.R.ricavi',
  ],
  [
    '3021',
    'Cessioni intracomunitarie non imponibili (art. 41 DL 331/93)',
    T.REVENUE,
    'PL.A1',
    u,
    OUT_ICL,
    'SEMP.R.ricavi',
  ],
  [
    '3030',
    'Prestazioni di servizi UE non soggette (art. 7-ter, reverse charge)',
    T.REVENUE,
    'PL.A1',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    'SEMP.R.ricavi',
  ],
  ['3031', 'Prestazioni di servizi a privati UE (OSS)', T.REVENUE, 'PL.A1', R.REVENUE_OSS, u, 'SEMP.R.ricavi'],
  [
    '3032',
    'Prestazioni di servizi extra-UE non soggette (art. 7-ter)',
    T.REVENUE,
    'PL.A1',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    'SEMP.R.ricavi',
  ],
  ['3033', 'Altre operazioni fuori campo IVA', T.REVENUE, 'PL.A1', u, C.OUT_NON_TAXABLE, 'SEMP.R.ricavi'],
  ['3090', 'Resi, abbuoni e sconti su vendite', T.REVENUE, 'PL.A1', R.REVENUE_REDUCTIONS, u, 'SEMP.R.ricavi'],
  [
    '3110',
    'Plusvalenze da alienazione di beni strumentali',
    T.REVENUE,
    'PL.A5',
    R.ASSET_DISPOSAL_GAIN,
    u,
    'SEMP.R.altri',
  ],
  // C) Proventi finanziari
  [
    '3210',
    'Sconti finanziari attivi (ottenuti da fornitori)',
    T.REVENUE,
    'PL.C16',
    R.CASH_DISCOUNTS_RECEIVED,
    u,
    'SEMP.R.altri',
  ],
  ['3220', 'Utili su cambi', T.REVENUE, 'PL.C17bis', R.FX_GAIN, u, 'SEMP.R.altri'],
  // B) Costi della produzione
  ['4010', 'Acquisti di merci – IVA 22 %', T.EXPENSE, 'PL.B6', u, C.IN_STANDARD, 'SEMP.C.merci'],
  ['4011', 'Acquisti di merci – aliquote ridotte', T.EXPENSE, 'PL.B6', u, C.IN_REDUCED, 'SEMP.C.merci'],
  ['4020', 'Variazione delle rimanenze di merci', T.EXPENSE, 'PL.B11', R.COST_OF_GOODS_SOLD, u, 'SEMP.C.merci'],
  ['4110', 'Costi per servizi', T.EXPENSE, 'PL.B7', R.EXPENSE_DEFAULT, u, 'SEMP.C.servizi'],
  [
    '4111',
    'Servizi da fornitori UE (reverse charge)',
    T.EXPENSE,
    'PL.B7',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    'SEMP.C.servizi',
  ],
  [
    '4112',
    'Servizi da fornitori extra-UE (reverse charge)',
    T.EXPENSE,
    'PL.B7',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    'SEMP.C.servizi',
  ],
  ['4120', 'Spese telefoniche e internet', T.EXPENSE, 'PL.B7', u, u, 'SEMP.C.servizi'],
  ['4130', 'Commissioni e spese bancarie', T.EXPENSE, 'PL.B7', R.PAYMENT_FEES, u, 'SEMP.C.servizi'],
  ['4210', 'Ammortamento immobilizzazioni materiali', T.EXPENSE, 'PL.B10b', R.DEPRECIATION, u, 'SEMP.C.amm'],
  ['4310', 'Perdite su crediti', T.EXPENSE, 'PL.B14', R.BAD_DEBT, u, 'SEMP.C.altri'],
  [
    '4320',
    'Minusvalenze da alienazione di beni strumentali',
    T.EXPENSE,
    'PL.B14',
    R.ASSET_DISPOSAL_LOSS,
    u,
    'SEMP.C.altri',
  ],
  ['4330', 'Arrotondamenti passivi', T.EXPENSE, 'PL.B14', R.ROUNDING, u, 'SEMP.C.altri'],
  // C) Oneri finanziari
  [
    '4410',
    'Sconti finanziari passivi (concessi a clienti)',
    T.EXPENSE,
    'PL.C17',
    R.CASH_DISCOUNTS_GRANTED,
    u,
    'SEMP.C.altri',
  ],
  ['4420', 'Perdite su cambi', T.EXPENSE, 'PL.C17bis', R.FX_LOSS, u, 'SEMP.C.altri'],
  // Conti tecnici
  ['9010', 'Bilancio di apertura', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9011', 'Bilancio di apertura – clienti', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9012', 'Bilancio di apertura – fornitori', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/** Liquidazione periodica IVA (LIPE), quadro VP. */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'IVA 22 %',
    kind: K.OUTPUT,
    rate: 22,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: 'VP2',
    taxBox: 'VP4',
  },
  {
    code: C.OUT_REDUCED,
    name: 'IVA 10 %',
    kind: K.OUTPUT,
    rate: 10,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: 'VP2',
    taxBox: 'VP4',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'IVA 5 %',
    kind: K.OUTPUT,
    rate: 5,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: 'VP2',
    taxBox: 'VP4',
  },
  {
    code: OUT_SUPER_RED,
    name: 'IVA 4 %',
    kind: K.OUTPUT,
    rate: 4,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: 'VP2',
    taxBox: 'VP4',
  },
  { code: C.OUT_ZERO, name: 'Non imponibile – esportazioni (art. 8)', kind: K.EXEMPT, rate: 0, baseBox: 'VP2' },
  {
    code: OUT_ICL,
    name: 'Non imponibile – cessioni intracomunitarie (art. 41)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'VP2',
    ecSalesList: true,
  },
  // VP2 includes operations not subject to IVA for lack of territoriality (artt. 7–7-septies) when an invoice is
  // mandatory (art. 21 c. 6-bis), i.e. B2B services to EU and non-EU customers.
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Non soggetta – servizi UE (art. 7-ter), inversione contabile',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'VP2',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS: IVA dovuta in altro Stato membro',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    oss: true,
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Non soggetta – servizi extra-UE (art. 7-ter)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'VP2',
  },
  { code: C.OUT_NON_TAXABLE, name: 'Fuori campo IVA', kind: K.EXEMPT, rate: 0 },
  {
    code: C.IN_STANDARD,
    name: 'IVA detraibile 22 %',
    kind: K.INPUT,
    rate: 22,
    accountRole: R.VAT_INPUT_STANDARD,
    baseBox: 'VP3',
    taxBox: 'VP5',
  },
  {
    code: C.IN_REDUCED,
    name: 'IVA detraibile 10 %',
    kind: K.INPUT,
    rate: 10,
    accountRole: R.VAT_INPUT_REDUCED,
    baseBox: 'VP3',
    taxBox: 'VP5',
  },
  { code: C.IN_NONE, name: 'Acquisti senza IVA detraibile', kind: K.EXEMPT, rate: 0, baseBox: 'VP3' },
  {
    code: C.RC_EU_SERVICES,
    name: 'Reverse charge – servizi da fornitori UE (art. 17 c. 2) 22 %',
    kind: K.REVERSE_CHARGE,
    rate: 22,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: 'VP3',
    taxBox: 'VP4',
    reverseTaxBox: 'VP5',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Reverse charge – servizi da fornitori extra-UE (art. 17 c. 2) 22 %',
    kind: K.REVERSE_CHARGE,
    rate: 22,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: 'VP3',
    taxBox: 'VP4',
    reverseTaxBox: 'VP5',
  },
];

export const IT_CEE_TEMPLATE: ChartTemplate = {
  key: 'IT-CEE',
  country: 'IT',
  name: 'Piano dei conti (schema CEE, artt. 2424–2425 c.c.)',
  description:
    'Piano dei conti usuale con conti raccordati alle voci dello schema CEE di stato patrimoniale e conto economico.',
  accountLength: 4,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Decabill chart (no statutory chart in Italy) mapped to the CEE schema of artt. 2424/2425 c.c. (post D.Lgs. ' +
    '139/2015: no extraordinary section; cash discounts as financial items per OIC). LIPE quadro VP boxes per the ' +
    'Agenzia delle Entrate model (VP7 threshold 100 euro); art. 7-ter services (invoice mandatory, art. 21 c. ' +
    '6-bis) are included in VP2 per the LIPE instructions; unverified: OSS B2C sales (art. 7-octies, declared via ' +
    'OSS) in VP2 — left unmapped. The annual Dichiarazione IVA (quadri VE/VF/VL) has its own numbering; the annual ' +
    'summary shows VP ids. The esterometro was abolished from 1 July 2022: cross-border operations are reported via ' +
    'SdI (TD17/TD18/TD19 integration documents, outgoing invoices to foreign customers) — not implemented.',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'IT-CEE-2424',
  name: 'Stato patrimoniale (art. 2424 c.c.)',
  kind: 'balance_sheet',
  assets: [
    { code: 'BS.A', label: 'A) Crediti verso soci per versamenti ancora dovuti' },
    {
      code: 'BS.B',
      label: 'B) Immobilizzazioni',
      children: [
        { code: 'BS.B.I', label: 'I. Immobilizzazioni immateriali' },
        { code: 'BS.B.II', label: 'II. Immobilizzazioni materiali' },
        { code: 'BS.B.III', label: 'III. Immobilizzazioni finanziarie' },
      ],
    },
    {
      code: 'BS.C',
      label: 'C) Attivo circolante',
      children: [
        { code: 'BS.C.I', label: 'I. Rimanenze' },
        {
          code: 'BS.C.II',
          label: 'II. Crediti',
          children: [
            { code: 'BS.C.II.1', label: '1) verso clienti' },
            { code: 'BS.C.II.5bis', label: '5-bis) crediti tributari' },
            { code: 'BS.C.II.5quater', label: '5-quater) verso altri' },
          ],
        },
        { code: 'BS.C.III', label: 'III. Attività finanziarie che non costituiscono immobilizzazioni' },
        {
          code: 'BS.C.IV',
          label: 'IV. Disponibilità liquide',
          children: [
            { code: 'BS.C.IV.1', label: '1) depositi bancari e postali' },
            { code: 'BS.C.IV.3', label: '3) danaro e valori in cassa' },
          ],
        },
      ],
    },
    { code: 'BS.D', label: 'D) Ratei e risconti' },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.P.A',
      label: 'A) Patrimonio netto',
      children: [
        { code: 'BS.P.A.I', label: 'I. Capitale' },
        { code: 'BS.P.A.VIII', label: 'VIII. Utili (perdite) portati a nuovo' },
        { code: 'BS.P.A.IX', label: 'IX. Utile (perdita) dell’esercizio' },
        { code: 'BS.P.A.T', label: 'Conto del titolare (ditte individuali)' },
      ],
    },
    { code: 'BS.P.B', label: 'B) Fondi per rischi e oneri' },
    { code: 'BS.P.C', label: 'C) Trattamento di fine rapporto di lavoro subordinato' },
    {
      code: 'BS.P.D',
      label: 'D) Debiti',
      children: [
        { code: 'BS.P.D.6', label: '6) acconti' },
        { code: 'BS.P.D.7', label: '7) debiti verso fornitori' },
        { code: 'BS.P.D.12', label: '12) debiti tributari' },
        { code: 'BS.P.D.14', label: '14) altri debiti' },
      ],
    },
    { code: 'BS.P.E', label: 'E) Ratei e risconti' },
  ],
  resultPosition: 'BS.P.A.IX',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'IT-CEE-2425',
  name: 'Conto economico (art. 2425 c.c.)',
  kind: 'profit_and_loss',
  lines: [
    {
      code: 'PL.A',
      label: 'A) Valore della produzione',
      sign: 1,
      children: [
        { code: 'PL.A1', label: '1) ricavi delle vendite e delle prestazioni', sign: 1 },
        { code: 'PL.A5', label: '5) altri ricavi e proventi', sign: 1 },
      ],
    },
    {
      code: 'PL.B',
      label: 'B) Costi della produzione',
      sign: -1,
      children: [
        { code: 'PL.B6', label: '6) per materie prime, sussidiarie, di consumo e di merci', sign: -1 },
        { code: 'PL.B7', label: '7) per servizi', sign: -1 },
        { code: 'PL.B8', label: '8) per godimento di beni di terzi', sign: -1 },
        { code: 'PL.B9', label: '9) per il personale', sign: -1 },
        { code: 'PL.B10b', label: '10 b) ammortamento delle immobilizzazioni materiali', sign: -1 },
        { code: 'PL.B10d', label: '10 d) svalutazione dei crediti dell’attivo circolante', sign: -1 },
        {
          code: 'PL.B11',
          label: '11) variazioni delle rimanenze di materie prime, sussidiarie, di consumo e merci',
          sign: -1,
        },
        { code: 'PL.B14', label: '14) oneri diversi di gestione', sign: -1 },
      ],
    },
    {
      code: 'PL.C',
      label: 'C) Proventi e oneri finanziari',
      sign: 1,
      children: [
        { code: 'PL.C16', label: '16) altri proventi finanziari', sign: 1 },
        { code: 'PL.C17', label: '17) interessi e altri oneri finanziari', sign: -1 },
        { code: 'PL.C17bis', label: '17-bis) utili e perdite su cambi', sign: 1 },
      ],
    },
    { code: 'PL.20', label: '20) Imposte sul reddito dell’esercizio', sign: -1 },
  ],
};
const CASH_BASIS: StatementLayout = {
  key: 'IT-SEMPLIFICATA',
  name: 'Contabilità semplificata (regime di cassa, art. 66 TUIR)',
  kind: 'cash_basis',
  lines: [
    {
      code: 'SEMP.R',
      label: 'Componenti positivi',
      sign: 1,
      children: [
        { code: 'SEMP.R.ricavi', label: 'Ricavi incassati', sign: 1 },
        { code: 'SEMP.R.altri', label: 'Altri proventi', sign: 1 },
      ],
    },
    {
      code: 'SEMP.C',
      label: 'Componenti negativi',
      sign: -1,
      children: [
        { code: 'SEMP.C.merci', label: 'Acquisti di merci', sign: -1 },
        { code: 'SEMP.C.servizi', label: 'Costi per servizi', sign: -1 },
        { code: 'SEMP.C.amm', label: 'Quote di ammortamento', sign: -1 },
        { code: 'SEMP.C.altri', label: 'Altri componenti negativi', sign: -1 },
      ],
    },
  ],
};
const LIPE: VatReturnDefinition = {
  key: 'IT-LIPE',
  name: 'Comunicazione liquidazioni periodiche IVA (LIPE) – quadro VP',
  kind: 'periodic',
  periods: ['quarter'],
  boxes: [
    { box: 'VP2', label: 'Totale operazioni attive (al netto dell’IVA)', kind: 'base' },
    { box: 'VP3', label: 'Totale operazioni passive (al netto dell’IVA)', kind: 'base' },
    { box: 'VP4', label: 'IVA esigibile', kind: 'tax' },
    { box: 'VP5', label: 'IVA detratta', kind: 'tax' },
    { box: 'VP6', label: 'IVA dovuta (+) / a credito (−)', kind: 'computed', formula: 'VP4 - VP5' },
    { box: 'VP7', label: 'Debito periodo precedente non superiore a 100 euro', kind: 'manual' },
    { box: 'VP8', label: 'Credito periodo precedente', kind: 'manual' },
    { box: 'VP9', label: 'Credito anno precedente', kind: 'manual' },
    { box: 'VP10', label: 'Versamenti auto UE', kind: 'manual' },
    { box: 'VP11', label: 'Crediti d’imposta', kind: 'manual' },
    { box: 'VP12', label: 'Interessi dovuti per liquidazioni trimestrali', kind: 'manual' },
    { box: 'VP13', label: 'Acconto dovuto', kind: 'manual' },
    {
      box: 'VP14',
      label: 'IVA da versare (+) / a credito (−)',
      kind: 'computed',
      formula: 'VP4 - VP5 + VP7 - VP8 - VP9 - VP10 - VP11 + VP12 - VP13',
    },
  ],
  resultBox: 'VP14',
  filingChannel: 'Agenzia delle Entrate – servizi telematici (Fisconline / Entratel, directly or via an intermediary)',
  filingUrl: 'https://www.agenziaentrate.gov.it',
  dueRule:
    'End of the second month after the quarter (Q2: 30 September; Q4: end of February or with the annual return ' +
    'filed by then); payment of the liquidazione via F24 by the 16th (monthly) / 16th of the second month (quarterly)',
};
const ANNUAL: VatReturnDefinition = {
  ...LIPE,
  key: 'IT-IVA-ANNUAL',
  name: 'Dichiarazione IVA annuale (riepilogo con identificativi VP)',
  kind: 'annual',
  periods: ['year'],
  dueRule: 'Between 1 February and 30 April of the following year',
};
const INTRASTAT: VatReturnDefinition = {
  key: 'IT-INTRASTAT',
  name: 'Elenchi riepilogativi INTRASTAT (cessioni di beni / servizi resi)',
  kind: 'ec_sales_list',
  periods: ['month', 'quarter'],
  boxes: [],
  filingChannel: 'Agenzia delle Dogane e dei Monopoli (servizio telematico doganale)',
  filingUrl: 'https://www.adm.gov.it',
  dueRule: '25th day of the month after the period',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'Dichiarazione OSS (regime UE)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'Agenzia delle Entrate – portale OSS',
  filingUrl: 'https://www.agenziaentrate.gov.it',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const IT_PROFILE: AccountingCountryProfile = {
  country: 'IT',
  name: 'Italia',
  defaultTemplate: 'IT-CEE',
  templates: ['IT-CEE'],
  vatReturns: [LIPE, INTRASTAT, OSS, ANNUAL],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  cashBasis: CASH_BASIS,
  exports: ['saft', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [
    {
      env: 'BILLING_ISSUER_TAX_NUMBER',
      label: 'Partita IVA / codice fiscale',
      requiredFor: ['IT-LIPE', 'IT-IVA-ANNUAL'],
    },
  ],
  // 10 years (art. 2220 c.c.); tax assessment terms are shorter (art. 57 DPR 633/1972) but do not shorten it.
  retention: { booksYears: 10, vouchersYears: 10 },
  defaultEinvoiceFormat: 'ubl-en16931',
  complianceNotice:
    'In Italia tutte le fatture (B2B, B2C e transfrontaliere) devono essere trasmesse tramite il Sistema di ' +
    'Interscambio (SdI) in formato FatturaPA. Decabill non implementa SdI/FatturaPA: le fatture emesse da Decabill ' +
    'non sono fatture elettroniche validamente emesse in Italia e vanno ritrasmesse tramite un intermediario SdI.',
  mandatoryChart: false,
};
