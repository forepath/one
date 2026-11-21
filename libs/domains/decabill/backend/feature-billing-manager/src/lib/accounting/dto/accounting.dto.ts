import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  AccountingAccountRole,
  AccountingAccountType,
  JOURNAL_LINK_TYPES,
  JournalLinkRole,
  JournalLinkType,
  TaxCodeKind,
} from '../constants/accounting.constants';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AccountingViewQueryDto {
  /** Another tenant (global views only) or `all`. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  viewTenantId?: string;
}

export class AccountingDateRangeQueryDto extends AccountingViewQueryDto {
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to!: string;
}

/** Account ledger: date range plus paging (the global pipe forbids undeclared query properties). */
export class AccountLedgerQueryDto extends AccountingDateRangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}

export class AccountingPageQueryDto extends AccountingViewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}

export class JournalListQueryDto extends AccountingPageQueryDto {
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;

  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateChartDto {
  /** Template key (e.g. DE-SKR03); omit to start with an empty chart. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  templateKey?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-]{2,32}$/)
  code?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional()
  @IsNumber()
  @Min(3)
  @Max(8)
  accountLength?: number;
}

export class AccountDto {
  @Transform(trim)
  @Matches(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/)
  number!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsIn(Object.values(AccountingAccountType))
  type!: AccountingAccountType;

  @IsOptional()
  @IsIn([...Object.values(AccountingAccountRole), null])
  role?: AccountingAccountRole | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  statementPosition?: string | null;

  @IsOptional()
  @IsBoolean()
  isAutomatic?: boolean;

  @IsOptional()
  @IsUUID('4')
  defaultTaxCodeId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsObject()
  externalCodes?: Record<string, string> | null;
}

export class UpdateAccountDto {
  @IsOptional()
  @Transform(trim)
  @Matches(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/)
  number?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(Object.values(AccountingAccountType))
  type?: AccountingAccountType;

  @IsOptional()
  @IsIn([...Object.values(AccountingAccountRole), null])
  role?: AccountingAccountRole | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  statementPosition?: string | null;

  @IsOptional()
  @IsBoolean()
  isAutomatic?: boolean;

  @IsOptional()
  @IsUUID('4')
  defaultTaxCodeId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsObject()
  externalCodes?: Record<string, string> | null;
}

export class TaxCodeDto {
  @Matches(/^[A-Z0-9_]{2,32}$/)
  code!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsIn(Object.values(TaxCodeKind))
  kind!: TaxCodeKind;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rate?: number | null;

  @IsOptional()
  @IsUUID('4')
  accountId?: string | null;

  @IsOptional()
  @IsUUID('4')
  reverseAccountId?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,16}$/)
  baseBox?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,16}$/)
  taxBox?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,16}$/)
  reverseTaxBox?: string | null;

  @IsOptional()
  @IsBoolean()
  ecSalesList?: boolean;

  @IsOptional()
  @IsBoolean()
  oss?: boolean;

  @IsOptional()
  @Matches(/^\d{1,4}$/)
  datevBuKey?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTaxCodeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rate?: number | null;

  @IsOptional()
  @IsUUID('4')
  accountId?: string | null;

  @IsOptional()
  @IsUUID('4')
  reverseAccountId?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,16}$/)
  baseBox?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,16}$/)
  taxBox?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,16}$/)
  reverseTaxBox?: string | null;

  @IsOptional()
  @IsBoolean()
  ecSalesList?: boolean;

  @IsOptional()
  @IsBoolean()
  oss?: boolean;

  @IsOptional()
  @Matches(/^\d{1,4}$/)
  datevBuKey?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OpenFiscalYearDto {
  @IsOptional()
  @IsUUID('4')
  chartId?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  endDate?: string;
}

export class CloseFiscalYearDto {
  @IsOptional()
  @IsUUID('4')
  nextChartId?: string;

  /** Old account number → new account number (chart change at year rollover). */
  @IsOptional()
  @IsObject()
  accountMapping?: Record<string, string>;
}

export class ChangeYearChartDto {
  @IsUUID('4')
  chartId!: string;
}

export class JournalLinkDto {
  @IsIn(JOURNAL_LINK_TYPES)
  linkType!: JournalLinkType;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  targetId!: string;

  @IsOptional()
  @IsIn([JournalLinkRole.RECEIPT, JournalLinkRole.RELATED, JournalLinkRole.SETTLES])
  role?: JournalLinkRole;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}

export class ManualEntryLineDto {
  @Matches(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/)
  accountNumber!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;

