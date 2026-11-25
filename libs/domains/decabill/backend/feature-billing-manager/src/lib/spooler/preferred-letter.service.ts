import { Injectable, Logger } from '@nestjs/common';

import { DeliverableDocumentType, DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { buildPostalRecipient } from '../postal-providers/postal-letter.service';
import { PostalProviderFactory } from '../postal-providers/postal-provider.factory';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { BillingAuditLogService } from '../services/billing-audit-log.service';

import type { DocumentSendPayload } from './document-delivery.service';
import { SpoolJobKind, SpoolOutputTarget } from './spooler.constants';
import { SpoolerService } from './spooler.service';

export interface PreferredLetterParams {
  documentType: DeliverableDocumentType;
  documentId: string;
  documentNumber: string;
  userId: string;
  adminUserId?: string | null;
}

const TITLES: Record<DeliverableDocumentType, string> = {
  [DeliverableDocumentType.INVOICE]: 'Invoice',
  [DeliverableDocumentType.CREDIT_NOTE]: 'Credit note',
  [DeliverableDocumentType.OFFER]: 'Offer',
};

/**
 * Customers who prefer letters (customer profile `preferredDeliveryChannel: letter`) get every document that is
 * emailed to them posted as well. The letter is supplementary: the email keeps the document's sent state, and a
 * failing letter never makes the document unsent. Called after a document email was queued (or would have been,
 * when the customer has no email address); never throws into the sending flow.
 */
@Injectable()
export class PreferredLetterService {
  private readonly logger = new Logger(PreferredLetterService.name);

  constructor(
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly postalProviders: PostalProviderFactory,
    private readonly spooler: SpoolerService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  /** Spools the supplementary letter when the customer prefers letters; resolves the spool job id or `null`. */
  async sendIfPreferred(params: PreferredLetterParams): Promise<string | null> {
    try {
      const profile = await this.customerProfilesRepository.findByUserId(params.userId);

      if (profile?.preferredDeliveryChannel !== DocumentDeliveryChannel.LETTER) {
        return null;
      }

      const title = TITLES[params.documentType];
      const skip = !this.postalProviders.getDefaultConfiguredProvider()
        ? 'no postal provider is configured'
        : !buildPostalRecipient(profile)
          ? 'the postal address is incomplete'
          : null;

      if (skip) {
        await this.audit(
          params,
          'warn',
          `Preferred letter for ${title.toLowerCase()} ${params.documentNumber} skipped: ${skip}`,
        );

        return null;
      }

      const payload: DocumentSendPayload = {
        documentType: params.documentType,
        channel: DocumentDeliveryChannel.LETTER,
        // Identifies this supplementary delivery (idempotency key, letter record); never compared with `sent_at`.
        claimedAt: new Date().toISOString(),
        adminUserId: params.adminUserId ?? null,
        supplementary: true,
      };
      const job = await this.spooler.create({
        kind: SpoolJobKind.DOCUMENT_SEND,
        outputTarget: SpoolOutputTarget.POSTAL,
        title: `${title} ${params.documentNumber} by letter (customer preference)`,
        payload,
        documentType: params.documentType,
        documentId: params.documentId,
        createdByUserId: params.adminUserId ?? null,
      });

      return job.id;
    } catch (error) {
      // The email went out already; a letter that cannot be spooled must not fail issuing, voiding or archiving.
      this.logger.error(
        `Preferred letter for ${params.documentType} ${params.documentId} could not be spooled: ${(error as Error).message}`,
      );
      await this.audit(params, 'error', `Preferred letter could not be spooled: ${(error as Error).message}`).catch(
        () => undefined,
      );

      return null;
    }
  }

  private async audit(params: PreferredLetterParams, level: 'warn' | 'error', message: string): Promise<void> {
    await this.auditLog.log({
      process: 'postal_letter.preferred',
      level,
      message,
      ...(params.documentType === DeliverableDocumentType.OFFER
        ? { offerId: params.documentId }
        : { invoiceId: params.documentId }),
      userId: params.userId,
      context: { documentType: params.documentType, adminUserId: params.adminUserId ?? null },
    });
  }
}
