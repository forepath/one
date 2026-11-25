import { BadRequestException, Injectable, Optional } from '@nestjs/common';

import { DeliverableDocumentType, DocumentDeliveryChannel } from '../../constants/document-delivery.constants';
import { InvoiceStatus } from '../../constants/invoice-status.constants';
import { BillingEmailPublisher } from '../../email/billing-email.publisher';
import type { InvoiceEntity } from '../../entities/invoice.entity';
import { OfferStatus } from '../../offers/constants/offer-status.constants';
import type { OfferEntity } from '../../offers/entities/offer.entity';
import { OffersRepository } from '../../offers/repositories/offers.repository';
import { OfferArchiveService } from '../../offers/services/offer-archive.service';
import { OfferPdfService } from '../../offers/services/offer-pdf.service';
import { PostalLetterService } from '../../postal-providers/postal-letter.service';
import { ProjectTimeReportService } from '../../projects/services/project-time-report.service';
import { InvoicesRepository } from '../../repositories/invoices.repository';
import { PostalLettersRepository } from '../../repositories/postal-letters.repository';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { buildCreditNoteNumber } from '../../services/e-invoice-document-options';
import { InvoicePdfService } from '../../services/invoice-pdf.service';
import { InvoiceService } from '../../services/invoice.service';
import { DocumentDeliveryService, type DocumentSendPayload } from '../document-delivery.service';
import type { SpoolJobEntity } from '../entities/spool-job.entity';
import { PreferredLetterService } from '../preferred-letter.service';
import { SpoolPermanentError, type SpoolKindHandler, type SpoolRunResult } from '../spool-kind-handler.interface';
import { SpoolJobKind } from '../spooler.constants';

type DeliverableDocument =
  | { type: DeliverableDocumentType.INVOICE | DeliverableDocumentType.CREDIT_NOTE; invoice: InvoiceEntity }
  | { type: DeliverableDocumentType.OFFER; offer: OfferEntity };

/**
 * Worker side of document sends (`document.send`): emails the document (PDF attached, as before) or submits it as a
 * letter to the postal provider. Runs only while the document is still claimed by this job; a final failure or a
 * cancellation releases the claim.
 */
