import { incrementCounter } from '@forepath/shared/backend/util-otel/metrics';
import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  CONTENT_REPORT_ANONYMOUS_CONTACT_EMAIL,
  CONTENT_REPORT_ANONYMOUS_CONTACT_NAME,
  CONTENT_REPORT_PDF_MIME,
} from '../constants/content-report.constants';
import { ContentReportResponseDto } from '../dto/content-report-response.dto';
import { CreateContentReportDto } from '../dto/create-content-report.dto';
import { ChatwootContactListItem } from '../types/chatwoot.types';
import { resolveContactSourceId } from '../utils/chatwoot-contact-resolver.utils';
import { formatContentReportMessage } from '../utils/content-report-message-formatter.utils';
import { assertValidPdfFile, mapPdfValidationError, type UploadedPdfFile } from '../utils/pdf-file.utils';

import { ChatwootApiError, ChatwootApiService } from './chatwoot-api.service';

@Injectable()
export class ContentReportService {
  private readonly logger = new Logger(ContentReportService.name);
  private readonly otelMeterName = 'forepath.communication';

  constructor(private readonly chatwootApiService: ChatwootApiService) {}

  async submitContentReport(
    dto: CreateContentReportDto,
    removalOrderPdf?: UploadedPdfFile,
  ): Promise<ContentReportResponseDto> {
    this.assertReportBusinessRules(dto, removalOrderPdf);

    if (!this.chatwootApiService.isConfigured()) {
      this.logger.error('Content report rejected because Chatwoot is not configured');
      this.recordContentReportOutcome('not_configured');
      throw new BadGatewayException('Unable to submit request');
    }

    try {
      const contact = await this.findOrCreateContact(dto);
      const inboxId = this.chatwootApiService.getInboxId();
      const sourceId = await this.resolveOrCreateSourceId(contact, inboxId);
      const messageContent = formatContentReportMessage(dto);
      const attachPdfToIncomingMessage = dto.reportType === 'tco' && Boolean(removalOrderPdf);
      const conversationId = await this.chatwootApiService.createConversation({
        source_id: sourceId,
        contact_id: contact.id,
        status: 'open',
        ...(attachPdfToIncomingMessage ? {} : { message: { content: messageContent } }),
      });

      if (attachPdfToIncomingMessage && removalOrderPdf) {
        await this.chatwootApiService.createMessage(conversationId, {
          content: messageContent,
          message_type: 'incoming',
          private: false,
          attachments: [
            {
              buffer: removalOrderPdf.buffer,
              filename: removalOrderPdf.originalname,
              contentType: CONTENT_REPORT_PDF_MIME,
            },
          ],
        });
      }

      this.recordContentReportOutcome('success');

      return {
        accepted: true,
        referenceId: String(conversationId),
      };
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof ChatwootApiError) {
        this.logger.error(`Chatwoot error while submitting content report: ${error.message}`);
        this.recordContentReportOutcome('chatwoot_error');
        throw new BadGatewayException('Unable to submit request');
      }

      this.logger.error('Unexpected error while submitting content report', error);
      this.recordContentReportOutcome('chatwoot_error');
      throw new BadGatewayException('Unable to submit request');
    }
  }

  private assertReportBusinessRules(dto: CreateContentReportDto, removalOrderPdf?: UploadedPdfFile): void {
    if (dto.reportType === 'dsa') {
      if (removalOrderPdf) {
        throw new BadRequestException(mapPdfValidationError('PDF_NOT_ALLOWED'));
      }

      if (!dto.goodFaithConfirmed) {
        throw new BadRequestException('Good-faith confirmation is required for DSA notices');
      }

      return;
    }

    if (!dto.authorityAttestation) {
      throw new BadRequestException('Authority attestation is required for TCO removal orders');
    }

    try {
      assertValidPdfFile(removalOrderPdf);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'PDF_REQUIRED';

      throw new BadRequestException(mapPdfValidationError(code));
    }
  }

  private async findOrCreateContact(dto: CreateContentReportDto): Promise<ChatwootContactListItem> {
    const anonymous = dto.reportType === 'dsa' && Boolean(dto.csamAnonymous);
    const email = anonymous ? CONTENT_REPORT_ANONYMOUS_CONTACT_EMAIL : (dto.email ?? '').trim().toLowerCase();
    const name = anonymous ? CONTENT_REPORT_ANONYMOUS_CONTACT_NAME : (dto.name ?? '').trim();
    const byEmail = await this.chatwootApiService.searchContacts(email);
    const emailMatch = this.pickExactEmailMatch(byEmail, email);

    if (emailMatch) {
      this.recordContactResolutionPath('existing_email');

      return emailMatch;
    }

    const createdContact = await this.chatwootApiService.createContact({
      name,
      email,
      custom_attributes: {
        report_type: dto.reportType,
        channel: 'content_report',
      },
    });

    this.recordContactResolutionPath('new_contact');

    return createdContact;
  }

  private pickExactEmailMatch(contacts: ChatwootContactListItem[], email: string): ChatwootContactListItem | null {
    const normalizedEmail = email.toLowerCase();

    return contacts.find((contact) => contact.email?.toLowerCase() === normalizedEmail) ?? null;
  }

  private async resolveOrCreateSourceId(contact: ChatwootContactListItem, inboxId: number): Promise<string> {
    const existingSourceId = resolveContactSourceId(contact, inboxId);

    if (existingSourceId) {
      this.recordContactResolutionPath('reused_source_id');

      return existingSourceId;
    }

    this.logger.log(`Linking contact ${contact.id} to inbox ${inboxId} via contact_inboxes API`);

    const contactInbox = await this.chatwootApiService.createContactInbox(contact.id);

    this.recordContactResolutionPath('created_source_id');

    return contactInbox.source_id;
  }

  private recordContentReportOutcome(outcome: string): void {
    incrementCounter(this.otelMeterName, 'communication.content_reports', { outcome });
  }

  private recordContactResolutionPath(path: string): void {
    incrementCounter(this.otelMeterName, 'communication.contact_resolution', { path });
  }
}
