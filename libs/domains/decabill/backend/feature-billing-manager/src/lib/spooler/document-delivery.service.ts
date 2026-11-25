import { BadRequestException, Injectable } from '@nestjs/common';

import { DeliverableDocumentType, DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import type { InvoiceEntity } from '../entities/invoice.entity';
import type { OfferEntity } from '../offers/entities/offer.entity';
import { OffersRepository } from '../offers/repositories/offers.repository';
import { OfferArchiveService } from '../offers/services/offer-archive.service';
import { PostalLetterService } from '../postal-providers/postal-letter.service';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { buildCreditNoteNumber } from '../services/e-invoice-document-options';
import { InvoiceService } from '../services/invoice.service';

import type { SpoolJobEntity } from './entities/spool-job.entity';
import { SpoolJobKind, SpoolOutputTarget } from './spooler.constants';
import { SpoolerService } from './spooler.service';

/** Channels a document can be spooled to (manual = mark as sent, not spooled). */
export type SpooledDeliveryChannel = DocumentDeliveryChannel.EMAIL | DocumentDeliveryChannel.LETTER;

/** Payload of a `document.send` spool job. */
export interface DocumentSendPayload extends Record<string, unknown> {
  documentType: DeliverableDocumentType;
  channel: SpooledDeliveryChannel;
  /** The document's `sent_at` claimed for this delivery (ISO). */
  claimedAt: string;
  adminUserId: string | null;
  /** Provider letter id once submitted (letters). */
  externalLetterId?: string;
  /**
   * Letter posted in addition to the email because the customer prefers letters: the email owns the document's sent
   * state, so this job neither requires nor releases a claim (`claimedAt` only identifies the delivery).
   */
  supplementary?: boolean;
}

const TITLES: Record<DeliverableDocumentType, string> = {
  [DeliverableDocumentType.INVOICE]: 'Invoice',
  [DeliverableDocumentType.CREDIT_NOTE]: 'Credit note',
  [DeliverableDocumentType.OFFER]: 'Offer',
};

/**
 * Request side of document sends (console and API): checks that the document can be sent on the chosen channel,
 * claims it (`sent_at` / `sent_via`, so a second send is refused right away) and spools the delivery. The spool job
 * (`DocumentSendSpoolHandler`) renders and sends it in the background; when it fails for good or is cancelled, the
 * claim is released and the document shows as unsent again.
 */
@Injectable()
export class DocumentDeliveryService {
  constructor(
    private readonly spooler: SpoolerService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly offersRepository: OffersRepository,
    private readonly invoiceService: InvoiceService,
    private readonly offerArchiveService: OfferArchiveService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly postalLetterService: PostalLetterService,
  ) {}

  async spoolInvoice(
    invoiceId: string,
    channel: SpooledDeliveryChannel,
    adminUserId?: string,
  ): Promise<{ invoice: InvoiceEntity; job: SpoolJobEntity }> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceId);

    this.invoiceService.assertInvoiceSendable(invoice);
    await this.assertChannelReady(channel, invoice.userId);

    const job = await this.claimAndSpool({
      documentType: DeliverableDocumentType.INVOICE,
      documentId: invoice.id,
      documentNumber: invoice.invoiceNumber ?? invoice.id,
      channel,
      adminUserId,
    });

    return { invoice: await this.invoicesRepository.findByIdOrThrow(invoiceId), job };
  }

  async spoolCreditNote(
    invoiceId: string,
    channel: SpooledDeliveryChannel,
    adminUserId?: string,
  ): Promise<{ invoice: InvoiceEntity; job: SpoolJobEntity }> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceId);

    this.invoiceService.assertCreditNoteSendable(invoice);
    await this.assertChannelReady(channel, invoice.userId);

    const job = await this.claimAndSpool({
      documentType: DeliverableDocumentType.CREDIT_NOTE,
      documentId: invoice.id,
      documentNumber: buildCreditNoteNumber(invoice.invoiceNumber as string),
      channel,
      adminUserId,
    });

    return { invoice: await this.invoicesRepository.findByIdOrThrow(invoiceId), job };
  }

  async spoolOffer(
    offerId: string,
    channel: SpooledDeliveryChannel,
    adminUserId?: string,
  ): Promise<{ offer: OfferEntity; job: SpoolJobEntity }> {
    const offer = await this.offersRepository.findByIdOrThrow(offerId);

    this.offerArchiveService.assertOfferSendable(offer);
    await this.assertChannelReady(channel, offer.userId);

    const job = await this.claimAndSpool({
      documentType: DeliverableDocumentType.OFFER,
      documentId: offer.id,
      documentNumber: offer.offerNumber ?? offer.id,
      channel,
      adminUserId,
    });

    return { offer: await this.offersRepository.findByIdOrThrow(offerId), job };
  }

  /**
   * Claims a document for a (new) delivery; resolves `false` when it was sent meanwhile. Used when a failed send job
   * is retried.
   */
  async claim(
    documentType: DeliverableDocumentType,
    documentId: string,
    at: Date,
    channel: DocumentDeliveryChannel,
  ): Promise<boolean> {
    switch (documentType) {
      case DeliverableDocumentType.INVOICE:
        return await this.invoicesRepository.claimDelivery(documentId, 'sentAt', at, channel);
      case DeliverableDocumentType.CREDIT_NOTE:
        return await this.invoicesRepository.claimDelivery(documentId, 'voidDocumentSentAt', at, channel);
      case DeliverableDocumentType.OFFER:
        return await this.offersRepository.claimSent(documentId, at, channel);
    }
  }

  /** Releases a claim (only while it is still the claim made at `at`). */
  async release(documentType: DeliverableDocumentType, documentId: string, at: Date): Promise<boolean> {
    switch (documentType) {
      case DeliverableDocumentType.INVOICE:
        return await this.invoicesRepository.releaseDelivery(documentId, 'sentAt', at);
      case DeliverableDocumentType.CREDIT_NOTE:
        return await this.invoicesRepository.releaseDelivery(documentId, 'voidDocumentSentAt', at);
      case DeliverableDocumentType.OFFER:
        return await this.offersRepository.releaseSent(documentId, at);
    }
  }

  /** Fails before claiming when the customer cannot receive the document on this channel. */
  async assertChannelReady(channel: SpooledDeliveryChannel, userId: string): Promise<void> {
    if (channel === DocumentDeliveryChannel.LETTER) {
      await this.postalLetterService.prepare(userId);

      return;
    }

    if (!(await this.billingEmailPublisher.hasRecipient(userId))) {
      throw new BadRequestException('Customer has no billing email address; nothing was sent');
    }
  }

  private async claimAndSpool(params: {
    documentType: DeliverableDocumentType;
    documentId: string;
    documentNumber: string;
    channel: SpooledDeliveryChannel;
    adminUserId?: string;
  }): Promise<SpoolJobEntity> {
    const at = new Date();
    const title = TITLES[params.documentType];

    if (!(await this.claim(params.documentType, params.documentId, at, params.channel))) {
      throw new BadRequestException(`${title} has already been sent`);
    }

    const payload: DocumentSendPayload = {
      documentType: params.documentType,
      channel: params.channel,
      claimedAt: at.toISOString(),
      adminUserId: params.adminUserId ?? null,
    };

    try {
      return await this.spooler.create({
        kind: SpoolJobKind.DOCUMENT_SEND,
        outputTarget:
          params.channel === DocumentDeliveryChannel.LETTER ? SpoolOutputTarget.POSTAL : SpoolOutputTarget.EMAIL,
        title: `${title} ${params.documentNumber} by ${params.channel === DocumentDeliveryChannel.LETTER ? 'letter' : 'email'}`,
        payload,
        documentType: params.documentType,
        documentId: params.documentId,
        createdByUserId: params.adminUserId ?? null,
      });
    } catch (error) {
      await this.release(params.documentType, params.documentId, at);

      throw error;
    }
  }
}
