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
 * Luxembourg: curated subset of the Plan comptable normalisé (PCN 2020, règlement grand-ducal du 12 septembre 2019,
 * financial years from 1 January 2020). Account numbers keep the PCN's variable length; where the PCN's lowest
 * (imputable) level is split further by VAT rate, Decabill adds one digit below the PCN account. Labels in French.
 */

const u = undefined;
/** Custom template codes. */
const OUT_ICL = 'OUT_ICL';
const OUT_INTERMEDIATE = 'OUT_INT';
const ROWS: TemplateRow[] = [
  // Classe 2 – Actifs immobilisés
  ['21213', 'Licences informatiques (acquises à titre onéreux)', T.ASSET, 'BS.C.I'],
  ['2235', 'Matériel informatique', T.ASSET, 'BS.C.II', R.FIXED_ASSETS],
  ['22351', 'Matériel informatique de faible valeur', T.ASSET, 'BS.C.II', R.LOW_VALUE_ASSETS],
  ['2238', 'Autres installations (pas de pool fiscal)', T.ASSET, 'BS.C.II', R.ASSET_POOL],
  // Classe 3 – Stocks
  ['361', 'Stocks de marchandises', T.ASSET, 'BS.D.I', R.INVENTORY],
  // Classe 4 – Créances et dettes
  ['4011', 'Clients', T.ASSET, 'BS.D.II.1', R.RECEIVABLES],
  ['4216111', 'TVA en amont – taux normal (sous-compte de 421611)', T.ASSET, 'BS.D.II.4', R.VAT_INPUT_STANDARD],
  ['4216112', 'TVA en amont – taux réduits (sous-compte de 421611)', T.ASSET, 'BS.D.II.4', R.VAT_INPUT_REDUCED],
  [
    '4216113',
    'TVA en amont – autoliquidation (sous-compte de 421611)',
    T.ASSET,
    'BS.D.II.4',
    R.VAT_INPUT_REVERSE_CHARGE,
  ],
  ['421613', 'TVA acomptes versés', T.ASSET, 'BS.D.II.4', R.VAT_PREPAYMENTS],
  ['484', 'Comptes transitoires ou d’attente – Actif', T.ASSET, 'BS.E', R.SUSPENSE],
  ['4311', 'Acomptes reçus sur commandes', T.LIABILITY, 'BS.P.C.3', R.CUSTOMER_PREPAYMENTS],
  ['44111', 'Fournisseurs', T.LIABILITY, 'BS.P.C.4', R.PAYABLES],
  ['4614111', 'TVA en aval – taux normal (sous-compte de 461411)', T.LIABILITY, 'BS.P.C.8a', R.VAT_OUTPUT_STANDARD],
  ['4614112', 'TVA en aval – taux réduits (sous-compte de 461411)', T.LIABILITY, 'BS.P.C.8a', R.VAT_OUTPUT_REDUCED],
  [
    '4614113',
    'TVA en aval – autoliquidation, services reçus (sous-compte de 461411)',
    T.LIABILITY,
    'BS.P.C.8a',
    R.VAT_OUTPUT_REVERSE_CHARGE,
  ],
  [
    '461418',
    'TVA – Autres dettes (TVA due à d’autres États membres, guichet unique OSS)',
    T.LIABILITY,
    'BS.P.C.8a',
    R.VAT_OUTPUT_OSS,
  ],
  ['461412', 'TVA à payer', T.LIABILITY, 'BS.P.C.8a', R.VAT_SETTLEMENT],
  // Classe 5 – Comptes financiers
  ['5131', 'Banques et CCP : avoirs', T.ASSET, 'BS.D.IV', R.BANK],
  ['518', 'Autres avoirs (prestataires de paiement)', T.ASSET, 'BS.D.IV', R.PROCESSOR_CLEARING],
  ['516', 'Caisse', T.ASSET, 'BS.D.IV', R.CASH],
  ['5171', 'Virements internes : solde débiteur', T.ASSET, 'BS.D.IV', R.CASH_IN_TRANSIT],
  // Classe 1 – Capitaux propres
  ['101', 'Capital souscrit', T.EQUITY, 'BS.P.A.I'],
  ['10611', 'Prélèvements privés en numéraire de l’exploitant', T.EQUITY, 'BS.P.A.EXP', R.OWNER_DRAWINGS],
  [
    '10622',
    'Suppléments d’apports privés de l’exploitant – avoirs privés',
    T.EQUITY,
    'BS.P.A.EXP',
    R.OWNER_CONTRIBUTIONS,
  ],
  ['1411', 'Résultats reportés en instance d’affectation', T.EQUITY, 'BS.P.A.V', R.RETAINED_EARNINGS],
  ['142', 'Résultat de l’exercice', T.EQUITY, 'BS.P.A.VI', R.ANNUAL_RESULT],
  // Classe 7 – Produits (7033 Prestations de services non visées ci-dessus, 7061 Ventes de marchandises)
  ['70331', 'Prestations de services – TVA 17 %', T.REVENUE, 'PL.1', R.REVENUE_STANDARD, C.OUT_STANDARD],
  ['70332', 'Prestations de services – TVA 8 %', T.REVENUE, 'PL.1', R.REVENUE_REDUCED, C.OUT_REDUCED],
  ['70333', 'Prestations de services – TVA 3 %', T.REVENUE, 'PL.1', u, C.OUT_REDUCED_2],
  ['70334', 'Prestations de services – TVA 14 %', T.REVENUE, 'PL.1', u, OUT_INTERMEDIATE],
  [
    '70335',
    'Prestations de services intracommunautaires (autoliquidation par le preneur)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
  ],
  ['70336', 'Prestations de services à des non-assujettis UE (guichet unique OSS)', T.REVENUE, 'PL.1', R.REVENUE_OSS],
  ['70337', 'Prestations de services hors UE', T.REVENUE, 'PL.1', R.REVENUE_THIRD_COUNTRY, C.OUT_EXPORT_SERVICES],
  ['70338', 'Opérations non imposables au Luxembourg (autres)', T.REVENUE, 'PL.1', u, C.OUT_NON_TAXABLE],
  ['70611', 'Ventes de marchandises – exportations', T.REVENUE, 'PL.1', R.REVENUE_TAX_FREE, C.OUT_ZERO],
  ['70612', 'Ventes de marchandises – livraisons intracommunautaires', T.REVENUE, 'PL.1', u, OUT_ICL],
  ['7093', 'RRR sur prestations de services', T.REVENUE, 'PL.1', R.REVENUE_REDUCTIONS],
  ['7442', 'Plus-values de cession d’immobilisations corporelles', T.REVENUE, 'PL.4', R.ASSET_DISPOSAL_GAIN],
  ['75562', 'Escomptes obtenus – autres', T.REVENUE, 'PL.11', R.CASH_DISCOUNTS_RECEIVED],
  ['7562', 'Gains de change – autres', T.REVENUE, 'PL.11', R.FX_GAIN],
  // Classe 6 – Charges
  ['60611', 'Achats de marchandises – TVA 17 % (sous-compte de 6061)', T.EXPENSE, 'PL.5a', u, C.IN_STANDARD],
  ['60612', 'Achats de marchandises – TVA taux réduits (sous-compte de 6061)', T.EXPENSE, 'PL.5a', u, C.IN_REDUCED],
  ['60761', 'Variation des stocks de marchandises', T.EXPENSE, 'PL.5a', R.COST_OF_GOODS_SOLD],
  ['6138', 'Autres rémunérations d’intermédiaires et honoraires', T.EXPENSE, 'PL.5b', R.EXPENSE_DEFAULT],
  [
    '61381',
    'Prestations de tiers UE (autoliquidation)',
    T.EXPENSE,
    'PL.5b',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
  ],
  [
    '61382',
    'Prestations de tiers hors UE (autoliquidation)',
    T.EXPENSE,
    'PL.5b',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
  ],
  ['61532', 'Frais de télécommunication', T.EXPENSE, 'PL.5b'],
  ['61334', 'Frais sur moyens de paiement électroniques', T.EXPENSE, 'PL.5b', R.PAYMENT_FEES],
  [
    '6333',
    'DCV sur autres installations, outillage et mobilier (y compris matériel roulant)',
    T.EXPENSE,
    'PL.7a',
    R.DEPRECIATION,
  ],
  ['6442', 'Moins-values de cession d’immobilisations corporelles', T.EXPENSE, 'PL.8', R.ASSET_DISPOSAL_LOSS],
  ['6451', 'Pertes sur créances irrécouvrables – ventes et prestations de services', T.EXPENSE, 'PL.8', R.BAD_DEBT],
  ['6488', 'Charges d’exploitation diverses (écarts d’arrondi)', T.EXPENSE, 'PL.8', R.ROUNDING],
  ['65562', 'Escomptes accordés – autres', T.EXPENSE, 'PL.14', R.CASH_DISCOUNTS_GRANTED],
  ['6562', 'Pertes de change – autres', T.EXPENSE, 'PL.14', R.FX_LOSS],
  // Comptes techniques (hors PCN)
  ['9990', 'Bilan d’ouverture (compte technique)', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9991', 'Bilan d’ouverture – clients', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9992', 'Bilan d’ouverture – fournisseurs', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/**
 * eCDF monthly/quarterly return (TVA_DECM / TVA_DECT): line numbers and sums per the AED form and validation rules
 * (2025/2026 editions). Rate columns: 17 % 701/702, 14 % 703/704, 8 % 705/706, 3 % 031/040.
 */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'TVA 17 %',
    kind: K.OUTPUT,
    rate: 17,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '701',
    taxBox: '702',
  },
  {
    code: OUT_INTERMEDIATE,
    name: 'TVA 14 %',
    kind: K.OUTPUT,
    rate: 14,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '703',
    taxBox: '704',
  },
  {
    code: C.OUT_REDUCED,
    name: 'TVA 8 %',
    kind: K.OUTPUT,
    rate: 8,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '705',
    taxBox: '706',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'TVA 3 %',
    kind: K.OUTPUT,
    rate: 3,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '031',
    taxBox: '040',
  },
  {
    code: C.OUT_ZERO,
    name: 'Livraisons à l’exportation exonérées (art. 43/1/a et b)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '014',
  },
  {
    code: OUT_ICL,
    name: 'Livraisons intracommunautaires exonérées (art. 43/1/d, e et f)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '457',
    ecSalesList: true,
  },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Prestations de services à des identifiés TVA UE, preneur redevable (art. 17/1/b)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '423',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS : TVA due dans un autre État membre',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    baseBox: '226',
    oss: true,
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Prestations de services hors UE (lieu à l’étranger)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '019',
  },
  {
    code: C.OUT_NON_TAXABLE,
    name: 'Autres opérations réalisées (imposables) à l’étranger',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '019',
  },
  {
    code: C.IN_STANDARD,
    name: 'TVA en amont 17 %',
    kind: K.INPUT,
    rate: 17,
    accountRole: R.VAT_INPUT_STANDARD,
    taxBox: '458',
  },
  {
    code: C.IN_REDUCED,
    name: 'TVA en amont 8 %',
    kind: K.INPUT,
    rate: 8,
    accountRole: R.VAT_INPUT_REDUCED,
    taxBox: '458',
  },
  { code: C.IN_NONE, name: 'Sans TVA en amont', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: 'Autoliquidation – services reçus d’assujettis UE 17 %',
    kind: K.REVERSE_CHARGE,
    rate: 17,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '741',
    taxBox: '742',
    reverseTaxBox: '461',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Autoliquidation – services reçus de prestataires hors UE 17 %',
    kind: K.REVERSE_CHARGE,
    rate: 17,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '751',
    taxBox: '752',
    reverseTaxBox: '461',
  },
];

