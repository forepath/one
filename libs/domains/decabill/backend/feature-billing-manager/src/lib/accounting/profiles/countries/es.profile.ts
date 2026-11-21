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
 * Spain: curated subset of the Plan General de Contabilidad (PGC, RD 1514/2007) and PGC PYMES (RD 1515/2007).
 * Parts 1–3 (marco conceptual, normas de registro y valoración, cuentas anuales) are binding; the numbering and
 * names of the cuadro de cuentas (part 4) are not (art. 3.1 RD 1515/2007, art. 2 RD 1514/2007), but the PGC
 * numbering is universal practice. 6-digit sub-accounts by Decabill.
 */

const u = undefined;
/** Custom template code: entregas intracomunitarias exentas (casilla 59 + modelo 349). */
const OUT_ICL = 'OUT_ICL';
const ROWS: TemplateRow[] = [
  // Grupo 2 – Activo no corriente
  ['206000', 'Aplicaciones informáticas', T.ASSET, 'BS.ANC.I'],
  ['216000', 'Mobiliario', T.ASSET, 'BS.ANC.II'],
  ['217000', 'Equipos para procesos de información', T.ASSET, 'BS.ANC.II', R.FIXED_ASSETS],
  ['219000', 'Otro inmovilizado material (sin pool fiscal en España)', T.ASSET, 'BS.ANC.II', R.ASSET_POOL],
  ['219100', 'Otro inmovilizado material – bienes de escaso valor', T.ASSET, 'BS.ANC.II', R.LOW_VALUE_ASSETS],
  // Grupo 3 – Existencias
  ['300000', 'Mercaderías', T.ASSET, 'BS.AC.I', R.INVENTORY],
  // Grupo 4 – Acreedores y deudores
  ['430000', 'Clientes', T.ASSET, 'BS.AC.II.1', R.RECEIVABLES],
  ['440000', 'Deudores – entidades de pago (pasarelas de cobro)', T.ASSET, 'BS.AC.II.3', R.PROCESSOR_CLEARING],
  ['470000', 'Hacienda Pública, deudora por IVA', T.ASSET, 'BS.AC.II.3', R.VAT_PREPAYMENTS],
  ['472021', 'Hacienda Pública, IVA soportado 21 %', T.ASSET, 'BS.AC.II.3', R.VAT_INPUT_STANDARD],
  [
    '472010',
    'Hacienda Pública, IVA soportado tipos reducidos (10 % / 4 %)',
    T.ASSET,
    'BS.AC.II.3',
    R.VAT_INPUT_REDUCED,
  ],
  [
    '472099',
    'Hacienda Pública, IVA soportado – inversión del sujeto pasivo',
    T.ASSET,
    'BS.AC.II.3',
    R.VAT_INPUT_REVERSE_CHARGE,
  ],
  ['400000', 'Proveedores', T.LIABILITY, 'BS.PC.IV.1', R.PAYABLES],
  ['438000', 'Anticipos de clientes', T.LIABILITY, 'BS.PC.IV.2', R.CUSTOMER_PREPAYMENTS],
  ['475000', 'Hacienda Pública, acreedora por IVA', T.LIABILITY, 'BS.PC.IV.2', R.VAT_SETTLEMENT],
  ['477021', 'Hacienda Pública, IVA repercutido 21 %', T.LIABILITY, 'BS.PC.IV.2', R.VAT_OUTPUT_STANDARD],
  [
    '477010',
    'Hacienda Pública, IVA repercutido tipos reducidos (10 % / 4 %)',
    T.LIABILITY,
    'BS.PC.IV.2',
    R.VAT_OUTPUT_REDUCED,
  ],
  [
    '477099',
    'Hacienda Pública, IVA repercutido – inversión del sujeto pasivo',
    T.LIABILITY,
    'BS.PC.IV.2',
    R.VAT_OUTPUT_REVERSE_CHARGE,
  ],
  [
    '477900',
    'IVA devengado en otros Estados miembros (ventanilla única OSS)',
    T.LIABILITY,
    'BS.PC.IV.2',
    R.VAT_OUTPUT_OSS,
  ],
  // Grupo 5 – Cuentas financieras
  ['555000', 'Partidas pendientes de aplicación', T.ASSET, 'BS.AC.II.3', R.SUSPENSE],
  ['570000', 'Caja, euros', T.ASSET, 'BS.AC.VI', R.CASH],
  ['572000', 'Bancos e instituciones de crédito c/c vista, euros', T.ASSET, 'BS.AC.VI', R.BANK],
  ['572900', 'Bancos – traspasos en tránsito', T.ASSET, 'BS.AC.VI', R.CASH_IN_TRANSIT],
  // Grupo 1 – Financiación básica
  ['100000', 'Capital social', T.EQUITY, 'BS.PN.I'],
  ['113000', 'Reservas voluntarias', T.EQUITY, 'BS.PN.III'],
  ['120000', 'Remanente', T.EQUITY, 'BS.PN.V', R.RETAINED_EARNINGS],
  ['121000', 'Resultados negativos de ejercicios anteriores', T.EQUITY, 'BS.PN.V'],
  ['129000', 'Resultado del ejercicio', T.EQUITY, 'BS.PN.VII', R.ANNUAL_RESULT],
  ['550001', 'Titular de la explotación – retiradas', T.EQUITY, 'BS.PN.TIT', R.OWNER_DRAWINGS],
  ['550002', 'Titular de la explotación – aportaciones', T.EQUITY, 'BS.PN.TIT', R.OWNER_CONTRIBUTIONS],
  // Grupo 7 – Ventas e ingresos
  [
    '705021',
    'Prestaciones de servicios – IVA 21 %',
    T.REVENUE,
    'PL.1',
    R.REVENUE_STANDARD,
    C.OUT_STANDARD,
    'ED.I.ventas',
  ],
  [
    '705010',
    'Prestaciones de servicios – IVA 10 %',
    T.REVENUE,
    'PL.1',
    R.REVENUE_REDUCED,
    C.OUT_REDUCED,
    'ED.I.ventas',
  ],
  ['705004', 'Prestaciones de servicios – IVA 4 %', T.REVENUE, 'PL.1', u, C.OUT_REDUCED_2, 'ED.I.ventas'],
  [
    '700100',
    'Ventas de mercaderías – exportaciones (exentas)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_TAX_FREE,
    C.OUT_ZERO,
    'ED.I.ventas',
  ],
  [
    '700200',
    'Ventas de mercaderías – entregas intracomunitarias (exentas)',
    T.REVENUE,
    'PL.1',
    u,
    OUT_ICL,
    'ED.I.ventas',
  ],
  [
    '705100',
    'Prestaciones de servicios intracomunitarias (inversión del sujeto pasivo)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_EU_REVERSE_CHARGE,
    C.OUT_EU_REVERSE_CHARGE,
    'ED.I.ventas',
  ],
  [
    '705200',
    'Prestaciones de servicios a consumidores de la UE (ventanilla única OSS)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_OSS,
    u,
    'ED.I.ventas',
  ],
  [
    '705300',
    'Prestaciones de servicios a países terceros (no sujetas)',
    T.REVENUE,
    'PL.1',
    R.REVENUE_THIRD_COUNTRY,
    C.OUT_EXPORT_SERVICES,
    'ED.I.ventas',
  ],
  [
    '705400',
    'Otras operaciones no sujetas (reglas de localización)',
    T.REVENUE,
    'PL.1',
    u,
    C.OUT_NON_TAXABLE,
    'ED.I.ventas',
  ],
  ['706000', 'Descuentos sobre ventas por pronto pago', T.REVENUE, 'PL.1', R.CASH_DISCOUNTS_GRANTED, u, 'ED.I.ventas'],
  [
    '708000',
    'Devoluciones de ventas y operaciones similares',
    T.REVENUE,
    'PL.1',
    R.REVENUE_REDUCTIONS,
    u,
    'ED.I.ventas',
  ],
  ['768000', 'Diferencias positivas de cambio', T.REVENUE, 'PL.15', R.FX_GAIN, u, 'ED.I.otros'],
  [
    '771000',
    'Beneficios procedentes del inmovilizado material',
    T.REVENUE,
    'PL.11',
    R.ASSET_DISPOSAL_GAIN,
    u,
    'ED.I.otros',
  ],
  // Grupo 6 – Compras y gastos
  ['600021', 'Compras de mercaderías – IVA 21 %', T.EXPENSE, 'PL.4', u, C.IN_STANDARD, 'ED.G.consumos'],
  ['600010', 'Compras de mercaderías – tipos reducidos', T.EXPENSE, 'PL.4', u, C.IN_REDUCED, 'ED.G.consumos'],
  [
    '606000',
    'Descuentos sobre compras por pronto pago',
    T.EXPENSE,
    'PL.4',
    R.CASH_DISCOUNTS_RECEIVED,
    u,
    'ED.G.consumos',
  ],
  ['610000', 'Variación de existencias de mercaderías', T.EXPENSE, 'PL.4', R.COST_OF_GOODS_SOLD, u, 'ED.G.consumos'],
  ['623000', 'Servicios de profesionales independientes', T.EXPENSE, 'PL.7', u, u, 'ED.G.servext'],
  ['626000', 'Servicios bancarios y similares', T.EXPENSE, 'PL.7', R.PAYMENT_FEES, u, 'ED.G.servext'],
  ['629000', 'Otros servicios', T.EXPENSE, 'PL.7', R.EXPENSE_DEFAULT, u, 'ED.G.servext'],
  [
    '629100',
    'Servicios de proveedores de la UE (inversión del sujeto pasivo)',
    T.EXPENSE,
    'PL.7',
    R.EXPENSE_REVERSE_CHARGE_EU,
    C.RC_EU_SERVICES,
    'ED.G.servext',
  ],
  [
    '629200',
    'Servicios de proveedores de países terceros (inversión del sujeto pasivo)',
    T.EXPENSE,
    'PL.7',
    R.EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY,
    C.RC_THIRD_COUNTRY,
    'ED.G.servext',
  ],
  ['650000', 'Pérdidas de créditos comerciales incobrables', T.EXPENSE, 'PL.7', R.BAD_DEBT, u, 'ED.G.otros'],
  ['659000', 'Otras pérdidas en gestión corriente (redondeos)', T.EXPENSE, 'PL.7', R.ROUNDING, u, 'ED.G.otros'],
  ['668000', 'Diferencias negativas de cambio', T.EXPENSE, 'PL.15', R.FX_LOSS, u, 'ED.G.financ'],
  [
    '671000',
    'Pérdidas procedentes del inmovilizado material',
    T.EXPENSE,
    'PL.11',
    R.ASSET_DISPOSAL_LOSS,
    u,
    'ED.G.otros',
  ],
  ['681000', 'Amortización del inmovilizado material', T.EXPENSE, 'PL.8', R.DEPRECIATION, u, 'ED.G.amort'],
  // Cuentas técnicas (fuera del PGC)
  ['000000', 'Asiento de apertura (cuenta técnica)', T.STATISTICAL, 'STAT', R.OPENING_BALANCE],
  ['000001', 'Asiento de apertura – clientes', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_RECEIVABLES],
  ['000002', 'Asiento de apertura – proveedores', T.STATISTICAL, 'STAT', R.OPENING_BALANCE_PAYABLES],
];
/** Modelo 303 casillas (instrucciones 2026). */
const TAX_CODES: ChartTemplateTaxCode[] = [
  {
    code: C.OUT_STANDARD,
    name: 'IVA repercutido 21 %',
    kind: K.OUTPUT,
    rate: 21,
    accountRole: R.VAT_OUTPUT_STANDARD,
    baseBox: '07',
    taxBox: '09',
  },
  {
    code: C.OUT_REDUCED,
    name: 'IVA repercutido 10 %',
    kind: K.OUTPUT,
    rate: 10,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '04',
    taxBox: '06',
  },
  {
    code: C.OUT_REDUCED_2,
    name: 'IVA repercutido 4 %',
    kind: K.OUTPUT,
    rate: 4,
    accountRole: R.VAT_OUTPUT_REDUCED,
    baseBox: '01',
    taxBox: '03',
  },
  {
    code: C.OUT_ZERO,
    name: 'Exportaciones y operaciones asimiladas (exentas)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '60',
  },
  {
    code: OUT_ICL,
    name: 'Entregas intracomunitarias de bienes exentas',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '59',
    ecSalesList: true,
  },
  {
    code: C.OUT_EU_REVERSE_CHARGE,
    name: 'Prestaciones de servicios intracomunitarias (inversión del sujeto pasivo)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '59',
    ecSalesList: true,
  },
  {
    code: C.OUT_OSS,
    name: 'Ventanilla única: operaciones no sujetas por localización (OSS)',
    kind: K.OUTPUT,
    rate: null,
    accountRole: R.VAT_OUTPUT_OSS,
    baseBox: '123',
    oss: true,
  },
  {
    code: C.OUT_EXPORT_SERVICES,
    name: 'Prestaciones a países terceros no sujetas (reglas de localización)',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '120',
  },
  {
    code: C.OUT_NON_TAXABLE,
    name: 'Otras operaciones no sujetas por reglas de localización',
    kind: K.EXEMPT,
    rate: 0,
    baseBox: '120',
  },
  {
    code: C.IN_STANDARD,
    name: 'IVA soportado deducible 21 %',
    kind: K.INPUT,
    rate: 21,
    accountRole: R.VAT_INPUT_STANDARD,
    baseBox: '28',
    taxBox: '29',
  },
  {
    code: C.IN_REDUCED,
    name: 'IVA soportado deducible 10 %',
    kind: K.INPUT,
    rate: 10,
    accountRole: R.VAT_INPUT_REDUCED,
    baseBox: '28',
    taxBox: '29',
  },
  { code: C.IN_NONE, name: 'Sin IVA soportado deducible', kind: K.EXEMPT, rate: 0 },
  {
    code: C.RC_EU_SERVICES,
    name: 'Adquisiciones intracomunitarias de servicios (ISP) 21 %',
    kind: K.REVERSE_CHARGE,
    rate: 21,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '10',
    taxBox: '11',
    reverseTaxBox: '37',
  },
  {
    code: C.RC_THIRD_COUNTRY,
    name: 'Otras operaciones con inversión del sujeto pasivo (servicios de países terceros) 21 %',
    kind: K.REVERSE_CHARGE,
    rate: 21,
    accountRole: R.VAT_INPUT_REVERSE_CHARGE,
    reverseAccountRole: R.VAT_OUTPUT_REVERSE_CHARGE,
    baseBox: '12',
    taxBox: '13',
    reverseTaxBox: '29',
  },
];

