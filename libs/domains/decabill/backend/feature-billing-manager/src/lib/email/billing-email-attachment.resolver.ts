import { Injectable } from '@nestjs/common';
import type { EmailAttachmentRef, EmailAttachmentResolver } from '@forepath/shared/backend';

import { ProjectTimeReportPdfService } from '../projects/services/project-time-report-pdf.service';
import { InvoicePdfService } from '../services/invoice-pdf.service';

@Injectable()
export class BillingEmailAttachmentResolver implements EmailAttachmentResolver {
  constructor(
    private readonly invoicePdfService: InvoicePdfService,
    private readonly timeReportPdfService: ProjectTimeReportPdfService,
  ) {}

  async resolve(refs: EmailAttachmentRef[]): Promise<Array<{ filename: string; content: Buffer }>> {
    const attachments: Array<{ filename: string; content: Buffer }> = [];

    for (const ref of refs) {
      const content = await this.readAttachment(ref);
      attachments.push({ filename: ref.filename, content });
    }

    return attachments;
  }

  private async readAttachment(ref: EmailAttachmentRef): Promise<Buffer> {
    if (ref.filename.startsWith('time-report-')) {
      return await this.timeReportPdfService.readPdf(ref.storageKey);
    }

    return await this.invoicePdfService.readPdf(ref.storageKey);
  }
}
