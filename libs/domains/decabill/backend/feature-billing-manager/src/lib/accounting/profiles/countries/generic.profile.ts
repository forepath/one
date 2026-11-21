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

import { buildAccounts, type TemplateRow } from './template-rows';

/**
 * Generic fallback for countries without a national profile: IFRS for SMEs oriented chart (Sections 4/5), a
 * generic VAT summary per canonical tax code and SAF-T grouping codes. Rates come from the invoice lines.
 */

const u = undefined;
const ROWS: TemplateRow[] = [
  // Current assets
  ['1000', 'Cash on hand', T.ASSET, 'BS.CA.cash', R.CASH],
  ['1010', 'Bank', T.ASSET, 'BS.CA.cash', R.BANK],
  ['1020', 'Payment processor clearing', T.ASSET, 'BS.CA.cash', R.PROCESSOR_CLEARING],
  ['1030', 'Cash in transit', T.ASSET, 'BS.CA.cash', R.CASH_IN_TRANSIT],
  ['1100', 'Trade receivables', T.ASSET, 'BS.CA.trade', R.RECEIVABLES],
  ['1190', 'Suspense / clearing account', T.ASSET, 'BS.CA.trade', R.SUSPENSE],
  ['1200', 'Inventories – goods for resale', T.ASSET, 'BS.CA.inv', R.INVENTORY],
  ['1300', 'Input VAT – standard rate', T.ASSET, 'BS.CA.tax', R.VAT_INPUT_STANDARD, u, 'CB.E.vat'],
  ['1310', 'Input VAT – reduced rates', T.ASSET, 'BS.CA.tax', R.VAT_INPUT_REDUCED, u, 'CB.E.vat'],
  ['1320', 'Input VAT – reverse charge', T.ASSET, 'BS.CA.tax', R.VAT_INPUT_REVERSE_CHARGE, u, 'CB.E.vat'],
  ['1330', 'VAT prepayments', T.ASSET, 'BS.CA.tax', R.VAT_PREPAYMENTS, u, 'CB.E.vatpaid'],
  // Non-current assets
  ['1500', 'Intangible assets (software, licences)', T.ASSET, 'BS.NCA.int'],
  ['1600', 'Property, plant and equipment – office and IT equipment', T.ASSET, 'BS.NCA.ppe', R.FIXED_ASSETS],
  ['1610', 'Property, plant and equipment – low-value items', T.ASSET, 'BS.NCA.ppe', R.LOW_VALUE_ASSETS],
  [
    '1620',
    'Property, plant and equipment – other (asset pool where local tax law has one)',
    T.ASSET,
    'BS.NCA.ppe',
    R.ASSET_POOL,
  ],
  // Liabilities
  ['2000', 'Trade payables', T.LIABILITY, 'BS.CL.trade', R.PAYABLES],
  ['2100', 'Contract liabilities – customer prepayments', T.LIABILITY, 'BS.CL.contract', R.CUSTOMER_PREPAYMENTS],
  ['2200', 'Output VAT – standard rate', T.LIABILITY, 'BS.CL.tax', R.VAT_OUTPUT_STANDARD, u, 'CB.I.vat'],
  ['2210', 'Output VAT – reduced rates', T.LIABILITY, 'BS.CL.tax', R.VAT_OUTPUT_REDUCED, u, 'CB.I.vat'],
  ['2220', 'Output VAT – reverse charge', T.LIABILITY, 'BS.CL.tax', R.VAT_OUTPUT_REVERSE_CHARGE, u, 'CB.I.vat'],
  ['2230', 'Output VAT – OSS (other EU member states)', T.LIABILITY, 'BS.CL.tax', R.VAT_OUTPUT_OSS, u, 'CB.I.vat'],
  ['2290', 'VAT settlement', T.LIABILITY, 'BS.CL.tax', R.VAT_SETTLEMENT, u, 'CB.E.vatpaid'],
  // Equity
  ['3000', "Share capital / owner's capital", T.EQUITY, 'BS.EQ.cap'],
  ['3100', 'Owner drawings', T.EQUITY, 'BS.EQ.owner', R.OWNER_DRAWINGS],
  ['3110', 'Owner contributions', T.EQUITY, 'BS.EQ.owner', R.OWNER_CONTRIBUTIONS],
  ['3200', 'Retained earnings', T.EQUITY, 'BS.EQ.re', R.RETAINED_EARNINGS],
  ['3300', 'Profit or loss for the year', T.EQUITY, 'BS.EQ.py', R.ANNUAL_RESULT],
  // Revenue
  ['4000', 'Revenue – standard rate', T.REVENUE, 'PL.rev', R.REVENUE_STANDARD, C.OUT_STANDARD, 'CB.I.sales'],
  ['4010', 'Revenue – reduced rate', T.REVENUE, 'PL.rev', R.REVENUE_REDUCED, C.OUT_REDUCED, 'CB.I.sales'],
  ['4015', 'Revenue – second reduced rate', T.REVENUE, 'PL.rev', u, C.OUT_REDUCED_2, 'CB.I.sales'],
  [
    '4020',
    'Revenue – zero-rated / exempt with input VAT credit',
    T.REVENUE,
    'PL.rev',
    R.REVENUE_TAX_FREE,
    C.OUT_ZERO,
    'CB.I.sales',
  ],
  [
    '4030',
    'Revenue – EU B2B services (reverse charge)',
    T.REVENUE,
    'PL.rev',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    'CB.I.sales',
  ],
  ['4040', 'Revenue – EU B2C services (OSS)', T.REVENUE, 'PL.rev', R.REVENUE_OSS, u, 'CB.I.sales'],
  [
    '4050',
    'Revenue – services to other countries',
    T.REVENUE,
    'PL.rev',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    'CB.I.sales',
  ],
  ['4060', 'Revenue – not taxable (other)', T.REVENUE, 'PL.rev', u, C.OUT_NON_TAXABLE, 'CB.I.sales'],
  ['4090', 'Sales returns, rebates and allowances', T.REVENUE, 'PL.rev', R.REVENUE_REDUCTIONS, u, 'CB.I.sales'],
  ['4095', 'Cash discounts granted', T.REVENUE, 'PL.rev', R.CASH_DISCOUNTS_GRANTED, u, 'CB.I.sales'],
  ['4500', 'Gain on disposal of non-current assets', T.REVENUE, 'PL.oi', R.ASSET_DISPOSAL_GAIN, u, 'CB.I.other'],
  ['4510', 'Foreign exchange gains', T.REVENUE, 'PL.oi', R.FX_GAIN, u, 'CB.I.other'],
  // Expenses
  ['5000', 'Cost of goods sold', T.EXPENSE, 'PL.mat', R.COST_OF_GOODS_SOLD, u, 'CB.E.goods'],
  ['5010', 'Purchases – standard rate', T.EXPENSE, 'PL.mat', u, C.IN_STANDARD, 'CB.E.goods'],
  ['5020', 'Purchases – reduced rate', T.EXPENSE, 'PL.mat', u, C.IN_REDUCED, 'CB.E.goods'],
  ['5090', 'Cash discounts received', T.EXPENSE, 'PL.mat', R.CASH_DISCOUNTS_RECEIVED, u, 'CB.E.goods'],
  ['6000', 'Purchased services', T.EXPENSE, 'PL.oe', R.EXPENSE_DEFAULT, u, 'CB.E.services'],
  [
    '6010',
    'Purchased services – EU suppliers (reverse charge)',
    T.EXPENSE,
    'PL.oe',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    'CB.E.services',
  ],
  [
    '6020',
    'Purchased services – other foreign suppliers (reverse charge)',
    T.EXPENSE,
    'PL.oe',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    'CB.E.services',
  ],
  ['6100', 'Telecommunications and internet', T.EXPENSE, 'PL.oe', u, u, 'CB.E.other'],
  ['6200', 'Bank and payment fees', T.EXPENSE, 'PL.oe', R.PAYMENT_FEES, u, 'CB.E.other'],
  ['6300', 'Impairment of trade receivables (bad debts)', T.EXPENSE, 'PL.oe', R.BAD_DEBT, u, 'CB.E.other'],
  ['6400', 'Loss on disposal of non-current assets', T.EXPENSE, 'PL.oe', R.ASSET_DISPOSAL_LOSS, u, 'CB.E.other'],
  ['6500', 'Foreign exchange losses', T.EXPENSE, 'PL.oe', R.FX_LOSS, u, 'CB.E.other'],
  ['6590', 'Rounding differences', T.EXPENSE, 'PL.oe', R.ROUNDING, u, 'CB.E.other'],
  ['7000', 'Depreciation and amortisation', T.EXPENSE, 'PL.dep', R.DEPRECIATION, u, 'CB.E.capital'],
  // Technical
  ['9990', 'Opening balances (technical)', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9991', 'Opening balances – receivables', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9992', 'Opening balances – payables', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
const SAFT_CATEGORY: Partial<Record<T, string>> = {
  [T.ASSET]: 'Assets',
  [T.LIABILITY]: 'Liabilities',
  [T.EQUITY]: 'Equity',
  [T.REVENUE]: 'Income',
  [T.EXPENSE]: 'Expenses',
};

/** Adds SAF-T grouping (category by account type, code = IFRS for SMEs statement line). */
function withSaftGrouping(accounts: ChartTemplateAccount[]): ChartTemplateAccount[] {
  return accounts.map((account) => {
    const category = SAFT_CATEGORY[account.type];

    if (!category || !account.statementPosition) {
      return account;
    }

    return {
      ...account,
      externalCodes: {
        ...(account.externalCodes ?? {}),
        saftGroupingCategory: category,
        saftGroupingCode: account.statementPosition,
      },
    };
  });
}

/** Generic VAT summary: one base / tax box per canonical tax code family. Rates come from the document lines. */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'Output VAT – standard rate',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: 'STD_BASE',
    taxBox: 'STD_TAX',
  },
  {
    code: C.OUT_REDUCED,
    name: 'Output VAT – reduced rate',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: 'RED_BASE',
    taxBox: 'RED_TAX',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'Output VAT – second reduced rate',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: 'RED2_BASE',
    taxBox: 'RED2_TAX',
  },
  {
    code: C.OUT_ZERO,
    name: 'Zero-rated / exempt with credit (exports, intra-EU goods)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'ZERO_BASE',
  },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'EU B2B services, customer accounts for VAT',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'EURC_BASE',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'OSS: VAT due in another EU member state',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    baseBox: 'OSS_BASE',
    taxBox: 'OSS_TAX',
    oss: true,
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Services supplied abroad (outside the scope)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: 'EXP_BASE',
  },
  { code: C.OUT_NON_TAXABLE, name: 'Not taxable (other)', kind: K.EXEMPT, rate: 0, baseBox: 'NONTAX_BASE' },
  {
    code: C.IN_STANDARD,
    name: 'Input VAT – standard rate',
    kind: K.INPUT,
    rate: null,
    accountRole: R.VAT_INPUT_STANDARD,
    baseBox: 'IN_BASE',
    taxBox: 'IN_TAX',
  },
  {
    code: C.IN_REDUCED,
    name: 'Input VAT – reduced rate',
    kind: K.INPUT,
    rate: null,
    accountRole: R.VAT_INPUT_REDUCED,
    baseBox: 'IN_BASE',
    taxBox: 'IN_TAX',
  },
  { code: C.IN_NONE, name: 'No input VAT', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: 'Reverse charge – services from EU suppliers',
    kind: K.REVERSE_CHARGE,
    rate: null,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: 'RC_BASE',
    taxBox: 'RC_TAX',
    reverseTaxBox: 'RC_INPUT',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Reverse charge – services from other foreign suppliers',
    kind: K.REVERSE_CHARGE,
    rate: null,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: 'RC_BASE',
    taxBox: 'RC_TAX',
    reverseTaxBox: 'RC_INPUT',
  },
];

