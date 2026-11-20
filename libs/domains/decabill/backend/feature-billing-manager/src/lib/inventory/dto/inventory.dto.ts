import {
  isValidGtin,
  normalizeGtin,
  parseSerialNumberInput,
  type SerialNumberInputErrorCode,
} from '@forepath/shared/shared/util-barcode';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

import { TaxCategory } from '../../constants/tax-category.constants';
import {
  INVENTORY_ARTICLE_UNITS,
  INVENTORY_LABEL_KINDS,
  INVENTORY_LABEL_LAYOUTS,
  INVENTORY_PUTAWAY_REASONS,
  INVENTORY_QUANTITY_MAX,
  INVENTORY_SERIALS_PER_MOVEMENT_MAX,
  INVENTORY_WITHDRAWAL_REASONS,
  InventoryLendingStatus,
  InventoryMovementReason,
  InventoryMovementType,
  InventorySerialUnitStatus,
  InventoryWithdrawalRequestSource,
  InventoryWithdrawalRequestStatus,
  type InventoryLabelKind,
  type InventoryLabelLayout,
} from '../constants/inventory.constants';

/** Trims strings; empty strings become null (clears optional fields). */
const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

/** GTIN-8 / UPC-A / EAN-13 / GTIN-14 with a valid check digit (spaces / dashes removed before validation). */
function IsGtin(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isGtin',
      target: object.constructor,
      propertyName,
      options: { message: 'EAN must be a valid GTIN-8, UPC-A, EAN-13 or GTIN-14 (check digit)', ...options },
      validator: { validate: (value: unknown) => typeof value === 'string' && isValidGtin(value) },
    });
}

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/;
const CODE_MESSAGE = 'Code may contain letters, digits, spaces, dot, dash, underscore and slash';

/** Positive stock quantity with at most three decimals. */
function IsInventoryQuantity() {
  return (object: object, propertyName: string) => {
    Type(() => Number)(object, propertyName);
    IsNumber({ maxDecimalPlaces: 3 }, { message: `${propertyName} must be a number with at most 3 decimals` })(
      object,
      propertyName,
    );
    Min(0.001, { message: `${propertyName} must be greater than zero` })(object, propertyName);
    Max(INVENTORY_QUANTITY_MAX)(object, propertyName);
  };
}

const SERIAL_ERROR_LABELS: Record<SerialNumberInputErrorCode, string> = {
  invalid: 'invalid serial number',
  'range-mismatch': 'range ends must differ only in their last number',
  'range-order': 'range must count upwards',
  'too-many': `more than ${INVENTORY_SERIALS_PER_MOVEMENT_MAX} serial numbers`,
  duplicate: 'listed twice',
};

/**
 * Serial numbers of a movement: single serial numbers and ranges (`SN-0001..SN-0050`), at most
 * {@link INVENTORY_SERIALS_PER_MOVEMENT_MAX} after expansion, none twice.
 */
function IsSerialNumberInput() {
  return (object: object, propertyName: string) => {
    IsOptional()(object, propertyName);
    IsArray()(object, propertyName);
    ArrayMaxSize(INVENTORY_SERIALS_PER_MOVEMENT_MAX)(object, propertyName);
    IsString({ each: true })(object, propertyName);
    MaxLength(300, { each: true })(object, propertyName);
    registerDecorator({
      name: 'isSerialNumberInput',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) =>
          !Array.isArray(value) ||
          (value.every((entry) => typeof entry === 'string') &&
            parseSerialNumberInput(value as string[], { max: INVENTORY_SERIALS_PER_MOVEMENT_MAX }).errors.length === 0),
        defaultMessage: (args) => {
          const errors = Array.isArray(args?.value)
            ? parseSerialNumberInput(args.value.map(String), { max: INVENTORY_SERIALS_PER_MOVEMENT_MAX }).errors
            : [];

          return `serialNumbers: ${errors
            .slice(0, 5)
            .map((error) => `${error.token.slice(0, 80)} (${SERIAL_ERROR_LABELS[error.code]})`)
            .join(', ')}`;
        },
      },
    });
  };
}

// ---- Warehouses ----

