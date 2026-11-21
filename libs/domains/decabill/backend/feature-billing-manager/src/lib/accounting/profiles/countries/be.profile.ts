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
 * Belgium: curated subset of the Plan comptable minimum normalisé (PCMN / MAR, mandatory; AR 21 October 2018 and
 * CSA implementing rules). 6-digit sub-accounts are customary; labels in French by Decabill.
 */

const u = undefined;
/** Custom template code: livraisons intracommunautaires (grille 46 + relevé intracommunautaire). */
const OUT_ICL = 'OUT_ICL';
const ROWS: TemplateRow[] = [
  // Classe 2 – Immobilisations
  ['211000', 'Concessions, brevets, licences, logiciels', T.ASSET, 'BS.II'],
  ['241000', 'Matériel de bureau et informatique', T.ASSET, 'BS.III', R.FIXED_ASSETS],
  ['241100', 'Petit matériel (faible valeur)', T.ASSET, 'BS.III', R.LOW_VALUE_ASSETS],
  ['260000', 'Autres immobilisations corporelles (pas de pool fiscal en Belgique)', T.ASSET, 'BS.III', R.ASSET_POOL],
  // Classe 3 – Stocks
  ['340000', 'Marchandises – valeur d’acquisition', T.ASSET, 'BS.VI', R.INVENTORY],
  // Classe 4 – Créances et dettes à un an au plus
  ['400000', 'Clients', T.ASSET, 'BS.VII.A', R.RECEIVABLES],
  ['411000', 'TVA à récupérer – taux normal', T.ASSET, 'BS.VII.B', R.VAT_INPUT_STANDARD],
  ['411100', 'TVA à récupérer – taux réduits', T.ASSET, 'BS.VII.B', R.VAT_INPUT_REDUCED],
  ['411200', 'TVA à récupérer – autoliquidation', T.ASSET, 'BS.VII.B', R.VAT_INPUT_REVERSE_CHARGE],
  ['411800', 'Acomptes TVA versés (compte-provisions TVA)', T.ASSET, 'BS.VII.B', R.VAT_PREPAYMENTS],
  ['416100', 'Créances diverses – prestataires de paiement', T.ASSET, 'BS.VII.B', R.PROCESSOR_CLEARING],
  ['499000', 'Comptes d’attente', T.ASSET, 'BS.VII.B', R.SUSPENSE],
  ['440000', 'Fournisseurs', T.LIABILITY, 'BS.P.IX.C', R.PAYABLES],
  ['451000', 'TVA à payer – taux normal', T.LIABILITY, 'BS.P.IX.E', R.VAT_OUTPUT_STANDARD],
  ['451100', 'TVA à payer – taux réduits', T.LIABILITY, 'BS.P.IX.E', R.VAT_OUTPUT_REDUCED],
  ['451200', 'TVA due – autoliquidation (cocontractant)', T.LIABILITY, 'BS.P.IX.E', R.VAT_OUTPUT_REVERSE_CHARGE],
  ['451300', 'TVA due dans d’autres États membres (guichet unique OSS)', T.LIABILITY, 'BS.P.IX.E', R.VAT_OUTPUT_OSS],
  ['451800', 'Compte courant TVA (décompte)', T.LIABILITY, 'BS.P.IX.E', R.VAT_SETTLEMENT],
  ['460000', 'Acomptes reçus sur commandes', T.LIABILITY, 'BS.P.IX.D', R.CUSTOMER_PREPAYMENTS],
  // Classe 5 – Placements de trésorerie et valeurs disponibles
  ['550000', 'Établissements de crédit – comptes courants', T.ASSET, 'BS.IX', R.BANK],
  ['570000', 'Caisses – espèces', T.ASSET, 'BS.IX', R.CASH],
  ['580000', 'Virements internes', T.ASSET, 'BS.IX', R.CASH_IN_TRANSIT],
  // Classe 1 – Fonds propres
  ['100000', 'Capital / apport', T.EQUITY, 'BS.P.I'],
  ['100100', 'Compte de l’exploitant – prélèvements', T.EQUITY, 'BS.P.EXP', R.OWNER_DRAWINGS],
  ['100200', 'Compte de l’exploitant – apports', T.EQUITY, 'BS.P.EXP', R.OWNER_CONTRIBUTIONS],
  ['140000', 'Bénéfice reporté', T.EQUITY, 'BS.P.IV', R.RETAINED_EARNINGS],
  ['141000', 'Perte reportée', T.EQUITY, 'BS.P.IV'],
  ['149000', 'Résultat de l’exercice à affecter', T.EQUITY, 'BS.P.IV', R.ANNUAL_RESULT],
  // Classe 7 – Produits
  ['700000', 'Ventes et prestations de services – TVA 21 %', T.REVENUE, 'PL.70', R.REVENUE_STANDARD, C.OUT_STANDARD],
  ['700100', 'Ventes et prestations de services – TVA 6 %', T.REVENUE, 'PL.70', R.REVENUE_REDUCED, C.OUT_REDUCED],
  ['700200', 'Ventes et prestations de services – TVA 12 %', T.REVENUE, 'PL.70', u, C.OUT_REDUCED_2],
  ['700300', 'Exportations (exonérées)', T.REVENUE, 'PL.70', R.REVENUE_TAX_FREE, C.OUT_ZERO],
  ['700310', 'Livraisons intracommunautaires exonérées', T.REVENUE, 'PL.70', u, OUT_ICL],
  [
    '700400',
    'Prestations de services intracommunautaires (autoliquidation par le preneur)',
    T.REVENUE,
    'PL.70',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
  ],
  ['700500', 'Prestations de services à des non-assujettis UE (guichet unique OSS)', T.REVENUE, 'PL.70', R.REVENUE_OSS],
  ['700600', 'Prestations de services hors UE', T.REVENUE, 'PL.70', R.REVENUE_THIRD_COUNTRY, C.OUT_EXPORT_SERVICES],
  ['700700', 'Opérations non imposables en Belgique (autres)', T.REVENUE, 'PL.70', u, C.OUT_NON_TAXABLE],
  ['708000', 'Remises, ristournes et rabais accordés', T.REVENUE, 'PL.70', R.REVENUE_REDUCTIONS],
  ['754000', 'Différences de change (produits)', T.REVENUE, 'PL.75', R.FX_GAIN],
  ['757000', 'Escomptes obtenus', T.REVENUE, 'PL.75', R.CASH_DISCOUNTS_RECEIVED],
  ['763000', 'Plus-values sur réalisation d’actifs immobilisés', T.REVENUE, 'PL.76', R.ASSET_DISPOSAL_GAIN],
  // Classe 6 – Charges
  ['604000', 'Achats de marchandises – TVA 21 %', T.EXPENSE, 'PL.60', u, C.IN_STANDARD],
  ['604100', 'Achats de marchandises – TVA taux réduits', T.EXPENSE, 'PL.60', u, C.IN_REDUCED],
  ['609400', 'Variation des stocks de marchandises', T.EXPENSE, 'PL.60', R.COST_OF_GOODS_SOLD],
  ['612200', 'Téléphone et internet', T.EXPENSE, 'PL.61'],
  ['613000', 'Services et biens divers – prestations de tiers', T.EXPENSE, 'PL.61', R.EXPENSE_DEFAULT],
  [
    '613100',
    'Services de prestataires UE (autoliquidation)',
    T.EXPENSE,
    'PL.61',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
  ],
  [
    '613200',
    'Services de prestataires hors UE (autoliquidation)',
    T.EXPENSE,
    'PL.61',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
  ],
  ['613500', 'Logiciels et licences (abonnements)', T.EXPENSE, 'PL.61'],
  ['630200', 'Dotations aux amortissements sur immobilisations corporelles', T.EXPENSE, 'PL.630', R.DEPRECIATION],
  ['642000', 'Moins-values sur réalisation de créances commerciales', T.EXPENSE, 'PL.640', R.BAD_DEBT],
  // 649 is reserved for operating charges capitalised as restructuring costs; rounding goes to 643/8 (divers)
  ['643000', 'Charges d’exploitation diverses – écarts d’arrondi', T.EXPENSE, 'PL.640', R.ROUNDING],
  ['653000', 'Escomptes accordés', T.EXPENSE, 'PL.65', R.CASH_DISCOUNTS_GRANTED],
  ['654000', 'Différences de change (charges)', T.EXPENSE, 'PL.65', R.FX_LOSS],
  // unverified: 657 as the bank / payment fee account within 65 (charges financières diverses)
  ['657000', 'Frais bancaires et de paiement', T.EXPENSE, 'PL.65', R.PAYMENT_FEES],
  ['663000', 'Moins-values sur réalisation d’actifs immobilisés', T.EXPENSE, 'PL.66', R.ASSET_DISPOSAL_LOSS],
  // Comptes techniques (hors PCMN)
  ['999000', 'Bilan d’ouverture (compte technique)', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['999100', 'Bilan d’ouverture – clients', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['999200', 'Bilan d’ouverture – fournisseurs', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/** Intervat grids: output tax for all rates in grid 54; input VAT in grid 59; purchase bases in 81–83. */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'TVA 21 %',
    kind: K.OUTPUT,
    rate: 21,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '03',
    taxBox: '54',
  },
  {
    code: C.OUT_REDUCED,
    name: 'TVA 6 %',
    kind: K.OUTPUT,
    rate: 6,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '01',
    taxBox: '54',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'TVA 12 %',
    kind: K.OUTPUT,
    rate: 12,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '02',
    taxBox: '54',
  },
  { code: C.OUT_ZERO, name: 'Exportations et autres opérations exemptées', kind: K.EXEMPT, rate: 0, baseBox: '47' },
  {
    code: OUT_ICL,
    name: 'Livraisons intracommunautaires exemptées',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '46',
    ecSalesList: true,
  },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Services intracommunautaires (art. 21, § 2), TVA due par le preneur',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '44',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS : TVA due dans un autre État membre',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    oss: true,
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Services hors UE (lieu de prestation à l’étranger)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '47',
  },
  {
    code: C.OUT_NON_TAXABLE,
    name: 'Opérations effectuées à l’étranger (autres)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '47',
  },
  {
    code: C.IN_STANDARD,
    name: 'TVA déductible 21 %',
    kind: K.INPUT,
    rate: 21,
    accountRole: R.VAT_INPUT_STANDARD,
    baseBox: '82',
    taxBox: '59',
  },
  {
    code: C.IN_REDUCED,
    name: 'TVA déductible 6 %',
    kind: K.INPUT,
    rate: 6,
    accountRole: R.VAT_INPUT_REDUCED,
    baseBox: '82',
    taxBox: '59',
  },
  { code: C.IN_NONE, name: 'Achats sans TVA déductible', kind: K.EXEMPT, rate: 0, baseBox: '82' },
  {
    code: C.RC_EU_SERVICES,
    name: 'Autoliquidation – services intracommunautaires reçus 21 %',
    kind: K.REVERSE_CHARGE,
    rate: 21,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '88',
    taxBox: '55',
    reverseTaxBox: '59',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Autoliquidation – services de prestataires hors UE 21 %',
    kind: K.REVERSE_CHARGE,
    rate: 21,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '87',
    taxBox: '56',
    reverseTaxBox: '59',
  },
];

export const BE_PCMN_TEMPLATE: ChartTemplate = {
  key: 'BE-PCMN',
  country: 'BE',
  name: 'Plan comptable minimum normalisé (PCMN / MAR)',
  description: 'Plan comptable minimum normalisé belge – classes 1 à 7, sous-comptes à 6 chiffres (obligatoire).',
  accountLength: 6,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Curated subset of the Belgian PCMN (mandatory; arrêté royal du 21 octobre 2018); 6-digit sub-accounts and labels ' +
    'by Decabill. Unverified sub-account choices: 757 escomptes obtenus, 653 escomptes accordés, 657 frais bancaires, ' +
    '100100/100200 compte de l’exploitant, 149000 résultat à ' +
    'affecter (the Belgian balance sheet has no separate result line), 999xxx technical opening accounts (outside ' +
    'the PCMN). Statements per schéma abrégé (CSA). Intervat grids per the periodic return; purchase bases of reverse ' +
    'charge services must also be entered in grids 81–83 manually; OSS sales are not reported in grid 47 (unverified).',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'BE-ABREGE-BILAN',
  name: 'Bilan (schéma abrégé)',
  kind: 'balance_sheet',
  // Labels follow the BNB models for companies under the CSA (rubric codes in brackets); the position ids keep the
  // former roman-numeral scheme.
  assets: [
    { code: 'BS.I', label: 'Frais d’établissement (20)' },
    {
      code: 'BS.AI',
      label: 'Actifs immobilisés (21/28)',
      children: [
        { code: 'BS.II', label: 'Immobilisations incorporelles (21)' },
        { code: 'BS.III', label: 'Immobilisations corporelles (22/27)' },
        { code: 'BS.IV', label: 'Immobilisations financières (28)' },
      ],
    },
    {
      code: 'BS.AC',
      label: 'Actifs circulants (29/58)',
      children: [
        { code: 'BS.V', label: 'Créances à plus d’un an (29)' },
        { code: 'BS.VI', label: 'Stocks et commandes en cours d’exécution (3)' },
        {
          code: 'BS.VII',
          label: 'Créances à un an au plus (40/41)',
          children: [
            { code: 'BS.VII.A', label: 'Créances commerciales (40)' },
            { code: 'BS.VII.B', label: 'Autres créances (41)' },
          ],
        },
        { code: 'BS.VIII', label: 'Placements de trésorerie (50/53)' },
        { code: 'BS.IX', label: 'Valeurs disponibles (54/58)' },
        { code: 'BS.X', label: 'Comptes de régularisation (490/1)' },
      ],
    },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.P.CP',
      label: 'Capitaux propres (10/15)',
      children: [
        { code: 'BS.P.I', label: 'Apport / Capital (10/11)' },
        { code: 'BS.P.III', label: 'Réserves (13)' },
        { code: 'BS.P.IV', label: 'Bénéfice (Perte) reporté(e) (14)' },
        { code: 'BS.P.EXP', label: 'Compte de l’exploitant (personnes physiques)' },
      ],
    },
    { code: 'BS.P.VII', label: 'Provisions et impôts différés (16)' },
    { code: 'BS.P.VIII', label: 'Dettes à plus d’un an (17)' },
    {
      code: 'BS.P.IX',
      label: 'Dettes à un an au plus (42/48)',
      children: [
        { code: 'BS.P.IX.C', label: 'Dettes commerciales (44)' },
        { code: 'BS.P.IX.D', label: 'Acomptes reçus sur commandes (46)' },
        { code: 'BS.P.IX.E', label: 'Dettes fiscales, salariales et sociales (45)' },
        { code: 'BS.P.IX.F', label: 'Autres dettes (47/48)' },
      ],
    },
    { code: 'BS.P.X', label: 'Comptes de régularisation (492/3)' },
  ],
  resultPosition: 'BS.P.IV',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'BE-ABREGE-CR',
  name: 'Compte de résultats (schéma abrégé)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.70', label: 'Chiffre d’affaires (70)', sign: 1 },
    { code: 'PL.74', label: 'Autres produits d’exploitation (74)', sign: 1 },
    { code: 'PL.60', label: 'Approvisionnements et marchandises (60)', sign: -1 },
    { code: 'PL.61', label: 'Services et biens divers (61)', sign: -1 },
    { code: 'PL.62', label: 'Rémunérations, charges sociales et pensions (62)', sign: -1 },
    { code: 'PL.630', label: 'Amortissements et réductions de valeur sur immobilisations (630)', sign: -1 },
    { code: 'PL.631', label: 'Réductions de valeur sur stocks et créances commerciales (631/4)', sign: -1 },
    { code: 'PL.640', label: 'Autres charges d’exploitation (640/8)', sign: -1 },
    { code: 'PL.75', label: 'Produits financiers récurrents (75)', sign: 1 },
    { code: 'PL.65', label: 'Charges financières récurrentes (65)', sign: -1 },
    { code: 'PL.76', label: 'Produits non récurrents (76)', sign: 1 },
    { code: 'PL.66', label: 'Charges non récurrentes (66)', sign: -1 },
    { code: 'PL.67', label: 'Impôts sur le résultat (67/77)', sign: -1 },
  ],
};
const OUTPUT_TAX = '54 + 55 + 56 + 57 + 61 + 63';
const INPUT_TAX = '59 + 62 + 64';
const PERIODIC: VatReturnDefinition = {
  key: 'BE-TVA',
  name: 'Déclaration périodique à la TVA (Intervat)',
  kind: 'periodic',
  periods: ['month', 'quarter'],
  boxes: [
    { box: '00', label: 'Opérations soumises à un régime particulier', kind: 'manual' },
    { box: '01', label: 'Opérations à 6 %', kind: 'base' },
    { box: '02', label: 'Opérations à 12 %', kind: 'base' },
    { box: '03', label: 'Opérations à 21 %', kind: 'base' },
    { box: '44', label: 'Services intracommunautaires (art. 21, § 2)', kind: 'base' },
    { box: '45', label: 'Opérations avec TVA due par le cocontractant', kind: 'manual' },
    { box: '46', label: 'Livraisons intracommunautaires exemptées et ventes ABC', kind: 'base' },
    { box: '47', label: 'Autres opérations exemptées et opérations effectuées à l’étranger', kind: 'base' },
    { box: '48', label: 'Notes de crédit relatives aux opérations des grilles 44 et 46', kind: 'manual' },
    { box: '49', label: 'Autres notes de crédit émises', kind: 'manual' },
    { box: '81', label: 'Achats – marchandises, matières premières et auxiliaires', kind: 'manual' },
    { box: '82', label: 'Achats – services et biens divers', kind: 'base' },
    { box: '83', label: 'Achats – biens d’investissement', kind: 'manual' },
    { box: '84', label: 'Notes de crédit reçues relatives aux grilles 86 et 88', kind: 'manual' },
    { box: '85', label: 'Autres notes de crédit reçues', kind: 'manual' },
    { box: '86', label: 'Acquisitions intracommunautaires et ventes ABC', kind: 'manual' },
    { box: '87', label: 'Autres opérations à l’entrée avec TVA due par le déclarant', kind: 'base' },
    { box: '88', label: 'Services intracommunautaires reçus (art. 21, § 2)', kind: 'base' },
    { box: '54', label: 'TVA due sur les opérations des grilles 01, 02 et 03', kind: 'tax' },
    { box: '55', label: 'TVA due sur les opérations des grilles 86 et 88', kind: 'tax' },
    { box: '56', label: 'TVA due sur les opérations de la grille 87', kind: 'tax' },
    { box: '57', label: 'TVA relative aux importations avec report de perception', kind: 'manual' },
    { box: '61', label: 'Diverses régularisations TVA en faveur de l’État', kind: 'manual' },
    { box: '63', label: 'TVA à reverser mentionnée sur les notes de crédit reçues', kind: 'manual' },
    { box: '59', label: 'TVA déductible', kind: 'tax' },
    { box: '62', label: 'Diverses régularisations TVA en faveur du déclarant', kind: 'manual' },
    { box: '64', label: 'TVA à récupérer mentionnée sur les notes de crédit délivrées', kind: 'manual' },
    { box: '71', label: 'Taxe due à l’État', kind: 'computed', formula: `${OUTPUT_TAX} - 59 - 62 - 64` },
    {
      box: '72',
      label: 'Sommes dues par l’État',
      kind: 'computed',
      formula: `${INPUT_TAX} - 54 - 55 - 56 - 57 - 61 - 63`,
    },
    { box: '91', label: 'Acompte de décembre (déclarants mensuels)', kind: 'manual' },
  ],
  resultBox: '71',
  filingChannel: 'Intervat (MyMinfin) or accounting software via API',
  filingUrl: 'https://finances.belgium.be/fr/E-services/Intervat',
  dueRule:
    'Monthly filers: 20th day of the month after the period; quarterly filers: 25th day of the month after the ' +
    'quarter (filing and payment, since 1 January 2025)',
};
const LISTING: VatReturnDefinition = {
  key: 'BE-LISTING-IC',
  name: 'Relevé intracommunautaire (listing IC)',
  kind: 'ec_sales_list',
  periods: ['month', 'quarter'],
  boxes: [],
  filingChannel: 'Intervat',
  filingUrl: 'https://finances.belgium.be/fr/E-services/Intervat',
  dueRule:
    'Same deadline as the periodic return: 20th day of the month after the period (monthly), 25th day of the month ' +
    'after the quarter (quarterly)',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'Guichet unique OSS (régime Union)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'MyMinfin (OSS)',
  filingUrl: 'https://finances.belgium.be',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const BE_PROFILE: AccountingCountryProfile = {
  country: 'BE',
  name: 'Belgique / België',
  defaultTemplate: 'BE-PCMN',
  templates: ['BE-PCMN'],
  vatReturns: [PERIODIC, LISTING, OSS],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  exports: ['saft', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [
    {
      env: 'BILLING_ISSUER_TAX_NUMBER',
      label: 'Numéro d’entreprise / TVA (BE0…)',
      requiredFor: ['BE-TVA', 'BE-LISTING-IC'],
    },
  ],
  // CDE art. III.88: 7 years for accounting books; tax law (incl. art. 60 Code TVA) 10 years since 2023 (loi du
  // 30 novembre 2022) – the longer period applies in practice.
  retention: { booksYears: 10, vouchersYears: 10 },
  defaultEinvoiceFormat: 'peppol-bis-3',
  complianceNotice:
    'Facturation électronique B2B structurée via le réseau Peppol obligatoire depuis le 1er janvier 2026. Decabill ' +
    'génère des fichiers Peppol BIS mais ne les transmet pas via le réseau Peppol (pas de point d’accès) ; ' +
    'l’e-reporting prévu à partir de 2028 n’est pas implémenté. La liste annuelle des clients assujettis ' +
    '(31 mars) doit être déposée séparément.',
  mandatoryChart: true,
};