export const ES_PGC_TEMPLATE: ChartTemplate = {
  key: 'ES-PGC',
  country: 'ES',
  name: 'Plan General de Contabilidad (PGC / PGC PYMES)',
  description:
    'Plan General de Contabilidad español – grupos 1 a 7, subcuentas de 6 dígitos (modelos de cuentas PYMES).',
  accountLength: 6,
  accounts: buildAccounts(ROWS),
  taxCodes: TAX_CODES,
  source:
    'Curated subset of the PGC (RD 1514/2007) / PGC PYMES (RD 1515/2007, consolidated text 2025); 6-digit ' +
    'sub-accounts and labels by Decabill; 000000–000002 are technical opening accounts outside the PGC. Statement ' +
    'positions follow the PYMES balance / cuenta de pérdidas y ganancias models. Modelo 303 casillas per the AEAT ' +
    '2026 instructions (01–15, 27–46, 59, 60, 120, 123, 78, 70, 71; 69 = 66 + 77 − 78 + 68 + 108, ' +
    '71 = 69 − 70 + 109); Decabill simplifies to 71 = 46 − 78 − 70 (régimen general only, territorio común, no ' +
    'prorrata, no 77/68/108/109). ' +
    'Casilla 36 is mirrored from casilla 10; unverified: whether third-country ISP bases must also be added to ' +
    'casilla 28 (only the cuota is mapped to 29). The modelo 390 uses its own casilla numbering; the annual summary ' +
    'shows 303 ids. 470000 (HP deudora por IVA) holds the VAT-prepayments role as Spain has no VAT prepayments.',
};

