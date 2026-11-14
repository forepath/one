import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PAYMENT_DUE_DAYS_FALLBACK, PAYMENT_DUE_DAYS_MAX } from '../constants/document-terms.constants';
import type { DocumentTermsLayer, ResolvedDocumentTerms } from '../utils/document-terms.utils';
import { normalizeDeliveryTermsInput, resolveDocumentTerms } from '../utils/document-terms.utils';

/**
 * Global default payment / delivery terms (`BILLING_DEFAULT_PAYMENT_DUE_DAYS`, `BILLING_DEFAULT_DELIVERY_TERMS_*`).
 * Service plans and individual documents (offers, manual invoices) override them; the resolved terms are frozen onto
 * each document when it is issued / archived.
 */
@Injectable()
export class BillingDocumentTermsConfigService implements OnModuleInit {
  private readonly logger = new Logger(BillingDocumentTermsConfigService.name);
  private defaults: ResolvedDocumentTerms = { paymentDueDays: PAYMENT_DUE_DAYS_FALLBACK, deliveryTerms: null };

  onModuleInit(): void {
    this.defaults = {
      paymentDueDays: this.readPaymentDueDays(),
      deliveryTerms: this.readDeliveryTerms(),
    };
  }

  getDefaults(): ResolvedDocumentTerms {
    return this.defaults;
  }

  /** First layer that sets a value wins (per facet); the global default fills the rest. */
  resolve(...layers: Array<DocumentTermsLayer | null | undefined>): ResolvedDocumentTerms {
    return resolveDocumentTerms(layers, this.defaults);
  }

  private readPaymentDueDays(): number {
    const raw = process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS?.trim();

    if (!raw) {
      return PAYMENT_DUE_DAYS_FALLBACK;
    }

    const parsed = Number(raw);

    if (!/^\d+$/.test(raw) || parsed > PAYMENT_DUE_DAYS_MAX) {
      this.logger.warn(
        `BILLING_DEFAULT_PAYMENT_DUE_DAYS must be an integer between 0 and ${PAYMENT_DUE_DAYS_MAX}; using ${PAYMENT_DUE_DAYS_FALLBACK}.`,
      );

      return PAYMENT_DUE_DAYS_FALLBACK;
    }

    return parsed;
  }

  private readDeliveryTerms(): ResolvedDocumentTerms['deliveryTerms'] {
    const code = process.env.BILLING_DEFAULT_DELIVERY_TERMS_CODE?.trim().toUpperCase();

    if (!code) {
      return null;
    }

    try {
      return normalizeDeliveryTermsInput({
        deliveryTermsCode: code,
        deliveryTermsPlace: process.env.BILLING_DEFAULT_DELIVERY_TERMS_PLACE,
        deliveryTermsText: process.env.BILLING_DEFAULT_DELIVERY_TERMS_TEXT,
      });
    } catch (error) {
      this.logger.warn(
        `Ignoring default delivery terms (BILLING_DEFAULT_DELIVERY_TERMS_*): ${(error as Error).message}`,
      );

      return null;
    }
  }
}