  /** Tax code; the VAT line is split off automatically from the gross amount. */
  @IsOptional()
  @Matches(/^[A-Z0-9_]{2,32}$/)
  taxCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  costCenter?: string;
}

export class ManualEntryDto {
  @Matches(ISO_DATE)
  documentDate!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  documentNumber?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  /** Tenant dimension (defaults to the request tenant; other tenants only in global views). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantId?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualEntryLineDto)
  lines!: ManualEntryLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => JournalLinkDto)
  links?: JournalLinkDto[];
}

export class ReverseEntryDto {
  @IsOptional()
  @Matches(ISO_DATE)
  documentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class FxRateDto {
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Matches(ISO_DATE)
  rateDate!: string;

  @IsNumber()
  @IsPositive()
  rate!: number;
}

export class ComputeVatReturnDto {
  @IsString()
  @MaxLength(32)
  definitionKey!: string;

  @Matches(ISO_DATE)
  periodStart!: string;

  @Matches(ISO_DATE)
  periodEnd!: string;

  @IsOptional()
  @IsObject()
  manualValues?: Record<string, number>;
}

export class SubmitVatReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  filingReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class PayVatReturnDto {
  @Matches(ISO_DATE)
  date!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;
}

export class FinancialAccountDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsIn(['bank', 'cash', 'processor', 'other'])
  kind!: 'bank' | 'cash' | 'processor' | 'other';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() : value))
  @Matches(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, { message: 'Invalid IBAN' })
  iban?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/)
  bic?: string | null;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Matches(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/)
  ledgerAccountNumber!: string;

  @IsOptional()
  @IsIn(['stripe', 'paypal', 'mollie', 'adyen', null])
  processor?: string | null;

  /** Owning tenant; `null` = shared (global views only). Defaults to the request tenant. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BankImportUploadDto {
  @IsOptional()
  @IsUUID('4')
  financialAccountId?: string;

  @IsOptional()
  @IsIn([
    'camt.052',
    'camt.053',
    'camt.054',
    'mt940',
    'mt942',
    'coda',
    'norma43',
    'cfonb120',
    'cbi-rh',
    'bai2',
    'ofx',
    'qif',
    'csv',
  ])
  format?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  csvPreset?: string;

  @IsOptional()
  @IsUUID('4')
  csvMappingId?: string;

  @IsOptional()
  @IsIn(['auto', 'utf-8', 'windows-1252', 'iso-8859-1', 'cp850'])
  encoding?: 'auto' | 'utf-8' | 'windows-1252' | 'iso-8859-1' | 'cp850';

  @IsOptional()
  @IsIn(['DMY', 'MDY', 'auto'])
  qifDateFormat?: 'DMY' | 'MDY' | 'auto';
}

export class CsvMappingDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsObject()
  mapping!: Record<string, unknown>;
}

export class BankTransactionQueryDto extends AccountingPageQueryDto {
  @IsOptional()
  @IsUUID('4')
  financialAccountId?: string;

  @IsOptional()
  @IsIn(['unmatched', 'suggested', 'matched', 'booked', 'ignored', 'superseded'])
  matchStatus?: string;

  @IsOptional()
  @IsUUID('4')
  importId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class MatchTargetDto {
  @IsIn(['invoice', 'supplier_invoice', 'account'])
  type!: 'invoice' | 'supplier_invoice' | 'account';

  @IsOptional()
  @IsUUID('4')
  id?: string;

  /** Invoice / supplier invoice number (alternative to `id`; resolved within the bank account's tenant). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  number?: string;

  @IsOptional()
  @Matches(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/)
  accountNumber?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsOptional()
  @Matches(/^[A-Z0-9_]{2,32}$/)
  taxCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class MatchBankTransactionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MatchTargetDto)
  targets!: MatchTargetDto[];

  /** Remember the counterparty IBAN → customer / supplier / account. */
  @IsOptional()
  @IsBoolean()
  learn?: boolean;
}

export class MatchRuleDto {
  @IsIn(['iban', 'text'])
  kind!: 'iban' | 'text';

  @IsString()
  @MinLength(3)
  @MaxLength(128)
  pattern!: string;

  @IsIn(['customer', 'supplier', 'account'])
  targetType!: 'customer' | 'supplier' | 'account';

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  targetId!: string;

  @IsOptional()
  @Matches(/^[A-Z0-9_]{2,32}$/)
  taxCode?: string;
}

export class CreateAssetDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @Matches(ISO_DATE)
  acquisitionDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  acquisitionCost!: number;

  @IsOptional()
  @IsIn(['straight_line', 'immediate', 'pool'])
  method?: 'straight_line' | 'immediate' | 'pool';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1200)
  usefulLifeMonths?: number;

  @IsOptional()
  @Matches(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/)
  assetAccountNumber?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  residualValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class DisposeAssetDto {
  @Matches(ISO_DATE)
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class DepreciationRunDto {
  @Matches(/^\d{4}-\d{2}$/)
  through!: string;
}

export class AccountingExportQueryDto extends AccountingDateRangeQueryDto {
  @IsIn(['journal_csv', 'trial_balance_csv', 'gdpdu', 'fec', 'saft', 'xaf'])
  kind!: 'journal_csv' | 'trial_balance_csv' | 'gdpdu' | 'fec' | 'saft' | 'xaf';
}

export class OpenItemsQueryDto extends AccountingViewQueryDto {
  @IsIn(['customer', 'supplier'])
  type!: 'customer' | 'supplier';

  @IsOptional()
  @Matches(ISO_DATE)
  asOf?: string;
}

export class StatementQueryDto extends AccountingViewQueryDto {
  @IsIn(['balance_sheet', 'profit_and_loss', 'cash_basis'])
  kind!: 'balance_sheet' | 'profit_and_loss' | 'cash_basis';

  @Matches(ISO_DATE)
  from!: string;

  @Matches(ISO_DATE)
  to!: string;
}