const BALANCE_SHEET: StatementLayout = {
  key: 'ES-PYMES-BALANCE',
  name: 'Balance de PYMES (PGC PYMES, RD 1515/2007, tercera parte)',
  kind: 'balance_sheet',
  assets: [
    {
      code: 'BS.ANC',
      label: 'A) Activo no corriente',
      children: [
        { code: 'BS.ANC.I', label: 'I. Inmovilizado intangible' },
        { code: 'BS.ANC.II', label: 'II. Inmovilizado material' },
        { code: 'BS.ANC.V', label: 'V. Inversiones financieras a largo plazo' },
      ],
    },
    {
      code: 'BS.AC',
      label: 'B) Activo corriente',
      children: [
        { code: 'BS.AC.I', label: 'I. Existencias' },
        {
          code: 'BS.AC.II',
          label: 'II. Deudores comerciales y otras cuentas a cobrar',
          children: [
            { code: 'BS.AC.II.1', label: '1. Clientes por ventas y prestaciones de servicios' },
            { code: 'BS.AC.II.3', label: '3. Otros deudores' },
          ],
        },
        { code: 'BS.AC.IV', label: 'IV. Inversiones financieras a corto plazo' },
        { code: 'BS.AC.V', label: 'V. Periodificaciones a corto plazo' },
        { code: 'BS.AC.VI', label: 'VI. Efectivo y otros activos líquidos equivalentes' },
      ],
    },
  ],
  equityAndLiabilities: [
    {
      code: 'BS.PN',
      label: 'A) Patrimonio neto – A-1) Fondos propios',
      children: [
        { code: 'BS.PN.I', label: 'I. Capital' },
        { code: 'BS.PN.III', label: 'III. Reservas' },
        { code: 'BS.PN.V', label: 'V. Resultados de ejercicios anteriores' },
        { code: 'BS.PN.VII', label: 'VII. Resultado del ejercicio' },
        { code: 'BS.PN.TIT', label: 'Titular de la explotación (empresarios individuales, cta. 550)' },
      ],
    },
    { code: 'BS.PNC', label: 'B) Pasivo no corriente' },
    {
      code: 'BS.PC',
      label: 'C) Pasivo corriente',
      children: [
        { code: 'BS.PC.II', label: 'II. Deudas a corto plazo' },
        {
          code: 'BS.PC.IV',
          label: 'IV. Acreedores comerciales y otras cuentas a pagar',
          children: [
            { code: 'BS.PC.IV.1', label: '1. Proveedores' },
            { code: 'BS.PC.IV.2', label: '2. Otros acreedores' },
          ],
        },
        { code: 'BS.PC.V', label: 'V. Periodificaciones a corto plazo' },
      ],
    },
  ],
  resultPosition: 'BS.PN.VII',
};
const PROFIT_AND_LOSS: StatementLayout = {
  key: 'ES-PYMES-PYG',
  name: 'Cuenta de pérdidas y ganancias de PYMES (PGC PYMES, RD 1515/2007, tercera parte)',
  kind: 'profit_and_loss',
  lines: [
    { code: 'PL.1', label: '1. Importe neto de la cifra de negocios', sign: 1 },
    { code: 'PL.2', label: '2. Variación de existencias de productos terminados y en curso de fabricación', sign: 1 },
    { code: 'PL.4', label: '4. Aprovisionamientos', sign: -1 },
    { code: 'PL.5', label: '5. Otros ingresos de explotación', sign: 1 },
    { code: 'PL.6', label: '6. Gastos de personal', sign: -1 },
    { code: 'PL.7', label: '7. Otros gastos de explotación', sign: -1 },
    { code: 'PL.8', label: '8. Amortización del inmovilizado', sign: -1 },
    { code: 'PL.11', label: '11. Deterioro y resultado por enajenaciones del inmovilizado', sign: 1 },
    { code: 'PL.12', label: '12. Ingresos financieros', sign: 1 },
    { code: 'PL.13', label: '13. Gastos financieros', sign: -1 },
    { code: 'PL.15', label: '15. Diferencias de cambio', sign: 1 },
    { code: 'PL.17', label: '17. Impuestos sobre beneficios', sign: -1 },
  ],
};
const CASH_BASIS: StatementLayout = {
  key: 'ES-EDS',
  name: 'Rendimiento de actividades económicas – estimación directa simplificada (criterio de caja, art. 7.2 RIRPF)',
  kind: 'cash_basis',
  lines: [
    {
      code: 'ED.I',
      label: 'Ingresos',
      sign: 1,
      children: [
        { code: 'ED.I.ventas', label: 'Importe neto de la cifra de negocios', sign: 1 },
        { code: 'ED.I.otros', label: 'Otros ingresos', sign: 1 },
      ],
    },
    {
      code: 'ED.G',
      label: 'Gastos fiscalmente deducibles',
      sign: -1,
      children: [
        { code: 'ED.G.consumos', label: 'Consumos de explotación', sign: -1 },
        { code: 'ED.G.servext', label: 'Otros servicios exteriores', sign: -1 },
        { code: 'ED.G.financ', label: 'Gastos financieros', sign: -1 },
        { code: 'ED.G.amort', label: 'Dotaciones para amortización del inmovilizado', sign: -1 },
        { code: 'ED.G.otros', label: 'Otros gastos fiscalmente deducibles', sign: -1 },
      ],
    },
  ],
};
const DEVENGADO = '03 + 06 + 09 + 11 + 13 + 15';
const DEDUCIBLE = '29 + 31 + 37 + 41';
const RESULT = `${DEVENGADO} - ${DEDUCIBLE.replace(/ \+ /g, ' - ')}`;
const M303: VatReturnDefinition = {
  key: 'ES-303',
  name: 'Modelo 303 – IVA autoliquidación',
  kind: 'periodic',
  periods: ['quarter', 'month'],
  boxes: [
    { box: '01', label: 'Régimen general 4 % – base imponible', kind: 'base' },
    { box: '03', label: 'Régimen general 4 % – cuota', kind: 'tax' },
    { box: '04', label: 'Régimen general 10 % – base imponible', kind: 'base' },
    { box: '06', label: 'Régimen general 10 % – cuota', kind: 'tax' },
    { box: '07', label: 'Régimen general 21 % – base imponible', kind: 'base' },
    { box: '09', label: 'Régimen general 21 % – cuota', kind: 'tax' },
    { box: '10', label: 'Adquisiciones intracomunitarias de bienes y servicios – base', kind: 'base' },
    { box: '11', label: 'Adquisiciones intracomunitarias de bienes y servicios – cuota', kind: 'tax' },
    { box: '12', label: 'Otras operaciones con inversión del sujeto pasivo – base', kind: 'base' },
    { box: '13', label: 'Otras operaciones con inversión del sujeto pasivo – cuota', kind: 'tax' },
    { box: '14', label: 'Modificación de bases', kind: 'manual' },
    { box: '15', label: 'Modificación de cuotas', kind: 'manual' },
    { box: '27', label: 'Total cuota devengada', kind: 'computed', formula: DEVENGADO },
    { box: '28', label: 'Por cuotas soportadas en operaciones interiores corrientes – base', kind: 'base' },
    { box: '29', label: 'Por cuotas soportadas en operaciones interiores corrientes – cuota', kind: 'tax' },
    {
      box: '31',
      label: 'Por cuotas soportadas en operaciones interiores con bienes de inversión – cuota',
      kind: 'manual',
    },
    {
      box: '36',
      label: 'En adquisiciones intracomunitarias de bienes y servicios corrientes – base',
      kind: 'computed',
      formula: '10',
    },
    { box: '37', label: 'En adquisiciones intracomunitarias de bienes y servicios corrientes – cuota', kind: 'tax' },
    { box: '41', label: 'Rectificación de deducciones – cuota', kind: 'manual' },
    { box: '45', label: 'Total a deducir', kind: 'computed', formula: DEDUCIBLE },
    { box: '46', label: 'Resultado régimen general', kind: 'computed', formula: RESULT },
    { box: '59', label: 'Entregas intracomunitarias de bienes y prestaciones de servicios', kind: 'base' },
    { box: '60', label: 'Exportaciones y operaciones asimiladas', kind: 'base' },
    { box: '120', label: 'Operaciones no sujetas por reglas de localización (excepto casilla 123)', kind: 'base' },
    {
      box: '123',
      label: 'Operaciones no sujetas por reglas de localización acogidas a ventanilla única',
      kind: 'base',
    },
    { box: '78', label: 'Cuotas a compensar de periodos anteriores aplicadas en este periodo', kind: 'manual' },
    { box: '70', label: 'A deducir (autoliquidación complementaria)', kind: 'manual' },
    { box: '71', label: 'Resultado de la liquidación', kind: 'computed', formula: `${RESULT} - 78 - 70` },
  ],
  resultBox: '71',
  filingChannel: 'AEAT – Sede electrónica (certificado electrónico / Cl@ve)',
  filingUrl: 'https://sede.agenciatributaria.gob.es',
  dueRule:
    '1st–20th of the month after the quarter (Q4: 1–30 January); monthly filers (REDEME / large companies) 1st–30th ' +
    'of the following month (January: end of February; December: 30 January)',
};
const M390: VatReturnDefinition = {
  ...M303,
  key: 'ES-390',
  name: 'Modelo 390 – resumen anual de IVA (casillas en formato 303)',
  kind: 'annual',
  periods: ['year'],
  dueRule: '1–30 January of the following year (not required for SII filers)',
};
const M349: VatReturnDefinition = {
  key: 'ES-349',
  name: 'Modelo 349 – declaración recapitulativa de operaciones intracomunitarias',
  kind: 'ec_sales_list',
  periods: ['month', 'quarter'],
  boxes: [],
  filingChannel: 'AEAT – Sede electrónica',
  filingUrl: 'https://sede.agenciatributaria.gob.es',
  // Quarterly only when intra-EU supplies stayed ≤ 50 000 € in the quarter and the previous four quarters.
  dueRule: '1st–20th of the month after the period (Q4 / December: 1–30 January)',
};
const M369: VatReturnDefinition = {
  key: 'EU-OSS',
  name: 'Modelo 369 – ventanilla única (régimen de la Unión)',
  kind: 'oss',
  periods: ['quarter'],
  boxes: [],
  filingChannel: 'AEAT – Sede electrónica',
  filingUrl: 'https://sede.agenciatributaria.gob.es',
  dueRule: 'End of the month after the quarter; payment must arrive by the same date',
};

