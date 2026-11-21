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
 * France: curated subset of the Plan comptable général (PCG, règlement ANC 2014-03 as amended by ANC 2022-06,
 * applicable from 2025). The PCG is mandatory; 6-digit sub-accounts are customary (FEC exports use them as-is).
 */

const u = undefined;
/** Custom template codes. */
const OUT_ICL = 'OUT_ICL';
const OUT_SUPER_RED = 'OUT_SUPER_RED';
const ROWS: TemplateRow[] = [
  // Classe 2 – Immobilisations
  ['205000', 'Concessions, brevets, licences, logiciels', T.ASSET, 'BS.AI.inc'],
  ['218300', 'Matériel de bureau et matériel informatique', T.ASSET, 'BS.AI.corp', R.FIXED_ASSETS],
  ['218400', 'Mobilier', T.ASSET, 'BS.AI.corp'],
  ['218800', 'Autres immobilisations corporelles (pas de pool fiscal en France)', T.ASSET, 'BS.AI.corp', R.ASSET_POOL],
  ['218810', 'Petit matériel immobilisé (faible valeur)', T.ASSET, 'BS.AI.corp', R.LOW_VALUE_ASSETS],
  // Classe 3 – Stocks
  ['370000', 'Stocks de marchandises', T.ASSET, 'BS.AC.stocks', R.INVENTORY],
  // Classe 4 – Tiers
  ['411000', 'Clients', T.ASSET, 'BS.AC.clients', R.RECEIVABLES],
  [
    '445660',
    'TVA déductible sur autres biens et services – taux normal',
    T.ASSET,
    'BS.AC.autres',
    R.VAT_INPUT_STANDARD,
    u,
    'DEP.tva',
  ],
  [
    '445661',
    'TVA déductible sur autres biens et services – taux réduits',
    T.ASSET,
    'BS.AC.autres',
    R.VAT_INPUT_REDUCED,
    u,
    'DEP.tva',
  ],
  [
    '445662',
    'TVA déductible intracommunautaire / autoliquidée',
    T.ASSET,
    'BS.AC.autres',
    R.VAT_INPUT_REVERSE_CHARGE,
    u,
    'DEP.tva',
  ],
  ['445670', 'Crédit de TVA à reporter', T.ASSET, 'BS.AC.autres'],
  ['445810', 'Acomptes de TVA – régime simplifié', T.ASSET, 'BS.AC.autres', R.VAT_PREPAYMENTS, u, 'DEP.tva'],
  ['471000', "Compte d'attente", T.ASSET, 'BS.AC.autres', R.SUSPENSE],
  ['401000', 'Fournisseurs', T.LIABILITY, 'BS.D.fourn', R.PAYABLES],
  ['419100', 'Clients – avances et acomptes reçus sur commandes', T.LIABILITY, 'BS.D.avances', R.CUSTOMER_PREPAYMENTS],
  [
    '445200',
    'TVA due intracommunautaire et autoliquidée',
    T.LIABILITY,
    'BS.D.fisc',
    R.VAT_OUTPUT_REVERSE_CHARGE,
    u,
    'REC.tva',
  ],
  ['445510', 'TVA à décaisser', T.LIABILITY, 'BS.D.fisc', R.VAT_SETTLEMENT, u, 'DEP.tva'],
  ['445711', 'TVA collectée – taux normal 20 %', T.LIABILITY, 'BS.D.fisc', R.VAT_OUTPUT_STANDARD, u, 'REC.tva'],
  [
    '445712',
    'TVA collectée – taux réduits (10 % / 5,5 % / 2,1 %)',
    T.LIABILITY,
    'BS.D.fisc',
    R.VAT_OUTPUT_REDUCED,
    u,
    'REC.tva',
  ],
  [
    '445718',
    "TVA due dans d'autres États membres (guichet unique OSS)",
    T.LIABILITY,
    'BS.D.fisc',
    R.VAT_OUTPUT_OSS,
    u,
    'REC.tva',
  ],
  // Classe 5 – Financiers
  ['512000', 'Banque', T.ASSET, 'BS.AC.dispo', R.BANK],
  ['517000', 'Autres organismes financiers (prestataires de paiement)', T.ASSET, 'BS.AC.dispo', R.PROCESSOR_CLEARING],
  ['530000', 'Caisse', T.ASSET, 'BS.AC.dispo', R.CASH],
  ['580000', 'Virements internes', T.ASSET, 'BS.AC.dispo', R.CASH_IN_TRANSIT],
  // Classe 1 – Capitaux
  ['101300', 'Capital souscrit – appelé, versé', T.EQUITY, 'BS.CP.capital'],
  ['108100', "Compte de l'exploitant – prélèvements", T.EQUITY, 'BS.CP.capital', R.OWNER_DRAWINGS],
  ['108200', "Compte de l'exploitant – apports", T.EQUITY, 'BS.CP.capital', R.OWNER_CONTRIBUTIONS],
  ['110000', 'Report à nouveau (solde créditeur)', T.EQUITY, 'BS.CP.ran', R.RETAINED_EARNINGS],
  ['119000', 'Report à nouveau (solde débiteur)', T.EQUITY, 'BS.CP.ran'],
  ['120000', "Résultat de l'exercice (bénéfice)", T.EQUITY, 'BS.CP.res', R.ANNUAL_RESULT],
  ['129000', "Résultat de l'exercice (perte)", T.EQUITY, 'BS.CP.res'],
  // Classe 7 – Produits
  [
    '706100',
    'Prestations de services – France 20 %',
    T.REVENUE,
    'PL.PE.serv',
    R.REVENUE_STANDARD,
    C.OUT_STANDARD,
    'REC.hon',
  ],
  [
    '706200',
    'Prestations de services – France 10 %',
    T.REVENUE,
    'PL.PE.serv',
    R.REVENUE_REDUCED,
    C.OUT_REDUCED,
    'REC.hon',
  ],
  ['706210', 'Prestations de services – France 5,5 %', T.REVENUE, 'PL.PE.serv', u, C.OUT_REDUCED_2, 'REC.hon'],
  ['706220', 'Prestations de services – France 2,1 %', T.REVENUE, 'PL.PE.serv', u, OUT_SUPER_RED, 'REC.hon'],
  [
    '706300',
    'Prestations de services intracommunautaires (autoliquidation par le preneur)',
    T.REVENUE,
    'PL.PE.serv',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    'REC.hon',
  ],
  [
    '706400',
    'Prestations de services à des non-assujettis UE (guichet unique OSS)',
    T.REVENUE,
    'PL.PE.serv',
    R.REVENUE_OSS,
    u,
    'REC.hon',
  ],
  [
    '706500',
    'Prestations de services hors UE',
    T.REVENUE,
    'PL.PE.serv',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    'REC.hon',
  ],
  ['706600', 'Prestations non imposables en France (autres)', T.REVENUE, 'PL.PE.serv', u, C.OUT_NON_TAXABLE, 'REC.hon'],
  [
    '707300',
    'Ventes de marchandises – exportations',
    T.REVENUE,
    'PL.PE.march',
    R.REVENUE_TAX_FREE,
    C.OUT_ZERO,
    'REC.hon',
  ],
  [
    '707400',
    'Ventes de marchandises – livraisons intracommunautaires',
    T.REVENUE,
    'PL.PE.march',
    u,
    OUT_ICL,
    'REC.hon',
  ],
  [
    '709600',
    'Rabais, remises et ristournes accordés sur prestations de services',
    T.REVENUE,
    'PL.PE.serv',
    R.REVENUE_REDUCTIONS,
    u,
    'REC.hon',
  ],
  ['756000', 'Gains de change sur créances et dettes commerciales', T.REVENUE, 'PL.PE.autres', R.FX_GAIN, u, 'REC.div'],
  [
    '757000',
    "Produits des cessions d'immobilisations incorporelles et corporelles",
    T.REVENUE,
    'PL.PE.autres',
    R.ASSET_DISPOSAL_GAIN,
    u,
    'REC.div',
  ],
  ['765000', 'Escomptes obtenus', T.REVENUE, 'PL.PF', R.CASH_DISCOUNTS_RECEIVED, u, 'REC.div'],
  // Classe 6 – Charges
  ['603700', 'Variation des stocks de marchandises', T.EXPENSE, 'PL.CE.var', R.COST_OF_GOODS_SOLD, u, 'DEP.achats'],
  ['604000', "Achats d'études et prestations de services", T.EXPENSE, 'PL.CE.ext', R.EXPENSE_DEFAULT, u, 'DEP.ext'],
  [
    '604100',
    'Achats de prestations de services intracommunautaires (autoliquidation)',
    T.EXPENSE,
    'PL.CE.ext',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    'DEP.ext',
  ],
  [
    '604200',
    'Achats de prestations de services hors UE (autoliquidation)',
    T.EXPENSE,
    'PL.CE.ext',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    'DEP.ext',
  ],
  ['607100', 'Achats de marchandises – TVA 20 %', T.EXPENSE, 'PL.CE.achats', u, C.IN_STANDARD, 'DEP.achats'],
  ['607200', 'Achats de marchandises – TVA taux réduits', T.EXPENSE, 'PL.CE.achats', u, C.IN_REDUCED, 'DEP.achats'],
  ['622600', 'Honoraires', T.EXPENSE, 'PL.CE.ext', u, u, 'DEP.ext'],
  ['626000', 'Frais postaux et de télécommunications', T.EXPENSE, 'PL.CE.ext', u, u, 'DEP.ext'],
  ['627000', 'Services bancaires et assimilés', T.EXPENSE, 'PL.CE.ext', R.PAYMENT_FEES, u, 'DEP.fin'],
  ['651000', 'Redevances pour concessions, brevets, licences, logiciels', T.EXPENSE, 'PL.CE.autres', u, u, 'DEP.div'],
  ['654000', 'Pertes sur créances irrécouvrables', T.EXPENSE, 'PL.CE.autres', R.BAD_DEBT, u, 'DEP.div'],
  [
    '656000',
    'Pertes de change sur créances et dettes commerciales',
    T.EXPENSE,
    'PL.CE.autres',
    R.FX_LOSS,
    u,
    'DEP.div',
  ],
  [
    '657000',
    'Valeurs comptables des immobilisations incorporelles et corporelles cédées',
    T.EXPENSE,
    'PL.CE.autres',
    R.ASSET_DISPOSAL_LOSS,
    u,
    'DEP.div',
  ],
  // 6581 is « Pénalités sur marchés » since ANC 2022-06; rounding differences go to 658 « Pénalités et autres
  // charges ».
  ['658000', "Autres charges – écarts d'arrondi", T.EXPENSE, 'PL.CE.autres', R.ROUNDING, u, 'DEP.div'],
  ['665000', 'Escomptes accordés', T.EXPENSE, 'PL.CF', R.CASH_DISCOUNTS_GRANTED, u, 'DEP.fin'],
  [
    '681120',
    'Dotations aux amortissements des immobilisations corporelles',
    T.EXPENSE,
    'PL.CE.dot',
    R.DEPRECIATION,
    u,
    'DEP.amort',
  ],
  // Classe 8 – Comptes spéciaux
  ['890000', "Bilan d'ouverture", T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['890100', "Bilan d'ouverture – clients", T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['890200', "Bilan d'ouverture – fournisseurs", T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/**
 * CA3 (3310-CA3-SD, CERFA 10963, millésime 2026) lines: bases per rate in `08` / `9B` / `09` / `T6`, derived tax in
 * Decabill's own `…T` boxes; `08R` collects self-assessed VAT (art. 283-1 / 283-2) that must be added to line 08
 * together with bases A3 / B4. OSS B2C services (TBE / e-services declared via the guichet unique) belong in E2 per
 * the notice 3310-NOT-CA3-SD; E3 is reserved for intra-EU distance sales of goods.
 */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'TVA collectée 20 %',
    kind: K.OUTPUT,
    rate: 20,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '08',
    taxBox: '08T',
  },
  {
    code: C.OUT_REDUCED,
    name: 'TVA collectée 10 %',
    kind: K.OUTPUT,
    rate: 10,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '9B',
    taxBox: '9BT',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'TVA collectée 5,5 %',
    kind: K.OUTPUT,
    rate: 5.5,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '09',
    taxBox: '09T',
  },
  {
    code: OUT_SUPER_RED,
    name: 'TVA collectée 2,1 %',
    kind: K.OUTPUT,
    rate: 2.1,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: 'T6',
    taxBox: 'T6T',
  },
  { code: C.OUT_ZERO, name: 'Exportations hors UE (exonérées)', kind: K.EXEMPT, rate: 0, baseBox: 'E1' },
  {
    code: OUT_ICL,
    name: 'Livraisons intracommunautaires exonérées',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'F2',
    ecSalesList: true,
  },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Prestations de services intracommunautaires (art. 259-1, autoliquidation preneur)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'E2',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS : prestations imposables dans un autre État membre',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    baseBox: 'E2',
    oss: true,
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Prestations de services hors UE (non imposables en France)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'E2',
  },
  { code: C.OUT_NON_TAXABLE, name: 'Autres opérations non imposables', kind: K.EXEMPT, rate: 0, baseBox: 'E2' },
  {
    code: C.IN_STANDARD,
    name: 'TVA déductible 20 %',
    kind: K.INPUT,
    rate: 20,
    accountRole: R.VAT_INPUT_STANDARD,
    taxBox: '20',
  },
  {
    code: C.IN_REDUCED,
    name: 'TVA déductible 10 %',
    kind: K.INPUT,
    rate: 10,
    accountRole: R.VAT_INPUT_REDUCED,
    taxBox: '20',
  },
  { code: C.IN_NONE, name: 'Sans TVA déductible', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: 'Autoliquidation – prestations intracommunautaires reçues (art. 283-2) 20 %',
    kind: K.REVERSE_CHARGE,
    rate: 20,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: 'A3',
    taxBox: '08R',
    reverseTaxBox: '20',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Autoliquidation – assujetti non établi en France (art. 283-1) 20 %',
    kind: K.REVERSE_CHARGE,
    rate: 20,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: 'B4',
    taxBox: '08R',
    reverseTaxBox: '20',
  },
];

export const FR_PCG_TEMPLATE: ChartTemplate = {
  key: 'FR-PCG',
  country: 'FR',
  name: 'Plan comptable général (PCG)',
  description: 'Plan comptable général – système de base, comptes à 6 chiffres (obligatoire, export FEC).',
  accountLength: 6,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Curated subset of the PCG (règlement ANC 2014-03, amended by ANC 2022-06 applicable to fiscal years from ' +
    '1 January 2025; account numbers checked against the ANC Recueil des normes comptables, version 1 January ' +
    '2025: 656/756 commercial FX differences, 657/757 asset disposals); 6-digit sub-accounts and labels by Decabill. ' +
    'CA3 lines per form 3310-CA3-SD and notice 3310-NOT-CA3-SD (millésime 2026): 2,1 % in France continentale on ' +
    'line T6, OSS B2C services in E2. Line 08 must include self-assessed VAT (box 08R) and bases A3/B4 manually. ' +
    'Bases and tax are rounded to the nearest euro on the return (not modelled). The CA12 annual return uses its ' +
    'own line numbering; boxes are shown with CA3 ids.',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'FR-PCG-BILAN',
  name: 'Bilan (modèle PCG, système de base)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.AI',
      label: 'Actif immobilisé',
      children: [
        { code: 'BS.AI.inc', label: 'Immobilisations incorporelles' },
        { code: 'BS.AI.corp', label: 'Immobilisations corporelles' },
        { code: 'BS.AI.fin', label: 'Immobilisations financières' },
      ],
    },
    {
      code: 'BS.AC',
      label: 'Actif circulant',
      children: [
        { code: 'BS.AC.stocks', label: 'Stocks et en-cours' },
        { code: 'BS.AC.clients', label: 'Créances clients et comptes rattachés' },
        { code: 'BS.AC.autres', label: 'Autres créances' },
        { code: 'BS.AC.vmp', label: 'Valeurs mobilières de placement' },
        { code: 'BS.AC.dispo', label: 'Disponibilités' },
      ],
    },
    { code: 'BS.CCA', label: "Charges constatées d'avance" },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.CP',
      label: 'Capitaux propres',
      children: [
        { code: 'BS.CP.capital', label: "Capital (dont compte de l'exploitant)" },
        { code: 'BS.CP.reserves', label: 'Réserves' },
        { code: 'BS.CP.ran', label: 'Report à nouveau' },
        { code: 'BS.CP.res', label: "Résultat de l'exercice" },
      ],
    },
    { code: 'BS.PR', label: 'Provisions' },
    {
      code: 'BS.D',
      label: 'Dettes',
      children: [
        { code: 'BS.D.emprunts', label: 'Emprunts et dettes financières' },
        { code: 'BS.D.avances', label: 'Avances et acomptes reçus sur commandes en cours' },
        { code: 'BS.D.fourn', label: 'Dettes fournisseurs et comptes rattachés' },
        { code: 'BS.D.fisc', label: 'Dettes fiscales et sociales' },
        { code: 'BS.D.autres', label: 'Autres dettes' },
      ],
    },
    { code: 'BS.PCA', label: "Produits constatés d'avance" },
  ],
  resultPosition: 'BS.CP.res',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'FR-PCG-CR',
  name: 'Compte de résultat (modèle PCG, en liste)',
  kind: 'profit_and_loss',
  lines: [
    {
      code: 'PL.PE',
      label: "Produits d'exploitation",
      sign: 1,
      children: [
        { code: 'PL.PE.march', label: 'Ventes de marchandises', sign: 1 },
        { code: 'PL.PE.serv', label: 'Production vendue (biens et services)', sign: 1 },
        { code: 'PL.PE.autres', label: 'Autres produits', sign: 1 },
      ],
    },
    {
      code: 'PL.CE',
      label: "Charges d'exploitation",
      sign: -1,
      children: [
        { code: 'PL.CE.achats', label: 'Achats de marchandises', sign: -1 },
        { code: 'PL.CE.var', label: 'Variation de stock (marchandises)', sign: -1 },
        { code: 'PL.CE.ext', label: 'Autres achats et charges externes', sign: -1 },
        { code: 'PL.CE.impots', label: 'Impôts, taxes et versements assimilés', sign: -1 },
        { code: 'PL.CE.pers', label: 'Salaires, traitements et charges sociales', sign: -1 },
        { code: 'PL.CE.dot', label: 'Dotations aux amortissements et aux provisions', sign: -1 },
        { code: 'PL.CE.autres', label: 'Autres charges', sign: -1 },
      ],
    },
    { code: 'PL.PF', label: 'Produits financiers', sign: 1 },
    { code: 'PL.CF', label: 'Charges financières', sign: -1 },
    { code: 'PL.PX', label: 'Produits exceptionnels', sign: 1 },
    { code: 'PL.CX', label: 'Charges exceptionnelles', sign: -1 },
    { code: 'PL.IS', label: 'Impôts sur les bénéfices', sign: -1 },
  ],
};
const CASH_BASIS: StatementLayout = {
  key: 'FR-BNC-2035',
  name: 'Recettes / dépenses (BNC – déclaration contrôlée 2035, micro-BNC)',
  kind: 'cash_basis',
  lines: [
    {
      code: 'REC',
      label: 'Recettes',
      sign: 1,
      children: [
        { code: 'REC.hon', label: 'Recettes encaissées (honoraires, prestations, ventes)', sign: 1 },
        { code: 'REC.div', label: 'Produits divers', sign: 1 },
        { code: 'REC.tva', label: 'TVA collectée encaissée (comptabilité TTC)', sign: 1 },
      ],
    },
    {
      code: 'DEP',
      label: 'Dépenses',
      sign: -1,
      children: [
        { code: 'DEP.achats', label: 'Achats', sign: -1 },
        { code: 'DEP.ext', label: 'Travaux, fournitures et services extérieurs', sign: -1 },
        { code: 'DEP.fin', label: 'Frais financiers', sign: -1 },
        { code: 'DEP.div', label: 'Autres frais divers de gestion', sign: -1 },
        { code: 'DEP.amort', label: 'Dotations aux amortissements', sign: -1 },
        { code: 'DEP.tva', label: 'TVA déductible et TVA reversée au Trésor (comptabilité TTC)', sign: -1 },
      ],
    },
  ],
};
const CA3: VatReturnDefinition = {
  key: 'FR-CA3',
  name: 'Déclaration de TVA CA3 (3310-CA3)',
  kind: 'periodic',
  periods: ['month', 'quarter'],
  // Amounts are rounded to the nearest euro on the return (notice 3310-NOT-CA3-SD, « arrondis fiscaux »); Decabill
  // shows exact amounts (no round-down).
  boxes: [
    { box: 'A1', label: 'Ventes, prestations de services', kind: 'computed', formula: '08 + 9B + 09 + T6' },
    { box: 'A2', label: 'Autres opérations imposables', kind: 'manual' },
    {
      box: 'A3',
      label: 'Achats de prestations de services réalisés auprès d’un assujetti non établi en France (art. 283-2)',
      kind: 'base',
    },
    { box: 'B2', label: 'Acquisitions intracommunautaires', kind: 'manual' },
    {
      box: 'B4',
      label: 'Achats de biens ou prestations auprès d’un assujetti non établi en France (art. 283-1)',
      kind: 'base',
    },
    { box: 'E1', label: 'Exportations hors UE', kind: 'base' },
    { box: 'E2', label: 'Autres opérations non imposables', kind: 'base' },
    { box: 'E3', label: 'Ventes à distance taxables dans un autre État membre (ventes B to C)', kind: 'manual' },
    {
      box: 'F2',
      label: 'Livraisons intracommunautaires à destination d’une personne assujettie (ventes B to B)',
      kind: 'base',
    },
    { box: '08', label: 'Taux normal 20 % – base hors taxe', kind: 'base' },
    { box: '08T', label: 'Taux normal 20 % – taxe due', kind: 'tax' },
    { box: '09', label: 'Taux réduit 5,5 % – base hors taxe', kind: 'base' },
    { box: '09T', label: 'Taux réduit 5,5 % – taxe due', kind: 'tax' },
    { box: '9B', label: 'Taux réduit 10 % – base hors taxe', kind: 'base' },
    { box: '9BT', label: 'Taux réduit 10 % – taxe due', kind: 'tax' },
    { box: 'T6', label: 'Opérations réalisées en France continentale au taux de 2,1 % – base', kind: 'base' },
    { box: 'T6T', label: 'Opérations réalisées en France continentale au taux de 2,1 % – taxe due', kind: 'tax' },
    {
      box: '08R',
      label: 'TVA autoliquidée sur achats A3/B4 – à reporter ligne 08 (base et taxe)',
      kind: 'tax',
    },
    { box: '15', label: 'TVA antérieurement déduite à reverser', kind: 'manual' },
    { box: '5B', label: 'Sommes à ajouter, y compris acompte congés', kind: 'manual' },
    {
      box: '16',
      label: 'Total de la TVA brute due (lignes 08 à 5B)',
      kind: 'computed',
      formula: '08T + 09T + 9BT + T6T + 08R + 15 + 5B',
    },
    { box: '17', label: 'Dont TVA sur acquisitions intracommunautaires (ligne B2)', kind: 'manual' },
    { box: '19', label: 'TVA déductible sur biens constituant des immobilisations', kind: 'manual' },
    { box: '20', label: 'TVA déductible sur autres biens et services', kind: 'tax' },
    { box: '21', label: 'Autre TVA à déduire', kind: 'manual' },
    { box: '22', label: 'Report du crédit apparaissant ligne 27 de la précédente déclaration', kind: 'manual' },
    { box: '2C', label: 'Sommes à imputer, y compris acompte congés', kind: 'manual' },
    { box: '23', label: 'Total TVA déductible (lignes 19 à 2C)', kind: 'computed', formula: '19 + 20 + 21 + 22 + 2C' },
    {
      box: 'TD',
      label: 'TVA due (ligne 16 – ligne 23) ; si négatif : crédit de TVA ligne 25 (ligne 23 – ligne 16)',
      kind: 'computed',
      formula: '08T + 09T + 9BT + T6T + 08R + 15 + 5B - 19 - 20 - 21 - 22 - 2C',
    },
    {
      box: '28',
      label: 'TVA nette due (ligne TD – ligne X5, crédit d’accise non modélisé) ; crédit si négatif',
      kind: 'computed',
      formula: '08T + 09T + 9BT + T6T + 08R + 15 + 5B - 19 - 20 - 21 - 22 - 2C',
    },
    { box: '29', label: 'Taxes assimilées calculées sur l’annexe n° 3310-A', kind: 'manual' },
    {
      box: '32',
      label: 'Total à payer (lignes 28 + 29 + Z5 – AB ; Z5/AB non modélisés)',
      kind: 'computed',
      formula: '08T + 09T + 9BT + T6T + 08R + 15 + 5B - 19 - 20 - 21 - 22 - 2C + 29',
    },
  ],
  resultBox: '28',
  filingChannel: 'impots.gouv.fr – espace professionnel (mode EFI) or EDI-TVA via a partner (mode EDI)',
  filingUrl: 'https://www.impots.gouv.fr/professionnel',
  dueRule:
    'Between the 15th and the 24th of the following month (date set by the SIE per company); quarterly filing only ' +
    'when the annual VAT due is below 4 000 €',
};
const CA12: VatReturnDefinition = {
  ...CA3,
  key: 'FR-CA12',
  name: 'Déclaration annuelle de TVA CA12 (régime simplifié) – lignes au format CA3',
  kind: 'annual',
  periods: ['year'],
  dueRule: '2nd working day after 1 May of the following year (semi-annual acomptes in July and December)',
};
const DES: VatReturnDefinition = {
  key: 'FR-DES',
  name: 'Déclaration européenne de services (DES) / état récapitulatif des clients (livraisons intracommunautaires)',
  kind: 'ec_sales_list',
  periods: ['month'],
  boxes: [],
  filingChannel: 'pro.douane.gouv.fr (téléservices DES and état récapitulatif TVA / EMEBI)',
  filingUrl: 'https://pro.douane.gouv.fr',
  dueRule: 'Within 10 working days after the month in which the VAT became chargeable (art. 289 B CGI)',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'Guichet unique OSS (régime Union)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'impots.gouv.fr – espace professionnel (guichet unique OSS)',
  filingUrl: 'https://www.impots.gouv.fr/professionnel',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const FR_PROFILE: AccountingCountryProfile = {
  country: 'FR',
  name: 'France',
  defaultTemplate: 'FR-PCG',
  templates: ['FR-PCG'],
  vatReturns: [CA3, DES, OSS, CA12],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  cashBasis: CASH_BASIS,
  exports: ['fec', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [
    { env: 'BILLING_ISSUER_SIREN', label: 'SIREN (nom du fichier FEC SIRENFECAAAAMMJJ)', requiredFor: ['fec'] },
    { env: 'BILLING_ISSUER_TAX_NUMBER', label: 'Numéro de TVA intracommunautaire (optionnel)', requiredFor: [] },
  ],
  // Books and vouchers 10 years (art. L123-22 Code de commerce); the tax right of inspection covers 6 years (art.
  // L102 B LPF), so the longer commercial period applies.
  retention: { booksYears: 10, vouchersYears: 10 },
  defaultEinvoiceFormat: 'factur-x-en16931',
  complianceNotice:
    'Réforme de la facturation électronique : réception obligatoire via une plateforme agréée (PA) pour toutes les ' +
    'entreprises depuis le 1er septembre 2026, émission et e-reporting obligatoires depuis septembre 2026 (grandes ' +
    'entreprises et ETI) puis à partir de septembre 2027 (PME et micro-entreprises). Decabill génère des fichiers ' +
    "Factur-X mais n'est pas raccordé à une plateforme agréée : l'émission, la réception et l'e-reporting doivent " +
    "passer par une PA. L'obligation de logiciel de caisse certifié (art. 286 I 3° bis CGI, NF525) ne vise que les " +
    'encaissements auprès de particuliers enregistrés par un système de caisse ; Decabill ' +
    "n'est pas un logiciel de caisse.",
  mandatoryChart: true,
};
