import { Injectable } from '@nestjs/common';
import type { EmailAttachmentRef, EmailAttachmentResolver } from '@forepath/shared/backend';

import { InvoiceCreditDocumentsRepository } from '../repositories/invoice-credit-documents.repository';
import { InvoiceVoidDocumentsRepository } from '../repositories/invoice-void-documents.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { ProjectTimeReportPdfService } from '../projects/services/project-time-report-pdf.service';
import { InvoicePdfService } from '../services/invoice-pdf.service';

/**
 * Resolves email PDF attachments only after verifying the storage key belongs to
 * a tenant-scoped invoice, void, or credit document (or its time report).
 */
@Injectable()
export class BillingEmailAttachmentResolver implements EmailAttachmentResolver {
  constructor(
    private readonly invoicePdfService: InvoicePdfService,
    private readonly timeReportPdfService: ProjectTimeReportPdfService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly voidDocumentsRepository: InvoiceVoidDocumentsRepository,
    private readonly creditDocumentsRepository: InvoiceCreditDocumentsRepository,
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
    const authorized = await this.isAuthorizedStorageKey(ref.storageKey);

    if (!authorized) {
      throw new Error('Email attachment storage key is not authorized for this tenant');
    }

    if (ref.filename.startsWith('time-report-')) {
      return await this.timeReportPdfService.readPdf(ref.storageKey);
    }

    return await this.invoicePdfService.readPdf(ref.storageKey);
  }

  private async isAuthorizedStorageKey(storageKey: string): Promise<boolean> {
    if (await this.invoicesRepository.existsAuthorizedByPdfOrTimeReportStorageKey(storageKey)) {
      return true;
    }

    if (await this.voidDocumentsRepository.existsAuthorizedByPdfStorageKey(storageKey)) {
      return true;
    }

    return await this.creditDocumentsRepository.existsAuthorizedByPdfStorageKey(storageKey);
  }
}
