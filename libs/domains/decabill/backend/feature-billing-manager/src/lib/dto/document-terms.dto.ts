import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  DELIVERY_TERMS_PLACE_MAX_LENGTH,
  DELIVERY_TERMS_TEXT_MAX_LENGTH,
  DeliveryTermsCode,
  PAYMENT_DUE_DAYS_MAX,
} from '../constants/document-terms.constants';
import {
  deliveryTermsFromColumns,
  type DocumentTermsFields,
  type ResolvedDocumentTerms,
  toDocumentTermsColumns,
} from '../utils/document-terms.utils';

/**
 * Delivery terms input. `deliveryTermsCode` null/omitted inherits (service plan → global default).
 * Incoterms rules take an optional named place; `CUSTOM` requires `deliveryTermsText`.
 */
export class DeliveryTermsInputDto {
  @IsOptional()
  @IsEnum(DeliveryTermsCode, { message: 'deliveryTermsCode must be an Incoterms® 2020 rule or CUSTOM' })
  deliveryTermsCode?: DeliveryTermsCode | null;

  @IsOptional()
  @IsString({ message: 'deliveryTermsPlace must be a string' })
  @MaxLength(DELIVERY_TERMS_PLACE_MAX_LENGTH, {
    message: `deliveryTermsPlace must be at most ${DELIVERY_TERMS_PLACE_MAX_LENGTH} characters`,
  })
  deliveryTermsPlace?: string | null;

  @IsOptional()
  @IsString({ message: 'deliveryTermsText must be a string' })
  @MaxLength(DELIVERY_TERMS_TEXT_MAX_LENGTH, {
    message: `deliveryTermsText must be at most ${DELIVERY_TERMS_TEXT_MAX_LENGTH} characters`,
  })
  deliveryTermsText?: string | null;
}

/** Payment + delivery terms input. `paymentDueDays` null/omitted inherits (service plan → global default). */
export class DocumentTermsInputDto extends DeliveryTermsInputDto {
  @IsOptional()
  @IsInt({ message: 'paymentDueDays must be an integer' })
  @Min(0, { message: 'paymentDueDays must be at least 0' })
  @Max(PAYMENT_DUE_DAYS_MAX, { message: `paymentDueDays must be at most ${PAYMENT_DUE_DAYS_MAX}` })
  paymentDueDays?: number | null;
}

/** Stored terms on plans / offers / invoices. Null means "inherit" (plans, draft offers) or "none" (issued docs). */
export class DocumentTermsResponseDto {
  paymentDueDays!: number | null;
  deliveryTermsCode!: DeliveryTermsCode | null;
  deliveryTermsPlace!: string | null;
  deliveryTermsText!: string | null;
}

/** Maps persisted columns to the response shape (drops unknown codes / inconsistent combinations). */
export function mapDocumentTermsToResponse(fields: DocumentTermsFields | null | undefined): DocumentTermsResponseDto {
  const deliveryTerms = deliveryTermsFromColumns(fields);
  const paymentDueDays = fields?.paymentDueDays;

  return {
    paymentDueDays: paymentDueDays != null ? Number(paymentDueDays) : null,
    deliveryTermsCode: deliveryTerms?.code ?? null,
    deliveryTermsPlace: deliveryTerms?.place ?? null,
    deliveryTermsText: deliveryTerms?.text ?? null,
  };
}

/** Effective terms after the cascade (document / plan → global default); payment terms are always set. */
export class EffectiveDocumentTermsResponseDto extends DocumentTermsResponseDto {
  declare paymentDueDays: number;
}

export function mapEffectiveDocumentTermsToResponse(terms: ResolvedDocumentTerms): EffectiveDocumentTermsResponseDto {
  return { ...mapDocumentTermsToResponse(toDocumentTermsColumns(terms)), paymentDueDays: terms.paymentDueDays };
}
