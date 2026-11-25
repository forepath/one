import { createHash } from 'node:crypto';

import { runWithTenantId } from '@forepath/shared/backend/util-http-context';
import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { DeliverableDocumentType, DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { canTransitionPostalLetter, PostalLetterStatus } from '../constants/postal-letter.constants';
import type { PostalAddressPosition } from '../constants/postal-provider.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { PostalLetterEntity } from '../entities/postal-letter.entity';
import { OffersRepository } from '../offers/repositories/offers.repository';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PostalLettersRepository } from '../repositories/postal-letters.repository';
import { BillingAuditLogService } from '../services/billing-audit-log.service';
import { BillingIssuerConfigService } from '../services/billing-issuer-config.service';
import { formatCustomerDisplayName } from '../utils/customer-display-name.util';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

import { PostalLetterDocumentService } from './postal-letter-document.service';
import { PostalProviderFactory } from './postal-provider.factory';
import { PostalProviderError, type PostalLetterRecipient, type PostalProvider } from './postal-provider.interface';

export interface DispatchPostalLetterParams {
  documentType: DeliverableDocumentType;
  /** Invoice id (invoices and credit notes) or offer id. */
  documentId: string;
  documentNumber: string;
  documentDate?: Date | null;
  userId: string;
  /** Stored document PDF first, then attachments printed with it. */
  pdfs: Buffer[];
  /** The `sent_at` the caller claimed for this delivery (supplementary letters: identifies the delivery only). */
  claimedAt: Date;
  adminUserId?: string | null;
  /** Posted in addition to the email (customer preference): its lifecycle never touches the document's sent state. */
  supplementary?: boolean;
}

export interface PostalDeliveryAvailability {
  available: boolean;
  provider: string | null;
  providerName: string | null;
}

export type PostalWebhookResult = 'processed' | 'ignored';

const DOCUMENT_TITLES: Record<DeliverableDocumentType, string> = {
  [DeliverableDocumentType.INVOICE]: 'Invoice',
  [DeliverableDocumentType.CREDIT_NOTE]: 'Credit note',
  [DeliverableDocumentType.OFFER]: 'Offer',
};

/**
 * Sends customer documents as physical letters through the tenant's postal provider and keeps the document's
 * delivery state in line with the provider's webhooks:
 *
 * - submitted: the document counts as sent (`sent_via = letter`), like an email that was queued
 * - action_required / cancelled: the provider will not post it, so the claim is released (the document shows as
 *   unsent again and can be sent another way)
 * - sent / delivered after a release (fixed at the provider): claimed again
 * - undeliverable: stays sent; the action center lists the letter
 */
@Injectable()
export class PostalLetterService {
  private readonly logger = new Logger(PostalLetterService.name);