export const ES_PROFILE: AccountingCountryProfile = {
  country: 'ES',
  name: 'España',
  defaultTemplate: 'ES-PGC',
  templates: ['ES-PGC'],
  vatReturns: [M303, M349, M369, M390],
  balanceSheet: BALANCE_SHEET,
  profitAndLoss: PROFIT_AND_LOSS,
  cashBasis: CASH_BASIS,
  exports: ['saft', 'journal_csv', 'trial_balance_csv'],
  prerequisites: [{ env: 'BILLING_ISSUER_TAX_NUMBER', label: 'NIF', requiredFor: ['ES-303', 'ES-390', 'ES-349'] }],
  // 6 years (art. 30 Código de Comercio); the tax limitation period is 4 years (art. 66 LGT).
  retention: { booksYears: 6, vouchersYears: 6 },
  defaultEinvoiceFormat: 'ubl-en16931',
  complianceNotice:
    'No implementado: Suministro Inmediato de Información (SII, obligatorio para grandes empresas, REDEME y grupos ' +
    'de IVA), sistemas informáticos de facturación certificados VERI*FACTU (RD 1007/2023; obligatorio desde 2027), ' +
    'TicketBAI / Batuz en el País Vasco y la futura factura electrónica B2B obligatoria (Ley Crea y Crece). ' +
    'Decabill no es un SIF certificado.',
  // Numbering and names of the PGC accounts are not binding (art. 3.1 RD 1515/2007, art. 2 RD 1514/2007).
  mandatoryChart: false,
};
