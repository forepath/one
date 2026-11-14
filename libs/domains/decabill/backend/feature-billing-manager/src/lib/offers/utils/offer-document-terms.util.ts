import type { DocumentTermsInputDto, EffectiveDocumentTermsResponseDto } from '../../dto/document-terms.dto';
import { mapDocumentTermsToResponse, mapEffectiveDocumentTermsToResponse } from '../../dto/document-terms.dto';
import type { BillingDocumentTermsConfigService } from '../../services/billing-document-terms-config.service';
import {
  documentTermsLayerFromFields,
  type DocumentTermsColumns,
  normalizeDeliveryTermsInput,
  normalizePaymentDueDaysInput,
  toDeliveryTermsColumns,
} from '../../utils/document-terms.utils';
import type { OfferEntity } from '../entities/offer.entity';

/** Draft-offer overrides from the admin editor (null = global default). Throws 400 on invalid combinations. */
export function buildOfferDraftDocumentTerms(dto: DocumentTermsInputDto): DocumentTermsColumns {
  return {
    paymentDueDays: normalizePaymentDueDaysInput(dto.paymentDueDays),
    ...toDeliveryTermsColumns(normalizeDeliveryTermsInput(dto)),
  };
}

/** Stored + effective terms for the admin offer detail response. */
export function mapAdminOfferDocumentTerms(
  offer: Pick<OfferEntity, 'paymentDueDays' | 'deliveryTermsCode' | 'deliveryTermsPlace' | 'deliveryTermsText'>,
  documentTermsConfig: BillingDocumentTermsConfigService,
): ReturnType<typeof mapDocumentTermsToResponse> & { effectiveDocumentTerms: EffectiveDocumentTermsResponseDto } {
  return {
    ...mapDocumentTermsToResponse(offer),
    effectiveDocumentTerms: mapEffectiveDocumentTermsToResponse(
      documentTermsConfig.resolve(documentTermsLayerFromFields(offer)),
    ),
  };
}