  constructor(
    private readonly providers: PostalProviderFactory,
    private readonly documents: PostalLetterDocumentService,
    private readonly postalLettersRepository: PostalLettersRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly offersRepository: OffersRepository,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  /** Whether letters can be sent in the current tenant (default provider registered and configured). */
  getAvailability(): PostalDeliveryAvailability {
    const provider = this.providers.getDefaultConfiguredProvider();

    return {
      available: provider !== null,
      provider: provider?.getType() ?? null,
      providerName: provider?.getDisplayName() ?? null,
    };
  }

  /**
   * Checks what a letter needs before the document is claimed: a configured provider, the issuer (return address)
   * and the customer's postal address. Returns the recipient so callers fail before claiming the delivery.
   */
  async prepare(userId: string): Promise<{ provider: PostalProvider; recipient: PostalLetterRecipient }> {
    const provider = this.providers.getDefaultConfiguredProvider();

    if (!provider) {
      throw new BadRequestException('Postal delivery is not configured (Settings → Postal delivery)');
    }

    this.billingIssuerConfig.assertConfigured();

    const profile = await this.customerProfilesRepository.findByUserId(userId);
    const recipient = profile ? buildPostalRecipient(profile) : null;

    if (!recipient) {
      throw new BadRequestException(
        'The customer has no complete postal address (name, street, postal code, city and country are required)',
      );
    }

    return { provider, recipient };
  }

  /**
   * Builds the letter PDF and hands it to the provider. Throws (with the provider's reason) when the provider rejects
   * it; the caller then releases its claim. The letter is recorded with the current tenant for webhook resolution.
   */
  async dispatch(params: DispatchPostalLetterParams): Promise<PostalLetterEntity> {
    const { provider, recipient } = await this.prepare(params.userId);
    const issuer = this.billingIssuerConfig.getConfig();
    const addressPosition = resolveAddressPosition();
    const coverPage = process.env.BILLING_POSTAL_COVER_PAGE?.trim().toLowerCase() !== 'false';
    const letter = await this.documents.build({
      documents: params.pdfs,
      recipient,
      issuer,
      documentTitle: DOCUMENT_TITLES[params.documentType],
      documentNumber: params.documentNumber,
      documentDate: params.documentDate,
      addressPosition,
      coverPage,
      duplex: provider.printsDuplex(),
      returnAddress: !(provider.printsSenderBlock?.() ?? false),
    });
    let result;

    try {
      result = await provider.sendLetter({
        pdf: letter.pdf,
        fileName: `${params.documentNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`,
        addressPosition,
        recipient,
        idempotencyKey: postalIdempotencyKey(params.documentType, params.documentId, params.claimedAt),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      const retryable = !(error instanceof PostalProviderError) || error.retryable;
      const message = `The letter could not be submitted to ${provider.getDisplayName()}: ${reason}`;

      this.logger.warn(
        `Letter for ${params.documentType} ${params.documentId} failed (retryable: ${retryable}): ${reason}`,
      );

      // Transient failures are retried by the spooler; rejections end the job.
      throw retryable ? new Error(message) : new BadRequestException(message);
    }

    const saved = await this.postalLettersRepository.create({
      tenantId: getRequiredTenantId(),
      userId: params.userId,
      documentType: params.documentType,
      documentId: params.documentId,
      documentNumber: params.documentNumber,
      provider: provider.getType(),
      externalId: result.externalId,
      status: result.status,
      claimedAt: params.claimedAt,
      supplementary: params.supplementary === true,
      coverPage: letter.coverPage,
      pageCount: result.pageCount ?? letter.pageCount,
      country: recipient.country,
      createdByUserId: params.adminUserId ?? null,
    });

    await this.auditLog.log({
      process: 'postal_letter.submit',
      level: 'info',
      message: `Submitted ${DOCUMENT_TITLES[params.documentType].toLowerCase()} ${params.documentNumber} as a letter via ${provider.getDisplayName()}`,
      ...documentRefs(params.documentType, params.documentId),
      userId: params.userId,
      context: {
        adminUserId: params.adminUserId ?? null,
        provider: provider.getType(),
        externalId: result.externalId,
        pageCount: saved.pageCount,
        coverPage: letter.coverPage,
      },
    });

    return saved;
  }

  /** Letters of a document in the current tenant (newest first). */
  async listForDocument(documentType: DeliverableDocumentType, documentId: string): Promise<PostalLetterEntity[]> {
    return await this.postalLettersRepository.findByDocument(documentType, documentId);
  }

  /**
   * Provider webhook. The letter (and with it the tenant) is resolved from the provider letter id; the signature is
   * then verified with that tenant's signing key before anything in the body is applied. Unknown letters are
   * acknowledged without effect (test events, letters created outside Decabill).
   */
  async handleWebhook(
    providerType: string,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<PostalWebhookResult> {
    const provider = this.providers.findProvider(providerType);

    if (!provider) {
      throw new NotFoundException('Unknown postal provider');
    }

    const externalId = provider.extractWebhookLetterId(rawBody);
    const letter = externalId
      ? await this.postalLettersRepository.findByProviderExternalId(provider.getType(), externalId)
      : null;

    if (!letter) {
      return 'ignored';
    }

    const header = headers[provider.getWebhookSignatureHeader()];
    const signature = Array.isArray(header) ? header[0] : header;

    return await runWithTenantId(letter.tenantId, async () => {
      if (!provider.verifyWebhookSignature(rawBody, signature)) {
        throw new UnauthorizedException('Invalid webhook signature');
      }

      const event = provider.parseWebhookEvent(rawBody);

      if (!event || event.externalLetterId !== letter.externalId) {
        return 'ignored';
      }

      return await this.applyStatus(letter, event.status, event.reason ?? null);
    });
  }

  private async applyStatus(
    letter: PostalLetterEntity,
    next: PostalLetterStatus,
    reason: string | null,
  ): Promise<PostalWebhookResult> {
    if (!canTransitionPostalLetter(letter.status, next)) {
      return 'ignored';
    }

    if (!(await this.postalLettersRepository.transitionStatus(letter.id, letter.status, next, reason))) {
      // Another delivery of this (or a later) event won the race.
      return 'ignored';
    }

    const previous = letter.status;
    let documentEffect: 'released' | 'claimed' | null = null;

    if (letter.supplementary) {
      // In addition to the email (customer preference): the document stays sent by email either way.
    } else if (next === PostalLetterStatus.ACTION_REQUIRED || next === PostalLetterStatus.CANCELLED) {
      documentEffect = (await this.releaseDocument(letter)) ? 'released' : null;
    } else if (
      (next === PostalLetterStatus.SENT || next === PostalLetterStatus.DELIVERED) &&
      previous === PostalLetterStatus.ACTION_REQUIRED
    ) {
      documentEffect = (await this.claimDocument(letter)) ? 'claimed' : null;
    }

    const attention = next === PostalLetterStatus.ACTION_REQUIRED || next === PostalLetterStatus.UNDELIVERABLE;

    await this.auditLog.log({
      process: 'postal_letter.status',
      level: attention ? 'warn' : 'info',
      message: `Letter for ${DOCUMENT_TITLES[letter.documentType].toLowerCase()} ${letter.documentNumber ?? letter.documentId} is now ${next}`,
      ...documentRefs(letter.documentType, letter.documentId),
      userId: letter.userId,
      context: {
        provider: letter.provider,
        externalId: letter.externalId,
        previousStatus: previous,
        supplementary: letter.supplementary === true,
        status: next,
        reason,
        documentEffect,
      },
    });

    return 'processed';
  }

  /** Releases the document's claim made by this letter (only while it is still that claim). */
  private async releaseDocument(letter: PostalLetterEntity): Promise<boolean> {
    switch (letter.documentType) {
      case DeliverableDocumentType.INVOICE:
        return await this.invoicesRepository.releaseDelivery(letter.documentId, 'sentAt', letter.claimedAt);
      case DeliverableDocumentType.CREDIT_NOTE:
        return await this.invoicesRepository.releaseDelivery(letter.documentId, 'voidDocumentSentAt', letter.claimedAt);
      case DeliverableDocumentType.OFFER:
        return await this.offersRepository.releaseSent(letter.documentId, letter.claimedAt);
    }
  }

  /** Claims the document again when a released letter was posted after all (only while it is still unsent). */
  private async claimDocument(letter: PostalLetterEntity): Promise<boolean> {
    switch (letter.documentType) {
      case DeliverableDocumentType.INVOICE:
        return await this.invoicesRepository.claimDelivery(
          letter.documentId,
          'sentAt',
          letter.claimedAt,
          DocumentDeliveryChannel.LETTER,
        );
      case DeliverableDocumentType.CREDIT_NOTE:
        return await this.invoicesRepository.claimDelivery(
          letter.documentId,
          'voidDocumentSentAt',
          letter.claimedAt,
          DocumentDeliveryChannel.LETTER,
        );
      case DeliverableDocumentType.OFFER:
        return await this.offersRepository.claimSent(
          letter.documentId,
          letter.claimedAt,
          DocumentDeliveryChannel.LETTER,
        );
    }
  }
}

/** Idempotency key of one delivery claim (64 hex characters, Pingen accepts 1-64). */
export function postalIdempotencyKey(documentType: string, documentId: string, claimedAt: Date): string {
  return createHash('sha256').update(`${documentType}:${documentId}:${claimedAt.toISOString()}`).digest('hex');
}

/** `BILLING_POSTAL_ADDRESS_POSITION` (`left` default, `right` for Swiss window envelopes). */
export function resolveAddressPosition(): PostalAddressPosition {
  return process.env.BILLING_POSTAL_ADDRESS_POSITION?.trim().toLowerCase() === 'right' ? 'right' : 'left';
}

/**
 * Postal recipient from the billing profile: company and/or contact name, street lines, postal code, city, country.
 * `null` when anything a postal address needs is missing.
 */
export function buildPostalRecipient(profile: CustomerProfileEntity): PostalLetterRecipient | null {
  const company = profile.company?.trim();
  const person = [profile.firstName?.trim(), profile.lastName?.trim()].filter(Boolean).join(' ');
  const nameLines = company ? [company, ...(person ? [person] : [])] : person ? [person] : [];
  const street = profile.addressLine1?.trim();
  const postalCode = profile.postalCode?.trim();
  const city = profile.city?.trim();
  const country = profile.country?.trim().toUpperCase();

  if (nameLines.length === 0 || !formatCustomerDisplayName(profile) || !street || !postalCode || !city) {
    return null;
  }

  if (!country || !/^[A-Z]{2}$/.test(country)) {
    return null;
  }

  const streetLine2 = profile.addressLine2?.trim();

  return {
    nameLines,
    streetLines: streetLine2 ? [street, streetLine2] : [street],
    postalCode,
    city,
    country,
  };
}

function documentRefs(type: DeliverableDocumentType, documentId: string): { invoiceId?: string; offerId?: string } {
  return type === DeliverableDocumentType.OFFER ? { offerId: documentId } : { invoiceId: documentId };
}