export class CreateInventoryWarehouseDto {
  @IsString()
  @Length(1, 32)
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code!: string;

  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  addressLine1?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(32)
  postalCode?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  city?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null))
  @ValidateIf((_, value) => value !== null)
  @Matches(/^[A-Z]{2}$/, { message: 'Country must be an ISO 3166-1 alpha-2 code' })
  country?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInventoryWarehouseDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  addressLine1?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(32)
  postalCode?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  city?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null))
  @ValidateIf((_, value) => value !== null)
  @Matches(/^[A-Z]{2}$/, { message: 'Country must be an ISO 3166-1 alpha-2 code' })
  country?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export interface InventoryWarehouseResponseDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
  compartmentCount: number;
  /** Distinct articles with stock in the warehouse. */
  articleCount: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Compartments ----

export class CreateInventoryCompartmentDto {
  @IsString()
  @Length(1, 64)
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code!: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  name?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInventoryCompartmentDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  name?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export interface InventoryCompartmentResponseDto {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  code: string;
  name: string | null;
  description: string | null;
  isActive: boolean;
  /** Articles with stock > 0. */
  articleCount: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Articles ----

class InventoryArticleFieldsDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? normalizeGtin(value) || null : value))
  @ValidateIf((_, value) => value !== null)
  @IsGtin()
  ean?: string | null;

  @IsOptional()
  @IsIn(INVENTORY_ARTICLE_UNITS as unknown as string[])
  unit?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  manufacturer?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(128)
  manufacturerPartNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  supplierId?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(128)
  supplierArticleNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99_999_999)
  purchasePriceNet?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99_999_999)
  salesPriceNet?: number | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'Currency must be an ISO 4217 code' })
  currency?: string;

  @IsOptional()
  @IsIn([TaxCategory.STANDARD, TaxCategory.REDUCED])
  taxCategory?: TaxCategory;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(INVENTORY_QUANTITY_MAX)
  reorderPoint?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(INVENTORY_QUANTITY_MAX)
  reorderQuantity?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99_999_999)
  weightKg?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  lengthCm?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  widthCm?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  heightCm?: number | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s.]/g, '') || null : value))
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{4,16}$/, { message: 'HS code must consist of 4 to 16 digits' })
  hsCode?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null))
  @ValidateIf((_, value) => value !== null)
  @Matches(/^[A-Z]{2}$/, { message: 'Country of origin must be an ISO 3166-1 alpha-2 code' })
  countryOfOrigin?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Units carry serial numbers; only switchable while the article has no stock and no open lendings. */
  @IsOptional()
  @IsBoolean()
  serialTracking?: boolean;
}

export class InventoryInitialPlacementDto {
  @IsUUID('4')
  compartmentId!: string;

  /** Quantity put away on create (putaway document); 0 maps the location only. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(INVENTORY_QUANTITY_MAX)
  quantity?: number;

  /** Serial numbers of the units put away (serial-tracked articles; singles and ranges). */
  @IsSerialNumberInput()
  serialNumbers?: string[];
}

export class CreateInventoryArticleDto extends InventoryArticleFieldsDto {
  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  /** Optional locations created together with the article (quantity > 0 books a putaway). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InventoryInitialPlacementDto)
  placements?: InventoryInitialPlacementDto[];
}

export class UpdateInventoryArticleDto extends InventoryArticleFieldsDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;
}

export interface InventoryArticleResponseDto {
  id: string;
  articleNumber: string;
  name: string;
  description: string | null;
  ean: string | null;
  unit: string;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  supplierId: string | null;
  supplierArticleNumber: string | null;
  purchasePriceNet: number | null;
  salesPriceNet: number | null;
  currency: string;
  taxCategory: TaxCategory;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  isActive: boolean;
  serialTracking: boolean;
  totalQuantity: number;
  /** Quantity on loan (open lendings); not part of `totalQuantity`. */
  lentQuantity: number;
  locationCount: number;
  /** Quantity of pending withdrawal requests. */
  requestedQuantity: number;
  /** Stock at or below the reorder point. */
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Stock placements ----

export class CreateInventoryPlacementDto {
  @IsUUID('4')
  articleId!: string;

