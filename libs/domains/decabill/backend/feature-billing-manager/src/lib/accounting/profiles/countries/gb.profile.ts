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
 * United Kingdom: no statutory chart of accounts. Curated chart in the customary (Sage-style) UK nominal-code ranges
 * (0xxx fixed assets, 1xxx current assets, 2xxx liabilities and VAT control accounts, 3xxx capital, 4xxx sales,
 * 5xxx direct costs, 7xxx–8xxx overheads, 99xx suspense / technical), oriented on the Companies Act 2006 formats
 * (SI 2008/409 small companies regulations, Schedule 1 format 1) as used by FRS 102 Section 1A / FRS 105.
 */

const u = undefined;
const ROWS: TemplateRow[] = [
  // Fixed assets
  ['0010', 'Software and website development', T.ASSET, 'BS.FA.int'],
  ['0030', 'Office and IT equipment', T.ASSET, 'BS.FA.tan', R.FIXED_ASSETS],
  ['0031', 'Low-value equipment (capitalised)', T.ASSET, 'BS.FA.tan', R.LOW_VALUE_ASSETS],
  ['0040', 'Fixtures and fittings (capital allowance pools are tax-only)', T.ASSET, 'BS.FA.tan', R.ASSET_POOL],
  // Current assets
  ['1001', 'Stock', T.ASSET, 'BS.CA.stock', R.INVENTORY],
  ['1100', 'Trade debtors', T.ASSET, 'BS.CA.debtors', R.RECEIVABLES],
  ['1200', 'Bank current account', T.ASSET, 'BS.CA.cash', R.BANK],
  ['1210', 'Payment processor clearing', T.ASSET, 'BS.CA.cash', R.PROCESSOR_CLEARING],
  ['1220', 'Transfers in transit', T.ASSET, 'BS.CA.cash', R.CASH_IN_TRANSIT],
  ['1230', 'Petty cash', T.ASSET, 'BS.CA.cash', R.CASH],
  // Liabilities and VAT control accounts
  ['2100', 'Trade creditors', T.LIABILITY, 'BS.CL.trade', R.PAYABLES],
  ['2110', 'Payments received on account (customer deposits)', T.LIABILITY, 'BS.CL.poa', R.CUSTOMER_PREPAYMENTS],
  ['2200', 'Output VAT – standard rate', T.LIABILITY, 'BS.CL.tax', R.VAT_OUTPUT_STANDARD, u, 'CB.I.vat'],
  ['2201', 'Input VAT – standard rate', T.ASSET, 'BS.CA.other', R.VAT_INPUT_STANDARD, u, 'CB.E.vat'],
  ['2202', 'VAT liability (HMRC control)', T.LIABILITY, 'BS.CL.tax', R.VAT_SETTLEMENT, u, 'CB.E.vat'],
  ['2203', 'Output VAT – reduced rate', T.LIABILITY, 'BS.CL.tax', R.VAT_OUTPUT_REDUCED, u, 'CB.I.vat'],
  ['2204', 'Output VAT – reverse charge', T.LIABILITY, 'BS.CL.tax', R.VAT_OUTPUT_REVERSE_CHARGE, u, 'CB.I.vat'],
  ['2205', 'Input VAT – reduced rate', T.ASSET, 'BS.CA.other', R.VAT_INPUT_REDUCED, u, 'CB.E.vat'],
  ['2206', 'Input VAT – reverse charge', T.ASSET, 'BS.CA.other', R.VAT_INPUT_REVERSE_CHARGE, u, 'CB.E.vat'],
  ['2207', 'VAT payments on account', T.LIABILITY, 'BS.CL.tax', R.VAT_PREPAYMENTS, u, 'CB.E.vat'],
  // Capital and reserves
  ['3000', 'Share capital / capital account', T.EQUITY, 'BS.CR.share'],
  ['3050', 'Drawings', T.EQUITY, 'BS.CR.owner', R.OWNER_DRAWINGS],
  ['3060', 'Capital introduced', T.EQUITY, 'BS.CR.owner', R.OWNER_CONTRIBUTIONS],
  ['3200', 'Profit and loss account (retained earnings)', T.EQUITY, 'BS.CR.pl', R.RETAINED_EARNINGS],
  ['3210', 'Current year earnings', T.EQUITY, 'BS.CR.pl', R.ANNUAL_RESULT],
  // Sales
  ['4000', 'Sales – standard rated', T.REVENUE, 'PL.turnover', R.REVENUE_STANDARD, C.OUT_STANDARD, 'CB.I.turnover'],
  ['4001', 'Sales – reduced rate', T.REVENUE, 'PL.turnover', R.REVENUE_REDUCED, C.OUT_REDUCED, 'CB.I.turnover'],
  [
    '4002',
    'Sales – zero-rated (incl. exports of goods)',
    T.REVENUE,
    'PL.turnover',
    R.REVENUE_TAX_FREE,
    C.OUT_ZERO,
    'CB.I.turnover',
  ],
  [
    '4003',
    'Services to EU business customers (outside the scope of UK VAT)',
    T.REVENUE,
    'PL.turnover',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    'CB.I.turnover',
  ],
  [
    '4004',
    'Services to customers outside the UK and EU (outside the scope)',
    T.REVENUE,
    'PL.turnover',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    'CB.I.turnover',
  ],
  ['4005', 'Other outside-the-scope sales', T.REVENUE, 'PL.turnover', u, C.OUT_NON_TAXABLE, 'CB.I.turnover'],
  ['4009', 'Discounts allowed', T.REVENUE, 'PL.turnover', R.CASH_DISCOUNTS_GRANTED, u, 'CB.I.turnover'],
  ['4010', 'Sales returns and allowances', T.REVENUE, 'PL.turnover', R.REVENUE_REDUCTIONS, u, 'CB.I.turnover'],
  ['4900', 'Profit on disposal of fixed assets', T.REVENUE, 'PL.otherinc', R.ASSET_DISPOSAL_GAIN, u, 'CB.I.other'],
  ['4910', 'Exchange gains', T.REVENUE, 'PL.otherinc', R.FX_GAIN, u, 'CB.I.other'],
  // Cost of sales
  ['5000', 'Cost of sales – goods', T.EXPENSE, 'PL.cos', R.COST_OF_GOODS_SOLD, u, 'CB.E.goods'],
  ['5001', 'Purchases – standard rated', T.EXPENSE, 'PL.cos', u, C.IN_STANDARD, 'CB.E.goods'],
  ['5002', 'Purchases – reduced rate', T.EXPENSE, 'PL.cos', u, C.IN_REDUCED, 'CB.E.goods'],
  ['5009', 'Discounts received', T.EXPENSE, 'PL.cos', R.CASH_DISCOUNTS_RECEIVED, u, 'CB.E.goods'],
  ['5100', 'Subcontractors and contracted services', T.EXPENSE, 'PL.cos', R.EXPENSE_DEFAULT, u, 'CB.E.services'],
  [
    '5101',
    'Services from EU suppliers (reverse charge)',
    T.EXPENSE,
    'PL.cos',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    'CB.E.services',
  ],
  [
    '5102',
    'Services from other overseas suppliers (reverse charge)',
    T.EXPENSE,
    'PL.cos',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    'CB.E.services',
  ],
  // Overheads
  ['7500', 'Telephone and internet', T.EXPENSE, 'PL.admin', u, u, 'CB.E.office'],
  ['7510', 'Software subscriptions', T.EXPENSE, 'PL.admin', u, u, 'CB.E.office'],
  ['7900', 'Bank charges and payment processing fees', T.EXPENSE, 'PL.admin', R.PAYMENT_FEES, u, 'CB.E.finance'],
  ['8000', 'Depreciation', T.EXPENSE, 'PL.admin', R.DEPRECIATION, u, 'CB.E.capital'],
  ['8100', 'Bad debts written off', T.EXPENSE, 'PL.admin', R.BAD_DEBT, u, 'CB.E.other'],
  ['8200', 'Loss on disposal of fixed assets', T.EXPENSE, 'PL.admin', R.ASSET_DISPOSAL_LOSS, u, 'CB.E.other'],
  ['8300', 'Exchange losses', T.EXPENSE, 'PL.admin', R.FX_LOSS, u, 'CB.E.other'],
  ['8310', 'Rounding differences', T.EXPENSE, 'PL.admin', R.ROUNDING, u, 'CB.E.other'],
  // Control accounts
  ['9998', 'Suspense account', T.ASSET, 'BS.CA.other', R.SUSPENSE],
  ['9990', 'Opening balances (technical)', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['9991', 'Opening balances – debtors', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['9992', 'Opening balances – creditors', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/** VAT100 boxes 1–9 (Making Tax Digital). */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'Standard rate 20 %',
    kind: K.OUTPUT,
    rate: 20,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '6',
    taxBox: '1',
  },
  {
    code: C.OUT_REDUCED,
    name: 'Reduced rate 5 %',
    kind: K.OUTPUT,
    rate: 5,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '6',
    taxBox: '1',
  },
  { code: C.OUT_ZERO, name: 'Zero rate (incl. exports of goods)', kind: K.EXEMPT, rate: 0, baseBox: '6' },
  // Outside-the-scope services to customers outside the UK belong in box 6 (VAT Notice 700/12); no EC Sales List.
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Services to EU business customers (outside the scope, reported in box 6)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '6',
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Services supplied outside the UK (outside the scope, reported in box 6)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '6',
  },
  { code: C.OUT_NON_TAXABLE, name: 'Outside the scope of UK VAT (not reported)', kind: K.EXEMPT, rate: 0 },
  {
    code: C.IN_STANDARD,
    name: 'Input VAT 20 %',
    kind: K.INPUT,
    rate: 20,
    accountRole: R.VAT_INPUT_STANDARD,
    baseBox: '7',
    taxBox: '4',
  },
  {
    code: C.IN_REDUCED,
    name: 'Input VAT 5 %',
    kind: K.INPUT,
    rate: 5,
    accountRole: R.VAT_INPUT_REDUCED,
    baseBox: '7',
    taxBox: '4',
  },
  {
    code: C.IN_NONE,
    name: 'No VAT (exempt / zero-rated / outside the scope purchases)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '7',
  },
  {
    code: C.RC_EU_SERVICES,
    name: 'Reverse charge – services from EU suppliers 20 %',
    kind: K.REVERSE_CHARGE,
    rate: 20,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '7',
    taxBox: '1',
    reverseTaxBox: '4',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Reverse charge – services from other overseas suppliers 20 %',
    kind: K.REVERSE_CHARGE,
    rate: 20,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '7',
    taxBox: '1',
    reverseTaxBox: '4',
  },
];

export const GB_FRS_TEMPLATE: ChartTemplate = {
  key: 'GB-FRS',
  country: 'GB',
  name: 'UK nominal ledger (FRS 102 / FRS 105)',
  description:
    'Curated UK chart of accounts in customary nominal-code ranges for FRS 102 Section 1A / FRS 105 accounts and VAT100.',
  accountLength: 4,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Decabill chart (the UK has no statutory chart); numbering follows the common Sage 50 default ranges (1100 ' +
    'debtors control, 1200 bank, 2100 creditors control, 2200/2201/2202 VAT control accounts, 4000 sales, 9998 ' +
    'suspense). Statements follow the Companies Act 2006 formats (SI 2008/409 Schedule 1 format 1) as used by FRS ' +
    '102 Section 1A (small entities). VAT100 boxes per HMRC VAT Notice 700/12; reverse-charge (international) ' +
    'services received must be included in box 1, box 4, box 6 (value of the deemed supply) and box 7 — Decabill ' +
    'maps the base to box 7 only, add it to box 6 manually. Boxes 2, 8 and 9 apply to Northern Ireland goods ' +
    'movements with the EU only (manual). No EC Sales List / OSS post-Brexit (except Northern Ireland goods under ' +
    'the Windsor Framework, not modelled).',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'GB-FRS102-1A-BS',
  name: 'Balance sheet (Companies Act 2006, SI 2008/409 Sch. 1 format 1; FRS 102 Section 1A)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.FA',
      label: 'Fixed assets',
      children: [
        { code: 'BS.FA.int', label: 'Intangible assets' },
        { code: 'BS.FA.tan', label: 'Tangible assets' },
        { code: 'BS.FA.inv', label: 'Investments' },
      ],
    },
    {
      code: 'BS.CA',
      label: 'Current assets',
      children: [
        { code: 'BS.CA.stock', label: 'Stocks' },
        { code: 'BS.CA.debtors', label: 'Debtors – trade debtors' },
        { code: 'BS.CA.other', label: 'Debtors – other debtors, prepayments and accrued income' },
        { code: 'BS.CA.cash', label: 'Cash at bank and in hand' },
      ],
    },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.CL',
      label: 'Creditors: amounts falling due within one year',
      children: [
        { code: 'BS.CL.trade', label: 'Trade creditors' },
        { code: 'BS.CL.poa', label: 'Payments received on account' },
        { code: 'BS.CL.tax', label: 'Taxation and social security' },
        { code: 'BS.CL.other', label: 'Other creditors, accruals and deferred income' },
      ],
    },
    { code: 'BS.LT', label: 'Creditors: amounts falling due after more than one year' },
    { code: 'BS.PROV', label: 'Provisions for liabilities' },
    {
      code: 'BS.CR',
      label: 'Capital and reserves',
      children: [
        { code: 'BS.CR.share', label: 'Called up share capital / capital account' },
        { code: 'BS.CR.pl', label: 'Profit and loss account' },
        { code: 'BS.CR.owner', label: "Owner's current account (sole traders / partnerships)" },
      ],
    },
  ],
  resultPosition: 'BS.CR.pl',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'GB-FRS102-1A-PL',
  name: 'Profit and loss account (Companies Act 2006, SI 2008/409 Sch. 1 format 1; FRS 102 Section 1A)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.turnover', label: 'Turnover', sign: 1 },
    { code: 'PL.cos', label: 'Cost of sales', sign: -1 },
    { code: 'PL.distribution', label: 'Distribution costs', sign: -1 },
    { code: 'PL.admin', label: 'Administrative expenses', sign: -1 },
    { code: 'PL.otherinc', label: 'Other operating income', sign: 1 },
    { code: 'PL.intrec', label: 'Interest receivable and similar income', sign: 1 },
    { code: 'PL.intpay', label: 'Interest payable and similar expenses', sign: -1 },
    { code: 'PL.tax', label: 'Tax on profit', sign: -1 },
  ],
};
const CASH_BASIS: StatementLayout = {
  key: 'GB-CASH-BASIS',
  name: 'Cash basis (self-employment, SA103)',
  kind: 'cash_basis',
  lines: [
    {
      code: 'CB.I',
      label: 'Business income',
      sign: 1,
      children: [
        { code: 'CB.I.turnover', label: 'Turnover (takings, fees, sales)', sign: 1 },
        { code: 'CB.I.other', label: 'Other business income', sign: 1 },
        { code: 'CB.I.vat', label: 'VAT received (when VAT-inclusive figures are used)', sign: 1 },
      ],
    },
    {
      code: 'CB.E',
      label: 'Allowable expenses',
      sign: -1,
      children: [
        { code: 'CB.E.goods', label: 'Cost of goods bought for resale or goods used', sign: -1 },
        { code: 'CB.E.services', label: 'Payments to subcontractors and contracted services', sign: -1 },
        { code: 'CB.E.office', label: 'Phone, fax, stationery and other office costs', sign: -1 },
        { code: 'CB.E.finance', label: 'Bank, credit card and other financial charges', sign: -1 },
        { code: 'CB.E.capital', label: 'Equipment and capital expenditure (cash basis)', sign: -1 },
        { code: 'CB.E.other', label: 'Other allowable business expenses', sign: -1 },
        { code: 'CB.E.vat', label: 'VAT paid (when VAT-inclusive figures are used)', sign: -1 },
      ],
    },
  ],
};
const VAT100: VatReturnDefinition = {
  key: 'UK-VAT100',
  name: 'VAT return (VAT100, Making Tax Digital)',
  kind: 'periodic',
  periods: ['quarter', 'month'],
  boxes: [
    { box: '1', label: 'Box 1 – VAT due on sales and other outputs', kind: 'tax' },
    {
      box: '2',
      label: 'Box 2 – VAT due on acquisitions of goods from EU member states (Northern Ireland only)',
      kind: 'manual',
    },
    { box: '3', label: 'Box 3 – Total VAT due', kind: 'computed', formula: '1 + 2' },
    { box: '4', label: 'Box 4 – VAT reclaimed on purchases and other inputs', kind: 'tax' },
    { box: '5', label: 'Box 5 – Net VAT to pay to HMRC or reclaim', kind: 'computed', formula: '1 + 2 - 4' },
    {
      box: '6',
      label: 'Box 6 – Total value of sales and all other outputs excluding VAT',
      kind: 'base',
      roundDown: true,
    },
    {
      box: '7',
      label: 'Box 7 – Total value of purchases and all other inputs excluding VAT',
      kind: 'base',
      roundDown: true,
    },
    {
      box: '8',
      label: 'Box 8 – Total value of supplies of goods to EU member states (Northern Ireland only)',
      kind: 'manual',
    },
    {
      box: '9',
      label: 'Box 9 – Total value of acquisitions of goods from EU member states (Northern Ireland only)',
      kind: 'manual',
    },
  ],
  resultBox: '5',
  filingChannel: 'MTD-compatible software via the HMRC VAT API (Decabill does not submit)',
  filingUrl: 'https://www.gov.uk/submit-vat-return',
  // Boxes 6–9 are submitted in whole pounds through the MTD VAT API.
  dueRule: '1 calendar month and 7 days after the end of the period (return and cleared payment)',
};

export const GB_PROFILE: AccountingCountryProfile = {
  country: 'GB',
  name: 'United Kingdom',
  defaultTemplate: 'GB-FRS',
  templates: ['GB-FRS'],
  vatReturns: [VAT100],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  cashBasis: CASH_BASIS,
  exports: ['journal_csv', 'trial_balance_csv'],
  prerequisites: [{ env: 'BILLING_ISSUER_TAX_NUMBER', label: 'VAT registration number', requiredFor: ['UK-VAT100'] }],
  // VAT records 6 years (VAT Notice 700/21); companies must keep accounting records 3 (private) / 6 (public) years
  // (Companies Act 2006 s. 388), corporation-tax records 6 years — 6 years covers all.
  retention: { booksYears: 6, vouchersYears: 6 },
  defaultEinvoiceFormat: 'ubl-en16931',
  complianceNotice:
    'VAT returns must be submitted with MTD-compatible software through the HMRC API. Decabill computes the VAT100 ' +
    'boxes but does not submit them; use bridging software or an accountant.',
  mandatoryChart: false,
};