@Injectable()
export class DocumentSendSpoolHandler implements SpoolKindHandler {
  readonly kind = SpoolJobKind.DOCUMENT_SEND;

  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly offersRepository: OffersRepository,
    private readonly invoiceService: InvoiceService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly projectTimeReportService: ProjectTimeReportService,
    private readonly offerArchiveService: OfferArchiveService,
    private readonly offerPdfService: OfferPdfService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly postalLetterService: PostalLetterService,
    private readonly postalLettersRepository: PostalLettersRepository,
    private readonly documentDelivery: DocumentDeliveryService,
    private readonly auditLog: BillingAuditLogService,
    @Optional() private readonly preferredLetter?: PreferredLetterService,
  ) {}

  async run(job: SpoolJobEntity): Promise<SpoolRunResult> {
    const payload = readPayload(job);
    const claimedAt = new Date(payload.claimedAt);
    const document = await this.loadClaimedDocument(
      payload.documentType,
      job.documentId as string,
      payload.supplementary ? null : claimedAt,
    );

    if (payload.channel === DocumentDeliveryChannel.LETTER) {
      return await this.sendLetter(job, payload, document, claimedAt);
    }

    await this.sendEmail(document);
    await this.logSent(document, payload, 'email');
    await this.preferredLetter?.sendIfPreferred({
      documentType: payload.documentType,
      documentId: job.documentId as string,
      documentNumber: documentNumberOf(document),
      userId: document.type === DeliverableDocumentType.OFFER ? document.offer.userId : document.invoice.userId,
      adminUserId: payload.adminUserId,
    });

    return {};
  }

  async onAbandoned(job: SpoolJobEntity): Promise<void> {
    const payload = readPayload(job);

    if (payload.supplementary) {
      // The email owns the document's sent state.
      return;
    }

    await this.documentDelivery.release(payload.documentType, job.documentId as string, new Date(payload.claimedAt));
  }

  /** A failed send is retried only while the document is still unsent; it is claimed again for the new attempt. */
  async prepareRetry(job: SpoolJobEntity): Promise<Record<string, unknown>> {
    const payload = readPayload(job);
    const documentId = job.documentId as string;

    if (payload.supplementary) {
      // Same delivery again (same idempotency key): only the document state and the postal setup are checked.
      const document = await this.loadClaimedDocument(payload.documentType, documentId, null);
      const userId = document.type === DeliverableDocumentType.OFFER ? document.offer.userId : document.invoice.userId;

      await this.documentDelivery.assertChannelReady(payload.channel, userId);

      return { ...payload };
    }

    const userId = await this.loadUnsentDocumentUserId(payload.documentType, documentId);

    await this.documentDelivery.assertChannelReady(payload.channel, userId);

    const at = new Date();

    if (!(await this.documentDelivery.claim(payload.documentType, documentId, at, payload.channel))) {
      throw new BadRequestException('The document has been sent meanwhile');
    }

    const { externalLetterId: _previous, ...rest } = payload;

    return { ...rest, claimedAt: at.toISOString() };
  }

  private async sendEmail(document: DeliverableDocument): Promise<void> {
    let queued: boolean;

    if (document.type === DeliverableDocumentType.OFFER) {
      const storageKey = await this.offerArchiveService.getStoredPdfKey(document.offer);

      queued = await this.billingEmailPublisher.publishOfferArchived(document.offer, storageKey);
    } else if (document.type === DeliverableDocumentType.INVOICE) {
      const storageKey = await this.invoiceService.getStoredPdfKey(document.invoice);
      const fresh = await this.invoicesRepository.findByIdOrThrow(document.invoice.id);

      queued = await this.billingEmailPublisher.publishInvoiceIssued(fresh, storageKey);
    } else {
      const invoice = document.invoice;
      const storageKey = await this.invoiceService.getStoredVoidDocumentKey(invoice);

      queued = await this.billingEmailPublisher.publishVoidDocument(
        invoice,
        storageKey,
        buildCreditNoteNumber(invoice.invoiceNumber as string),
      );
    }

    if (!queued) {
      throw new SpoolPermanentError('Customer has no billing email address; nothing was sent');
    }
  }

  private async sendLetter(
    job: SpoolJobEntity,
    payload: DocumentSendPayload,
    document: DeliverableDocument,
    claimedAt: Date,
  ): Promise<SpoolRunResult> {
    const documentId = job.documentId as string;
    const existing = await this.postalLettersRepository.findByDocumentClaim(
      payload.documentType,
      documentId,
      claimedAt,
    );

    if (existing) {
      // An earlier attempt submitted the letter but did not finish the job.
      return { payload: { externalLetterId: existing.externalId } };
    }

    const { userId, documentNumber, documentDate, pdfs } = await this.letterContent(document);
    const letter = await this.postalLetterService.dispatch({
      documentType: payload.documentType,
      documentId,
      documentNumber,
      documentDate,
      userId,
      pdfs,
      claimedAt,
      adminUserId: payload.adminUserId,
      supplementary: payload.supplementary === true,
    });

    await this.logSent(document, payload, 'letter');

    return { payload: { externalLetterId: letter.externalId } };
  }

  private async letterContent(document: DeliverableDocument): Promise<{
    userId: string;
    documentNumber: string;
    documentDate: Date | null;
    pdfs: Buffer[];
  }> {
    if (document.type === DeliverableDocumentType.OFFER) {
      const offer = document.offer;
      const pdf = await this.offerPdfService.readPdf(await this.offerArchiveService.getStoredPdfKey(offer));

      return {
        userId: offer.userId,
        documentNumber: offer.offerNumber ?? offer.id,
        documentDate: offer.archivedAt ?? null,
        pdfs: [pdf],
      };
    }

    const invoice = document.invoice;

    if (document.type === DeliverableDocumentType.CREDIT_NOTE) {
      const pdf = await this.invoicePdfService.readPdf(await this.invoiceService.getStoredVoidDocumentKey(invoice));

      return {
        userId: invoice.userId,
        documentNumber: buildCreditNoteNumber(invoice.invoiceNumber as string),
        documentDate: invoice.voidedAt ?? null,
        pdfs: [pdf],
      };
    }

    const storageKey = await this.invoiceService.getStoredPdfKey(invoice);
    const fresh = await this.invoicesRepository.findByIdOrThrow(invoice.id);
    const pdfs = [await this.invoicePdfService.readPdf(storageKey)];

    if (fresh.timeReportStorageKey) {
      pdfs.push(await this.projectTimeReportService.getPdfBufferForInvoice(fresh));
    }

    return {
      userId: invoice.userId,
      documentNumber: invoice.invoiceNumber ?? invoice.id,
      documentDate: invoice.issuedAt ?? null,
      pdfs,
    };
  }

  /**
   * The document, as long as it is still claimed by this job's delivery (not cancelled, voided or re-sent).
   * `claimedAt: null` (supplementary letters) skips the claim check; the status checks always apply.
   */
  private async loadClaimedDocument(
    type: DeliverableDocumentType,
    documentId: string,
    claimedAt: Date | null,
  ): Promise<DeliverableDocument> {
    if (type === DeliverableDocumentType.OFFER) {
      const offer = await this.offersRepository.findByIdOrThrow(documentId);

      if (claimedAt) assertClaim(offer.sentAt, claimedAt);

      // Revoked / answered while the send waited in the queue: the customer must not get it anymore.
      if (offer.status !== OfferStatus.ARCHIVED) {
        throw new SpoolPermanentError(`The offer is ${offer.status} and is no longer sent`);
      }

      return { type, offer };
    }

    const invoice = await this.invoicesRepository.findByIdOrThrow(documentId);

    if (claimedAt) {
      assertClaim(type === DeliverableDocumentType.INVOICE ? invoice.sentAt : invoice.voidDocumentSentAt, claimedAt);
    }

    // Voided while the invoice send waited in the queue (its credit note is sent instead), or not voided (credit note).
    if (type === DeliverableDocumentType.INVOICE && invoice.status === InvoiceStatus.VOID) {
      throw new SpoolPermanentError('The invoice was voided and is no longer sent');
    }

    if (type === DeliverableDocumentType.CREDIT_NOTE && invoice.status !== InvoiceStatus.VOID) {
      throw new SpoolPermanentError('Only voided invoices have a credit note to send');
    }

    if (type === DeliverableDocumentType.INVOICE) {
      return { type, invoice };
    }

    return { type: DeliverableDocumentType.CREDIT_NOTE, invoice };
  }

  private async loadUnsentDocumentUserId(type: DeliverableDocumentType, documentId: string): Promise<string> {
    if (type === DeliverableDocumentType.OFFER) {
      const offer = await this.offersRepository.findByIdOrThrow(documentId);

      this.offerArchiveService.assertOfferSendable(offer);

      return offer.userId;
    }

    const invoice = await this.invoicesRepository.findByIdOrThrow(documentId);

    if (type === DeliverableDocumentType.INVOICE) {
      this.invoiceService.assertInvoiceSendable(invoice);
    } else {
      this.invoiceService.assertCreditNoteSendable(invoice);
    }

    return invoice.userId;
  }

  /** Audit entries as before the spooler (`invoice.send`, `offer.send` …), now written when the send happened. */
  private async logSent(
    document: DeliverableDocument,
    payload: DocumentSendPayload,
    channel: 'email' | 'letter',
  ): Promise<void> {
    const suffix = channel === 'letter' ? '_letter' : '';
    const how = channel === 'letter' ? ' as a letter' : '';
    const context = { adminUserId: payload.adminUserId };

    if (document.type === DeliverableDocumentType.OFFER) {
      const offer = document.offer;

      await this.auditLog.log({
        process: `offer.send${suffix}`,
        level: 'info',
        message: `Sent offer ${offer.offerNumber ?? offer.id} to the customer${how}`,
        offerId: offer.id,
        userId: offer.userId,
        context: { ...context, offerNumber: offer.offerNumber },
      });
      await this.offerArchiveService.afterDelivery(offer.id);

      return;
    }

    const invoice = document.invoice;
    const creditNote = document.type === DeliverableDocumentType.CREDIT_NOTE;

    await this.auditLog.log({
      process: creditNote ? `invoice.void_document_send${suffix}` : `invoice.send${suffix}`,
      level: 'info',
      message: creditNote
        ? `Sent credit note for invoice ${invoice.invoiceNumber ?? invoice.id} to the customer${how}`
        : `Sent invoice ${invoice.invoiceNumber ?? invoice.id} to the customer${how}`,
      invoiceId: invoice.id,
      userId: invoice.userId,
      context: { ...context, invoiceNumber: invoice.invoiceNumber },
    });
  }
}

function readPayload(job: SpoolJobEntity): DocumentSendPayload {
  const payload = job.payload as Partial<DocumentSendPayload>;

  if (
    !job.documentId ||
    !payload.documentType ||
    !Object.values(DeliverableDocumentType).includes(payload.documentType) ||
    (payload.channel !== DocumentDeliveryChannel.EMAIL && payload.channel !== DocumentDeliveryChannel.LETTER) ||
    typeof payload.claimedAt !== 'string'
  ) {
    throw new SpoolPermanentError('Invalid document send job');
  }

  return payload as DocumentSendPayload;
}

function assertClaim(current: Date | null | undefined, claimedAt: Date): void {
  if (!current || new Date(current).getTime() !== claimedAt.getTime()) {
    throw new SpoolPermanentError('The document is no longer waiting for this delivery');
  }
}

function documentNumberOf(document: DeliverableDocument): string {
  if (document.type === DeliverableDocumentType.OFFER) return document.offer.offerNumber ?? document.offer.id;

  return document.type === DeliverableDocumentType.CREDIT_NOTE
    ? buildCreditNoteNumber(document.invoice.invoiceNumber as string)
    : (document.invoice.invoiceNumber ?? document.invoice.id);
}