export const LU_PCN_TEMPLATE: ChartTemplate = {
  key: 'LU-PCN',
  country: 'LU',
  name: 'Plan comptable normalisé (PCN 2020)',
  description: 'Plan comptable normalisé luxembourgeois – classes 1 à 7 (obligatoire, dépôt eCDF et FAIA).',
  accountLength: 6,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Curated subset of the Luxembourg PCN 2020 (règlement grand-ducal du 12 septembre 2019). Account numbers and ' +
    'their balance sheet / P&L mapping checked against a published PCN 2020 listing (EY Luxembourg, 2025 edition); ' +
    '7-digit VAT accounts (4216111–4216113, 4614111–4614113) and 5-digit revenue / purchase splits (70331–70338, ' +
    '70611/70612, 60611/60612, 61381/61382, 22351) are Decabill sub-accounts below the PCN level; 999x technical ' +
    'opening accounts are outside the PCN. Sole traders and SENC/SCS below EUR 100,000 turnover are exempt from the ' +
    'PCN. eCDF VAT return line numbers and sums per the AED TVA_DECM form and validation rules (2025/2026). ' +
    'Statements per the loi modifiée du 19 décembre 2002 (bilan art. 34, compte de profits et pertes art. 46).',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'LU-LRCS-BILAN',
  name: 'Bilan (schéma complet, art. 34 loi modifiée du 19 décembre 2002)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.C',
      label: 'C. Actif immobilisé',
      children: [
        { code: 'BS.C.I', label: 'I. Immobilisations incorporelles' },
        { code: 'BS.C.II', label: 'II. Immobilisations corporelles' },
        { code: 'BS.C.III', label: 'III. Immobilisations financières' },
      ],
    },
    {
      code: 'BS.D',
      label: 'D. Actif circulant',
      children: [
        { code: 'BS.D.I', label: 'I. Stocks' },
        {
          code: 'BS.D.II',
          label: 'II. Créances',
          children: [
            { code: 'BS.D.II.1', label: '1. Créances résultant de ventes et prestations de services' },
            { code: 'BS.D.II.4', label: '4. Autres créances' },
          ],
        },
        { code: 'BS.D.III', label: 'III. Valeurs mobilières' },
        { code: 'BS.D.IV', label: 'IV. Avoirs en banques, avoirs en compte de chèques postaux, chèques et en caisse' },
      ],
    },
    { code: 'BS.E', label: 'E. Comptes de régularisation' },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.P.A',
      label: 'A. Capitaux propres',
      children: [
        { code: 'BS.P.A.I', label: 'I. Capital souscrit' },
        { code: 'BS.P.A.IV', label: 'IV. Réserves' },
        { code: 'BS.P.A.V', label: 'V. Résultats reportés' },
        { code: 'BS.P.A.VI', label: 'VI. Résultat de l’exercice' },
        { code: 'BS.P.A.EXP', label: 'Comptes de l’exploitant (PCN 106, présentés sous A.I)' },
      ],
    },
    { code: 'BS.P.B', label: 'B. Provisions' },
    {
      code: 'BS.P.C',
      label: 'C. Dettes',
      children: [
        { code: 'BS.P.C.3', label: '3. Acomptes reçus sur commandes' },
        { code: 'BS.P.C.4', label: '4. Dettes sur achats et prestations de services' },
        { code: 'BS.P.C.8a', label: '8. a) Dettes fiscales' },
        { code: 'BS.P.C.8c', label: '8. c) Autres dettes' },
      ],
    },
    { code: 'BS.P.D', label: 'D. Comptes de régularisation' },
  ],
  resultPosition: 'BS.P.A.VI',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'LU-LRCS-CR',
  name: 'Compte de profits et pertes (présentation par nature, art. 46)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.1', label: '1. Chiffre d’affaires net', sign: 1 },
    { code: 'PL.2', label: '2. Variation du stock de produits finis et en cours de fabrication', sign: 1 },
    { code: 'PL.4', label: '4. Autres produits d’exploitation', sign: 1 },
    {
      code: 'PL.5',
      label: '5. Matières premières et consommables et autres charges externes',
      sign: -1,
      children: [
        { code: 'PL.5a', label: 'a) Matières premières et consommables', sign: -1 },
        { code: 'PL.5b', label: 'b) Autres charges externes', sign: -1 },
      ],
    },
    { code: 'PL.6', label: '6. Frais de personnel', sign: -1 },
    {
      code: 'PL.7a',
      label:
        '7. a) Corrections de valeur sur frais d’établissement et sur immobilisations corporelles et incorporelles',
      sign: -1,
    },
    { code: 'PL.8', label: '8. Autres charges d’exploitation', sign: -1 },
    { code: 'PL.11', label: '11. Autres intérêts et autres produits financiers', sign: 1 },
    { code: 'PL.14', label: '14. Intérêts et autres charges financières', sign: -1 },
    { code: 'PL.15', label: '15. Impôts sur le résultat', sign: -1 },
    { code: 'PL.17', label: '17. Autres impôts ne figurant pas sous les postes 1 à 16', sign: -1 },
  ],
};
const RATE_BASES = '701 + 901 + 703 + 903 + 705 + 905 + 031 + 033';
const EXEMPTIONS = '457 + 014 + 015 + 016 + 017 + 481 + 482 + 226 + 018 + 423 + 424 + 019 + 419';
/** Computed boxes are evaluated in array order: every computed box only references boxes listed before it. */
const PERIODIC: VatReturnDefinition = {
  key: 'LU-TVA',
  name: 'Déclaration de TVA mensuelle / trimestrielle (eCDF)',
  kind: 'periodic',
  periods: ['month', 'quarter'],
  boxes: [
    // I. Calcul du chiffre d'affaires imposable
    { box: '455', label: 'Prélèvements privés de biens et affectation de biens (art. 13)', kind: 'manual' },
    { box: '456', label: 'Utilisation privée de biens et prélèvements privés de services (art. 16)', kind: 'manual' },
    {
      box: '457',
      label:
        'Livraisons intracommunautaires de biens à des identifiés TVA dans un autre État membre (art. 43/1/d, e et f)',
      kind: 'base',
    },
    { box: '014', label: 'Livraisons à l’exportation (art. 43/1/a et b)', kind: 'base' },
    { box: '015', label: 'Autres exonérations (art. 43 et 60bis)', kind: 'manual' },
    { box: '016', label: 'Autres exonérations (art. 44 et 56quater)', kind: 'manual' },
    { box: '017', label: 'Tabacs fabriqués dont la TVA a été perçue à la source', kind: 'manual' },
    { box: '481', label: 'Opérations sous le régime de franchise national (art. 57bis)', kind: 'manual' },
    { box: '482', label: 'Opérations sous le régime de franchise transfrontalier (art. 57quater)', kind: 'manual' },
    {
      box: '226',
      label: 'Opérations relevant des régimes particuliers OSS / IOSS (art. 56quinquies à 56septies)',
      kind: 'base',
    },
    { box: '018', label: 'Livraisons subséquentes dans le cadre d’opérations triangulaires', kind: 'manual' },
    {
      box: '423',
      label:
        'Prestations de services à des identifiés TVA UE, non exonérées dans l’État membre du preneur (art. 17/1/b)',
      kind: 'base',
    },
    {
      box: '424',
      label: 'Prestations de services à des identifiés TVA UE, exonérées dans l’État membre du preneur',
      kind: 'manual',
    },
    { box: '019', label: 'Autres opérations réalisées (imposables) à l’étranger', kind: 'base' },
    {
      box: '419',
      label: 'Opérations à l’intérieur du pays pour lesquelles le preneur est le redevable',
      kind: 'manual',
    },
    // II.A Ventilation du chiffre d'affaires imposable
    { box: '701', label: 'Base imposable 17 %', kind: 'base' },
    { box: '702', label: 'TVA 17 %', kind: 'tax' },
    { box: '901', label: 'Base imposable 16 % (taux temporaire 2023)', kind: 'manual' },
    { box: '902', label: 'TVA 16 % (taux temporaire 2023)', kind: 'manual' },
    { box: '703', label: 'Base imposable 14 %', kind: 'base' },
    { box: '704', label: 'TVA 14 %', kind: 'tax' },
    { box: '903', label: 'Base imposable 13 % (taux temporaire 2023)', kind: 'manual' },
    { box: '904', label: 'TVA 13 % (taux temporaire 2023)', kind: 'manual' },
    { box: '705', label: 'Base imposable 8 %', kind: 'base' },
    { box: '706', label: 'TVA 8 %', kind: 'tax' },
    { box: '905', label: 'Base imposable 7 % (taux temporaire 2023)', kind: 'manual' },
    { box: '906', label: 'TVA 7 % (taux temporaire 2023)', kind: 'manual' },
    { box: '031', label: 'Base imposable 3 %', kind: 'base' },
    { box: '040', label: 'TVA 3 %', kind: 'tax' },
    { box: '033', label: 'Base imposable à un autre taux (taux en 403)', kind: 'manual' },
    { box: '042', label: 'TVA à un autre taux', kind: 'manual' },
    {
      box: '454',
      label: 'Total des ventes / recettes',
      kind: 'computed',
      formula: `${RATE_BASES} + ${EXEMPTIONS} - 455 - 456`,
    },
    { box: '012', label: 'A. Chiffre d’affaires global', kind: 'computed', formula: '454 + 455 + 456' },
    { box: '021', label: 'B. Exonérations et montants déductibles', kind: 'computed', formula: EXEMPTIONS },
    { box: '022', label: 'C. Chiffre d’affaires imposable (012 − 021)', kind: 'computed', formula: '012 - 021' },
    { box: '037', label: 'Ventilation du chiffre d’affaires imposable – base', kind: 'computed', formula: RATE_BASES },
    {
      box: '046',
      label: 'Ventilation du chiffre d’affaires imposable – taxe',
      kind: 'computed',
      formula: '702 + 902 + 704 + 904 + 706 + 906 + 040 + 042',
    },
    // II.B–D Acquisitions intracommunautaires et importations (totaux saisis manuellement)
    { box: '051', label: 'Acquisitions intracommunautaires de biens – base (total)', kind: 'manual' },
    { box: '056', label: 'Acquisitions intracommunautaires de biens – taxe (total)', kind: 'manual' },
    { box: '152', label: 'Acquisitions dans le cadre d’opérations triangulaires', kind: 'manual' },
    { box: '065', label: 'Importations de biens – base (total)', kind: 'manual' },
    { box: '407', label: 'Importations de biens – taxe (total)', kind: 'manual' },
    // II.E Prestations de services à déclarer par le preneur redevable
    { box: '741', label: 'Services reçus d’assujettis UE, non exonérés – base 17 %', kind: 'base' },
    { box: '742', label: 'Services reçus d’assujettis UE, non exonérés – taxe 17 %', kind: 'tax' },
    { box: '743', label: 'Services reçus d’assujettis UE – base 14 %', kind: 'manual' },
    { box: '744', label: 'Services reçus d’assujettis UE – taxe 14 %', kind: 'manual' },
    { box: '745', label: 'Services reçus d’assujettis UE – base 8 %', kind: 'manual' },
    { box: '746', label: 'Services reçus d’assujettis UE – taxe 8 %', kind: 'manual' },
    { box: '431', label: 'Services reçus d’assujettis UE – base 3 %', kind: 'manual' },
    { box: '432', label: 'Services reçus d’assujettis UE – taxe 3 %', kind: 'manual' },
    { box: '435', label: 'Services reçus d’assujettis UE, exonérés à l’intérieur du pays', kind: 'manual' },
    { box: '751', label: 'Services reçus d’assujettis hors UE – base 17 %', kind: 'base' },
    { box: '752', label: 'Services reçus d’assujettis hors UE – taxe 17 %', kind: 'tax' },
    { box: '753', label: 'Services reçus d’assujettis hors UE – base 14 %', kind: 'manual' },
    { box: '754', label: 'Services reçus d’assujettis hors UE – taxe 14 %', kind: 'manual' },
    { box: '755', label: 'Services reçus d’assujettis hors UE – base 8 %', kind: 'manual' },
    { box: '756', label: 'Services reçus d’assujettis hors UE – taxe 8 %', kind: 'manual' },
    { box: '441', label: 'Services reçus d’assujettis hors UE – base 3 %', kind: 'manual' },
    { box: '442', label: 'Services reçus d’assujettis hors UE – taxe 3 %', kind: 'manual' },
    { box: '445', label: 'Services reçus d’assujettis hors UE, exonérés', kind: 'manual' },
    {
      box: '436',
      label: 'Services reçus d’assujettis UE, non exonérés – base',
      kind: 'computed',
      formula: '741 + 743 + 745 + 431',
    },
    {
      box: '462',
      label: 'Services reçus d’assujettis UE, non exonérés – taxe',
      kind: 'computed',
      formula: '742 + 744 + 746 + 432',
    },
    {
      box: '463',
      label: 'Services reçus d’assujettis hors UE – base',
      kind: 'computed',
      formula: '751 + 753 + 755 + 441 + 445',
    },
    {
      box: '464',
      label: 'Services reçus d’assujettis hors UE – taxe',
      kind: 'computed',
      formula: '752 + 754 + 756 + 442',
    },
    {
      box: '765',
      label: 'Services reçus d’assujettis établis au Luxembourg (preneur redevable) – base',
      kind: 'manual',
    },
    {
      box: '766',
      label: 'Services reçus d’assujettis établis au Luxembourg (preneur redevable) – taxe',
      kind: 'manual',
    },
    {
      box: '409',
      label: 'E. Prestations de services – total base',
      kind: 'computed',
      formula: '436 + 435 + 463 + 765',
    },
    { box: '410', label: 'E. Prestations de services – total taxe', kind: 'computed', formula: '462 + 464 + 766' },
    { box: '768', label: 'F. Livraisons de biens à déclarer par l’acquéreur redevable – taxe', kind: 'manual' },
    { box: '227', label: 'G. Régime particulier suspensif : régularisation (art. 60bis)', kind: 'manual' },
    {
      box: '076',
      label: 'H. Total de la taxe en aval',
      kind: 'computed',
      formula: '046 + 056 + 407 + 410 + 768 + 227',
    },
    // III. Calcul de la taxe déductible
    { box: '458', label: 'Achats de biens et de services à l’intérieur du pays (art. 48/1/a)', kind: 'tax' },
    { box: '459', label: 'Acquisitions intracommunautaires de biens (art. 48/1/b)', kind: 'manual' },
    { box: '460', label: 'Importations de biens (art. 48/1/c)', kind: 'manual' },
    { box: '090', label: 'Affectations de biens (art. 48/1/d)', kind: 'manual' },
    { box: '461', label: 'Taxe déclarée comme débiteur (points II.E et F)', kind: 'tax' },
    { box: '092', label: 'Taxe acquittée comme caution solidaire', kind: 'manual' },
    { box: '228', label: 'Taxe régularisée – régime particulier suspensif (art. 60bis)', kind: 'manual' },
    {
      box: '093',
      label: 'A. Total de la taxe en amont',
      kind: 'computed',
      formula: '458 + 459 + 460 + 090 + 461 + 092 + 228',
    },
    {
      box: '094',
      label: 'Taxe en amont non déductible – opérations exonérées (art. 44, 56quater, 57bis …)',
      kind: 'manual',
    },
    { box: '095', label: 'Taxe en amont non déductible – prorata (art. 50)', kind: 'manual' },
    { box: '097', label: 'B. Total de la taxe en amont non déductible', kind: 'computed', formula: '094 + 095' },
    {
      box: '102',
      label: 'C. Total de la taxe en amont déductible (093 − 097)',
      kind: 'computed',
      formula: '093 - 097',
    },
    // IV. Calcul de l'excédent
    { box: '103', label: 'A. Total de la taxe en aval (report II.H)', kind: 'computed', formula: '076' },
    { box: '104', label: 'B. Total de la taxe en amont déductible (report III.C)', kind: 'computed', formula: '102' },
    {
      box: '105',
      label: 'C. Excédent : à payer (+) / à récupérer (−) (103 − 104)',
      kind: 'computed',
      formula: '103 - 104',
    },
  ],
  resultBox: '105',
  filingChannel: 'eCDF (plateforme électronique de collecte des données financières)',
  filingUrl: 'https://ecdf.b2g.etat.lu',
  dueRule: 'Before the 15th day of the month after the period (filing and payment)',
};
const ANNUAL: VatReturnDefinition = {
  ...PERIODIC,
  key: 'LU-TVA-ANNUAL',
  // The annual form uses partly different line numbers (e.g. 013 instead of 457 for intra-EU supplies); the periodic
  // layout is reused here as a working aid only.
  name: 'Déclaration de TVA annuelle (eCDF) – lignes au format périodique',
  kind: 'annual',
  periods: ['year'],
  dueRule: 'Before 1 May of the following year',
};
const ESL: VatReturnDefinition = {
  key: 'LU-ESL',
  name: 'État récapitulatif (livraisons et prestations intracommunautaires)',
  kind: 'ec_sales_list',
  periods: ['month', 'quarter'],
  boxes: [],
  filingChannel: 'eCDF',
  filingUrl: 'https://ecdf.b2g.etat.lu',
  dueRule:
    'Before the 25th day of the month after the period (goods monthly unless intra-EU supplies ≤ EUR 50,000 per ' +
    'quarter; services may be filed quarterly)',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'Guichet unique OSS (régime Union)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'AED – MyGuichet.lu / eCDF',
  filingUrl: 'https://guichet.public.lu',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const LU_PROFILE: AccountingCountryProfile = {
  country: 'LU',
  name: 'Luxembourg',
  defaultTemplate: 'LU-PCN',
  templates: ['LU-PCN'],
  vatReturns: [PERIODIC, ESL, OSS, ANNUAL],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  exports: ['saft', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [
    {
      env: 'BILLING_ISSUER_TAX_NUMBER',
      label: 'Matricule / numéro d’identification TVA',
      requiredFor: ['LU-TVA', 'LU-TVA-ANNUAL', 'saft'],
    },
  ],
  retention: { booksYears: 10, vouchersYears: 10 },
  defaultEinvoiceFormat: 'peppol-bis-3',
  mandatoryChart: true,
};
