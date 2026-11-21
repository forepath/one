import type { EmailAttachmentRef, EmailAttachmentResolver } from '@forepath/shared/backend';
import { Injectable, Optional } from '@nestjs/common';

import { OffersRepository } from '../offers/repositories/offers.repository';
import { OfferPdfService } from '../offers/services/offer-pdf.service';
import { ProjectTimeReportPdfService } from '../projects/services/project-time-report-pdf.service';
import { InvoiceCreditDocumentsRepository } from '../repositories/invoice-credit-documents.repository';
import { InvoiceVoidDocumentsRepository } from '../repositories/invoice-void-documents.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { InvoicePdfService } from '../services/invoice-pdf.service';

type AttachmentSource = 'invoice' | 'offer';

/**
 * Resolves email PDF attachments only after verifying the storage key belongs to
 * a tenant-scoped invoice, void, or credit document (or its time report), or to a tenant-scoped, non-draft offer.
 * Offer PDFs live in their own storage area and are read from there.
 */
@Injectable()
export class BillingEmailAttachmentResolver implements EmailAttachmentResolver {
  constructor(
    private readonly invoicePdfService: InvoicePdfService,
    private readonly timeReportPdfService: ProjectTimeReportPdfService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly voidDocumentsRepository: InvoiceVoidDocumentsRepository,
    private readonly creditDocumentsRepository: InvoiceCreditDocumentsRepository,
    @Optional() private readonly offersRepository?: OffersRepository,
    @Optional() private readonly offerPdfService?: OfferPdfService,
  ) {}

  async resolve(refs: EmailAttachmentRef[]): Promise<Array<{ filename: string; content: Buffer }>> {
    const attachments: Array<{ filename: string; content: Buffer }> = [];

    for (const ref of refs) {
      const content = await this.readAuthorizedAttachment(ref);

      attachments.push({ filename: ref.filename, content });
    }

    return attachments;
  }

  private async readAuthorizedAttachment(ref: EmailAttachmentRef): Promise<Buffer> {
    const source = await this.resolveAuthorizedSource(ref.storageKey);

    if (!source) {
      throw new Error('Email attachment storage key is not authorized for this tenant');
    }

    if (source === 'offer' && this.offerPdfService) {
      return await this.offerPdfService.readPdf(ref.storageKey);
    }

    if (ref.filename.startsWith('time-report-')) {
      return await this.timeReportPdfService.readPdf(ref.storageKey);
    }

    return await this.invoicePdfService.readPdf(ref.storageKey);
  }

  private async resolveAuthorizedSource(storageKey: string): Promise<AttachmentSource | null> {
    if (await this.invoicesRepository.existsAuthorizedByPdfOrTimeReportStorageKey(storageKey)) {
      return 'invoice';
    }

    if (await this.voidDocumentsRepository.existsAuthorizedByPdfStorageKey(storageKey)) {
      return 'invoice';
    }

    if (await this.creditDocumentsRepository.existsAuthorizedByPdfStorageKey(storageKey)) {
      return 'invoice';
    }

    if (this.offersRepository && this.offerPdfService) {
      if (await this.offersRepository.existsAuthorizedByPdfStorageKey(storageKey)) {
        return 'offer';
      }
    }

    return null;
  }
}
