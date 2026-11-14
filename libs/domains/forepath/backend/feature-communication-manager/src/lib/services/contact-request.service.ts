import { incrementCounter } from '@forepath/shared/backend/util-otel/metrics';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

import { ContactRequestResponseDto } from '../dto/contact-request-response.dto';
import { CreateContactRequestDto } from '../dto/create-contact-request.dto';
import { ChatwootContactListItem } from '../types/chatwoot.types';
import { resolveContactSourceId } from '../utils/chatwoot-contact-resolver.utils';
import { formatContactRequestMessage } from '../utils/contact-message-formatter.utils';

import { ChatwootApiError, ChatwootApiService } from './chatwoot-api.service';

@Injectable()
export class ContactRequestService {
  private readonly logger = new Logger(ContactRequestService.name);
  private readonly otelMeterName = 'forepath.communication';

  constructor(private readonly chatwootApiService: ChatwootApiService) {}

  async submitContactRequest(dto: CreateContactRequestDto): Promise<ContactRequestResponseDto> {
    if (!this.chatwootApiService.isConfigured()) {
      this.logger.error('Contact request rejected because Chatwoot is not configured');
      this.recordContactRequestOutcome('not_configured');
      throw new BadGatewayException('Unable to submit request');
    }

    try {
      const contact = await this.findOrCreateContact(dto);
      const inboxId = this.chatwootApiService.getInboxId();
      const sourceId = await this.resolveOrCreateSourceId(contact, inboxId);
      const messageContent = formatContactRequestMessage({
        name: dto.name,
        email: dto.email,
        message: dto.message,
        phone: dto.phone,
        company: dto.company,
      });
      const conversationId = await this.chatwootApiService.createConversation({
        source_id: sourceId,
        contact_id: contact.id,
        status: 'open',
        message: { content: messageContent },
      });

      this.recordContactRequestOutcome('success');

      return {
        accepted: true,
        referenceId: String(conversationId),
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      if (error instanceof ChatwootApiError) {
        this.logger.error(`Chatwoot error while submitting contact request: ${error.message}`);
        this.recordContactRequestOutcome('chatwoot_error');
        throw new BadGatewayException('Unable to submit request');
      }

      this.logger.error('Unexpected error while submitting contact request', error);
      this.recordContactRequestOutcome('chatwoot_error');
      throw new BadGatewayException('Unable to submit request');
    }
  }

  private async findOrCreateContact(dto: CreateContactRequestDto): Promise<ChatwootContactListItem> {
    const byEmail = await this.chatwootApiService.searchContacts(dto.email.trim());
    const emailMatch = this.pickBestMatch(byEmail, dto.email.trim(), dto.phone?.trim());

    if (emailMatch) {
      this.recordContactResolutionPath('existing_email');

      return emailMatch;
    }

    if (dto.phone?.trim()) {
      const byPhone = await this.chatwootApiService.searchContacts(dto.phone.trim());
      const phoneMatch = this.pickBestMatch(byPhone, dto.email.trim(), dto.phone.trim());

      if (phoneMatch) {
        this.recordContactResolutionPath('existing_phone');

        return phoneMatch;
      }
    }

    const customAttributes = dto.company?.trim() ? { company: dto.company.trim() } : undefined;
    const createdContact = await this.chatwootApiService.createContact({
      name: dto.name.trim(),
      email: dto.email.trim(),
      phone_number: dto.phone?.trim() || undefined,
      custom_attributes: customAttributes,
    });

    this.recordContactResolutionPath('new_contact');

    return createdContact;
  }

  private pickBestMatch(
    contacts: ChatwootContactListItem[],
    email: string,
    phone?: string,
  ): ChatwootContactListItem | null {
    const normalizedEmail = email.toLowerCase();
    const emailMatch = contacts.find((contact) => contact.email?.toLowerCase() === normalizedEmail);

    if (emailMatch) {
      return emailMatch;
    }

    if (phone) {
      return contacts.find((contact) => contact.phone_number === phone) ?? null;
    }

    return null;
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

  private recordContactRequestOutcome(outcome: string): void {
    incrementCounter(this.otelMeterName, 'communication.contact_requests', { outcome });
  }

  private recordContactResolutionPath(path: string): void {
    incrementCounter(this.otelMeterName, 'communication.contact_resolution', { path });
  }
}