export const GENERIC_IFRS_TEMPLATE: ChartTemplate = {
  key: 'GENERIC-IFRS',
  country: null,
  name: 'Generic chart (IFRS for SMEs)',
  description: 'Country-neutral chart oriented on IFRS for SMEs Sections 4 and 5, with SAF-T grouping codes.',
  accountLength: 4,
  accounts: withSaftGrouping(buildAccounts(ROWS)),
  taxCodes: TAX_CODES,
  source:
    'Decabill generic chart oriented on IFRS for SMEs (Section 4 statement of financial position, Section 5 ' +
    'statement of comprehensive income by nature). SAF-T grouping category/code are Decabill-defined (type and ' +
    'statement line), not a national SAF-T grouping list. Tax rates are taken from the document lines.',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'GENERIC-IFRS-SFP',
  name: 'Statement of financial position (IFRS for SMEs, Section 4)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.NCA',
      label: 'Non-current assets',
      children: [
        { code: 'BS.NCA.ppe', label: 'Property, plant and equipment' },
        { code: 'BS.NCA.int', label: 'Intangible assets other than goodwill' },
        { code: 'BS.NCA.fin', label: 'Financial assets' },
      ],
    },
    {
      code: 'BS.CA',
      label: 'Current assets',
      children: [
        { code: 'BS.CA.inv', label: 'Inventories' },
        { code: 'BS.CA.trade', label: 'Trade and other receivables' },
        { code: 'BS.CA.tax', label: 'Current tax assets (incl. recoverable VAT)' },
        { code: 'BS.CA.cash', label: 'Cash and cash equivalents' },
      ],
    },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.EQ',
      label: 'Equity',
      children: [
        { code: 'BS.EQ.cap', label: "Share capital / owner's capital" },
        { code: 'BS.EQ.re', label: 'Retained earnings' },
        { code: 'BS.EQ.py', label: 'Profit or loss for the year' },
        { code: 'BS.EQ.owner', label: "Owner's current account" },
      ],
    },
    { code: 'BS.NCL', label: 'Non-current liabilities' },
    {
      code: 'BS.CL',
      label: 'Current liabilities',
      children: [
        { code: 'BS.CL.trade', label: 'Trade and other payables' },
        { code: 'BS.CL.contract', label: 'Contract liabilities (customer prepayments)' },
        { code: 'BS.CL.tax', label: 'Current tax liabilities (incl. VAT payable)' },
        { code: 'BS.CL.prov', label: 'Provisions' },
      ],
    },
  ],
  resultPosition: 'BS.EQ.py',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'GENERIC-IFRS-SCI',
  name: 'Statement of comprehensive income by nature (IFRS for SMEs, Section 5)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.rev', label: 'Revenue', sign: 1 },
    { code: 'PL.oi', label: 'Other income', sign: 1 },
    { code: 'PL.mat', label: 'Raw materials, goods and consumables used', sign: -1 },
    { code: 'PL.emp', label: 'Employee benefits expense', sign: -1 },
    { code: 'PL.dep', label: 'Depreciation and amortisation expense', sign: -1 },
    { code: 'PL.oe', label: 'Other expenses', sign: -1 },
    { code: 'PL.fi', label: 'Finance income', sign: 1 },
    { code: 'PL.fc', label: 'Finance costs', sign: -1 },
    { code: 'PL.tax', label: 'Income tax expense', sign: -1 },
  ],
};
const CASH_BASIS: StatementLayout = {
  key: 'GENERIC-CASH',
  name: 'Cash-basis income statement',
  kind: 'cash_basis',
  lines: [
    {
      code: 'CB.I',
      label: 'Receipts',
      sign: 1,
      children: [
        { code: 'CB.I.sales', label: 'Sales receipts', sign: 1 },
        { code: 'CB.I.other', label: 'Other receipts', sign: 1 },
        { code: 'CB.I.vat', label: 'VAT collected', sign: 1 },
      ],
    },
    {
      code: 'CB.E',
      label: 'Payments',
      sign: -1,
      children: [
        { code: 'CB.E.goods', label: 'Goods and materials', sign: -1 },
        { code: 'CB.E.services', label: 'Purchased services', sign: -1 },
        { code: 'CB.E.capital', label: 'Capital expenditure / depreciation', sign: -1 },
        { code: 'CB.E.other', label: 'Other expenses', sign: -1 },
        { code: 'CB.E.vat', label: 'Input VAT paid', sign: -1 },
        { code: 'CB.E.vatpaid', label: 'VAT paid to the tax authority', sign: -1 },
      ],
    },
  ],
};
const VAT_SUMMARY: VatReturnDefinition = {
  key: 'GENERIC-VAT',
  name: 'VAT summary (generic, per canonical tax code)',
  kind: 'periodic',
  periods: ['month', 'quarter', 'year'],
  boxes: [
    { box: 'STD_BASE', label: 'Standard rate – taxable base', kind: 'base' },
    { box: 'STD_TAX', label: 'Standard rate – output VAT', kind: 'tax' },
    { box: 'RED_BASE', label: 'Reduced rate – taxable base', kind: 'base' },
    { box: 'RED_TAX', label: 'Reduced rate – output VAT', kind: 'tax' },
    { box: 'RED2_BASE', label: 'Second reduced rate – taxable base', kind: 'base' },
    { box: 'RED2_TAX', label: 'Second reduced rate – output VAT', kind: 'tax' },
    { box: 'ZERO_BASE', label: 'Zero-rated / exempt with credit – value', kind: 'base' },
    { box: 'EURC_BASE', label: 'EU B2B services (reverse charge by customer) – value', kind: 'base' },
    { box: 'OSS_BASE', label: 'OSS supplies – value (reported in the OSS return)', kind: 'base' },
    { box: 'OSS_TAX', label: 'OSS supplies – VAT (reported in the OSS return)', kind: 'tax' },
    { box: 'EXP_BASE', label: 'Services supplied abroad – value', kind: 'base' },
    { box: 'NONTAX_BASE', label: 'Not taxable (other) – value', kind: 'base' },
    { box: 'IN_BASE', label: 'Purchases – base', kind: 'base' },
    { box: 'IN_TAX', label: 'Input VAT', kind: 'tax' },
    { box: 'RC_BASE', label: 'Reverse-charge purchases – base', kind: 'base' },
    { box: 'RC_TAX', label: 'Reverse-charge VAT due', kind: 'tax' },
    { box: 'RC_INPUT', label: 'Reverse-charge VAT deductible', kind: 'tax' },
    {
      box: 'PAYABLE',
      label: 'VAT payable (+) / refundable (−)',
      kind: 'computed',
      formula: 'STD_TAX + RED_TAX + RED2_TAX + RC_TAX - IN_TAX - RC_INPUT',
    },
  ],
  resultBox: 'PAYABLE',
  filingChannel: 'National tax authority portal (manual transfer of the figures)',
  dueRule: 'Per national rules',
};
const ESL: VatReturnDefinition = {
  key: 'GENERIC-ESL',
  name: 'EC sales list (EU member states)',
  kind: 'ec_sales_list',
  periods: ['month', 'quarter'],
  boxes: [],
  filingChannel: 'National tax authority portal',
  dueRule: 'Per national rules (EU: monthly or quarterly)',
};
const OSS: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'OSS return (Union scheme)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'OSS portal of the member state of identification',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const GENERIC_PROFILE: AccountingCountryProfile = {
  country: '*',
  name: 'Generic (IFRS for SMEs)',
  defaultTemplate: 'GENERIC-IFRS',
  templates: ['GENERIC-IFRS'],
  vatReturns: [VAT_SUMMARY, ESL, OSS],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  cashBasis: CASH_BASIS,
  exports: ['saft', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [],
  retention: { booksYears: 10, vouchersYears: 10 },
  defaultEinvoiceFormat: 'ubl-en16931',
  complianceNotice: 'Generic bookkeeping aid; not certified for statutory filing in this country.',
  mandatoryChart: false,
};