  @IsUUID('4')
  compartmentId!: string;
}

export interface InventoryStockResponseDto {
  id: string;
  quantity: number;
  article: Pick<
    InventoryArticleResponseDto,
    'id' | 'articleNumber' | 'name' | 'ean' | 'unit' | 'isActive' | 'reorderPoint' | 'serialTracking'
  >;
  compartment: { id: string; code: string; name: string | null; isActive: boolean };
  warehouse: { id: string; code: string; name: string; isActive: boolean };
  updatedAt: string;
}

// ---- Movements ----

export class InventoryPutawayDto {
  @IsUUID('4')
  articleId!: string;

  @IsUUID('4')
  targetCompartmentId!: string;

  @IsInventoryQuantity()
  quantity!: number;

  /** Serial-tracked articles: the units moved (singles and ranges; their count must equal `quantity`). */
  @IsSerialNumberInput()
  serialNumbers?: string[];

  @IsOptional()
  @IsIn(INVENTORY_PUTAWAY_REASONS as unknown as string[])
  reason?: InventoryMovementReason;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  reference?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class InventoryTransferDto {
  @IsUUID('4')
  articleId!: string;

  @IsUUID('4')
  sourceCompartmentId!: string;

  @IsUUID('4')
  targetCompartmentId!: string;

  @IsInventoryQuantity()
  quantity!: number;

  /** Serial-tracked articles: the units moved (singles and ranges; their count must equal `quantity`). */
  @IsSerialNumberInput()
  serialNumbers?: string[];

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  reference?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class InventoryWithdrawalDto {
  @IsUUID('4')
  articleId!: string;

  @IsUUID('4')
  sourceCompartmentId!: string;

  @IsInventoryQuantity()
  quantity!: number;

  /** Serial-tracked articles: the units moved (singles and ranges; their count must equal `quantity`). */
  @IsSerialNumberInput()
  serialNumbers?: string[];

  /** Direct withdrawals cannot claim `fulfillment` (that reason belongs to accepted requests). */
  @IsOptional()
  @IsIn(INVENTORY_WITHDRAWAL_REASONS.filter((reason) => reason !== InventoryMovementReason.FULFILLMENT) as string[])
  reason?: InventoryMovementReason;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  reference?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export interface InventoryMovementResponseDto {
  id: string;
  type: InventoryMovementType;
  documentNumber: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  unit: string;
  quantity: number;
  reason: InventoryMovementReason | null;
  source: { warehouseCode: string; warehouseName: string; compartmentId: string; compartmentCode: string } | null;
  target: { warehouseCode: string; warehouseName: string; compartmentId: string; compartmentCode: string } | null;
  sourceQuantityAfter: number | null;
  targetQuantityAfter: number | null;
  reference: string | null;
  note: string | null;
  withdrawalRequestId: string | null;
  /** Serial numbers moved (empty for articles without serial tracking). */
  serialNumbers: string[];
  lendingId: string | null;
  lending: {
    documentNumber: string | null;
    borrowerName: string;
    borrowerKind: 'customer' | 'staff';
    dueDate: string | null;
  } | null;
  performedByEmail: string | null;
  hasPdf: boolean;
  createdAt: string;
}

// ---- Serial numbers ----

export interface InventorySerialUnitResponseDto {
  id: string;
  serialNumber: string;
  status: InventorySerialUnitStatus;
  article: Pick<InventoryArticleResponseDto, 'id' | 'articleNumber' | 'name'>;
  /** Where the unit is stored (`in_stock`). */
  location: { compartmentId: string; compartmentCode: string; warehouseCode: string; warehouseName: string } | null;
  /** Who has it (`lent`). */
  lending: {
    id: string;
    documentNumber: string | null;
    borrowerName: string;
    borrowerKind: 'customer' | 'staff';
    dueDate: string | null;
  } | null;
  updatedAt: string;
}

// ---- Lendings ----

export class CreateInventoryLendingDto {
  @IsUUID('4')
  articleId!: string;

  @IsUUID('4')
  sourceCompartmentId!: string;

  @IsInventoryQuantity()
  quantity!: number;

  @IsSerialNumberInput()
  serialNumbers?: string[];

  /** Borrower with an account (customer or staff); exactly one of `borrowerUserId` / `borrowerName`. */
  @IsOptional()
  @IsUUID('4')
  borrowerUserId?: string;

  /** Employee without an account (staff). */
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Length(1, 255)
  borrowerName?: string | null;

  /** Agreed return date (`YYYY-MM-DD`, today or later). */
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate must be a date (YYYY-MM-DD)' })
  dueDate?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  reference?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class ReturnInventoryLendingDto {
  @IsUUID('4')
  targetCompartmentId!: string;

  @IsInventoryQuantity()
  quantity!: number;

  /** Serial-tracked articles: the units coming back (a subset of the lent ones). */
  @IsSerialNumberInput()
  serialNumbers?: string[];

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  reference?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export interface InventoryLendingResponseDto {
  id: string;
  status: InventoryLendingStatus;
  /** Open and past its due date. */
  overdue: boolean;
  documentNumber: string | null;
  article: Pick<InventoryArticleResponseDto, 'id' | 'articleNumber' | 'name' | 'unit' | 'serialTracking'>;
  quantity: number;
  returnedQuantity: number;
  outstandingQuantity: number;
  borrower: {
    userId: string | null;
    name: string;
    email: string | null;
    customerNumber: string | null;
    kind: 'customer' | 'staff';
  };
  source: { compartmentId: string; compartmentCode: string; warehouseCode: string; warehouseName: string } | null;
  dueDate: string | null;
  note: string | null;
  /** Serial numbers still on loan. */
  outstandingSerialNumbers: string[];
  /** Lending and return documents, oldest first. */
  movementIds: string[];
  createdAt: string;
  returnedAt: string | null;
}

// ---- Labels ----

export class PrintInventoryLabelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INVENTORY_LABEL_KINDS.length)
  @ArrayUnique()
  @IsIn(INVENTORY_LABEL_KINDS as unknown as string[], { each: true })
  kinds!: InventoryLabelKind[];

  /** Articles (property stickers of serial-tracked articles: one per unit in stock or on loan). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  articleIds?: string[];

  /** Individual serial-tracked units (labels carry their serial number). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serialUnitIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  copies?: number;

  @IsOptional()
  @IsIn(INVENTORY_LABEL_LAYOUTS as unknown as string[])
  layout?: InventoryLabelLayout;
}

/** Owner on property stickers: the billing issuer (`BILLING_ISSUER_*`); `name` null when not configured. */
export interface InventoryLabelOwnerResponseDto {
  name: string | null;
  address: string | null;
  contact: string | null;
}

// ---- Withdrawal requests ----

export class InventoryRequestAllocationDto {
  @IsUUID('4')
  compartmentId!: string;

  @IsInventoryQuantity()
  quantity!: number;

  /** Serial-tracked articles: the units moved (singles and ranges; their count must equal `quantity`). */
  @IsSerialNumberInput()
  serialNumbers?: string[];
}

export class AcceptInventoryWithdrawalRequestDto {
  /** Source compartments and quantities; they must add up to the requested quantity. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InventoryRequestAllocationDto)
  allocations!: InventoryRequestAllocationDto[];

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class RejectInventoryWithdrawalRequestDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export interface InventoryWithdrawalRequestResponseDto {
  id: string;
  status: InventoryWithdrawalRequestStatus;
  sourceType: InventoryWithdrawalRequestSource;
  sourceLabel: string;
  quantity: number;
  article: Pick<InventoryArticleResponseDto, 'id' | 'articleNumber' | 'name' | 'ean' | 'unit' | 'serialTracking'>;
  /** On-hand total of the article right now (helps deciding). */
  availableQuantity: number;
  userId: string | null;
  customerEmail: string | null;
  offerId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  movementIds: string[];
  createdAt: string;
}

export interface InventorySummaryResponseDto {
  warehouseCount: number;
  compartmentCount: number;
  articleCount: number;
  lowStockArticleCount: number;
  pendingRequestCount: number;
  openLendingCount: number;
  /** Open lendings past their due date. */
  overdueLendingCount: number;
}

export interface PaginatedInventoryResponseDto<T> {
  items: T[];
  total: number;
}
