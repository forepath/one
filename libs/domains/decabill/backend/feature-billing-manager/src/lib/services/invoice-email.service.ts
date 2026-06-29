import { UsersRepository } from '@forepath/identity/backend';
import { EmailService } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';

import { ProjectTimeReportPdfService } from '../projects/services/project-time-report-pdf.service';

import { buildIssuedInvoiceEmailContent, buildVoidDocumentEmailContent } from './invoice-email-message.util';
import { InvoicePdfService } from './invoice-pdf.service';

@Injectable()
export class InvoiceEmailService {
  private readonly logger = new Logger(InvoiceEmailService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly timeReportPdfService: ProjectTimeReportPdfService,
  ) {}

  async notifyInvoiceIssued(invoice: InvoiceEntity, pdfStorageKey: string): Promise<boolean> {
    if (!this.emailService.isEnabled()) {
      this.logger.warn('Email service is disabled, skipping invoice notification');

      return false;
    }

    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);
    const email = await this.resolveRecipientEmail(invoice.userId, profile);

    if (!email) {
      this.logger.warn(`No billing email found for user ${invoice.userId}, skipping invoice notification`);

      return false;
    }

    if (!invoice.invoiceNumber) {
      this.logger.debug(`Invoice ${invoice.id} has no invoice number, skipping invoice notification`);

      return false;
    }

    const pdfBuffer = await this.invoicePdfService.readPdf(pdfStorageKey);
    const content = buildIssuedInvoiceEmailContent({
      recipient: profile ?? {},
      invoiceNumber: invoice.invoiceNumber,
      totalGross: Number(invoice.totalGross),
      currency: invoice.currency,
      dueDate: invoice.dueDate,
    });
    const attachments = [{ filename: content.attachmentFilename, content: pdfBuffer }];

    if (invoice.timeReportStorageKey) {
      const timeReportBuffer = await this.timeReportPdfService.readPdf(invoice.timeReportStorageKey);

      attachments.push({
        filename: `time-report-${invoice.invoiceNumber}.pdf`,
        content: timeReportBuffer,
      });
    }

    return await this.sendDocumentEmail(email, content, attachments, `invoice ${invoice.invoiceNumber}`);
  }

  async notifyVoidDocument(invoice: InvoiceEntity, pdfStorageKey: string, creditNoteNumber: string): Promise<boolean> {
    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);
    const email = await this.resolveRecipientEmail(invoice.userId, profile);

    if (!email) {
      this.logger.warn(`No billing email found for user ${invoice.userId}, skipping void document notification`);

      return false;
    }

    if (!invoice.invoiceNumber) {
      this.logger.debug(`Invoice ${invoice.id} has no invoice number, skipping void document notification`);

      return false;
    }

    const pdfBuffer = await this.invoicePdfService.readPdf(pdfStorageKey);
    const content = buildVoidDocumentEmailContent({
      recipient: profile,
      invoiceNumber: invoice.invoiceNumber,
      creditNoteNumber,
    });

    return await this.sendDocumentEmail(
      email,
      content,
      [{ filename: content.attachmentFilename, content: pdfBuffer }],
      `credit note ${creditNoteNumber}`,
    );
  }

  async sendDocumentEmail(
    to: string,
    content: { subject: string; text: string; html: string; attachmentFilename: string },
    pdfBuffers: Array<{ filename: string; content: Buffer }>,
    documentLabel: string,
  ): Promise<boolean> {
    const sent = await this.emailService.send({
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      attachments: pdfBuffers.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
      })),
    });

    if (sent) {
      this.logger.log(`Sent ${documentLabel} email to ${to}`);
    }

    if (!sent) {
      this.logger.warn(`Failed to send ${documentLabel} email to ${to}`);
    }

    return sent;
  }

  private async resolveRecipientEmail(
    userId: string,
    profile: CustomerProfileEntity | null,
  ): Promise<string | undefined> {
    const profileEmail = profile?.email?.trim();

    if (profileEmail) {
      return profileEmail;
    }

    const user = await this.usersRepository.findByIdForTenant(userId);

    return user?.email?.trim();
  }
}
