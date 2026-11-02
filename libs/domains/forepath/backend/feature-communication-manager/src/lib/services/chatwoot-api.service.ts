import { randomUUID } from 'node:crypto';

import { incrementCounter, recordHistogram } from '@forepath/shared/backend/util-otel/metrics';
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FormData = require('form-data');

import { CHATWOOT_API_TIMEOUT_MS } from '../constants/chatwoot-api.constants';
import {
  ChatwootContactsSearchResponse,
  ChatwootCreateContactPayload,
  ChatwootCreateContactResponse,
  ChatwootCreateContactInboxResponse,
  ChatwootCreateConversationPayload,
  ChatwootCreateConversationResponse,
  ChatwootCreateMessagePayload,
  ChatwootCreateMessageResponse,
  ChatwootContactListItem,
} from '../types/chatwoot.types';
import { resolveCreatedContact } from '../utils/chatwoot-contact-resolver.utils';

export class ChatwootApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ChatwootApiError';
  }
}

@Injectable()
export class ChatwootApiService {
  private readonly logger = new Logger(ChatwootApiService.name);
  private readonly otelMeterName = 'forepath.communication';
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly accountId: number;
  private readonly inboxId: number;

  constructor() {
    this.baseUrl = (process.env.CHATWOOT_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiToken = process.env.CHATWOOT_API_ACCESS_TOKEN ?? '';
    this.accountId = parseInt(process.env.CHATWOOT_ACCOUNT_ID ?? '', 10);
    this.inboxId = parseInt(process.env.CHATWOOT_INBOX_ID ?? '', 10);

    if (!this.isConfigured()) {
      this.logger.warn('Chatwoot API is not fully configured. Contact requests will fail until env vars are set.');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiToken && Number.isFinite(this.accountId) && Number.isFinite(this.inboxId));
  }

  getInboxId(): number {
    return this.inboxId;
  }

  async searchContacts(query: string): Promise<ChatwootContactListItem[]> {
    const response = await this.request<ChatwootContactsSearchResponse>(
      'GET',
      `/api/v1/accounts/${this.accountId}/contacts/search`,
      undefined,
      { q: query },
    );

    return response.payload ?? [];
  }

  async createContact(payload: Omit<ChatwootCreateContactPayload, 'inbox_id'>): Promise<ChatwootContactListItem> {
    const response = await this.request<ChatwootCreateContactResponse>(
      'POST',
      `/api/v1/accounts/${this.accountId}/contacts`,
      {
        inbox_id: this.inboxId,
        ...payload,
      },
    );

    const contact = resolveCreatedContact(response);

    if (!contact?.id) {
      throw new ChatwootApiError('Chatwoot create contact response did not include a contact id');
    }

    return contact;
  }

  async createContactInbox(
    contactId: number,
    sourceId: string = randomUUID(),
  ): Promise<ChatwootCreateContactInboxResponse> {
    const response = await this.request<ChatwootCreateContactInboxResponse>(
      'POST',
      `/api/v1/accounts/${this.accountId}/contacts/${contactId}/contact_inboxes`,
      {
        inbox_id: this.inboxId,
        source_id: sourceId,
      },
    );

    if (!response.source_id) {
      throw new ChatwootApiError('Chatwoot create contact inbox response did not include source_id');
    }

    return response;
  }

  async createConversation(payload: Omit<ChatwootCreateConversationPayload, 'inbox_id'>): Promise<number> {
    // Chatwoot's MessageBuilder defaults the initial message to `outgoing`, which attributes it
    // to the API token's agent instead of the contact. Mark it as incoming unless stated otherwise.
    const message = payload.message ? { message_type: 'incoming' as const, ...payload.message } : undefined;

    const response = await this.request<ChatwootCreateConversationResponse>(
      'POST',
      `/api/v1/accounts/${this.accountId}/conversations`,
      {
        inbox_id: this.inboxId,
        ...payload,
        ...(message ? { message } : {}),
      },
    );

    if (!response.id) {
      throw new ChatwootApiError('Chatwoot create conversation response did not include a conversation id');
    }

    return response.id;
  }

  async createMessage(conversationId: number, payload: ChatwootCreateMessagePayload): Promise<number> {
    const path = `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`;
    const hasAttachments = Boolean(payload.attachments?.length);

    if (!hasAttachments) {
      const response = await this.request<ChatwootCreateMessageResponse>('POST', path, {
        content: payload.content,
        message_type: payload.message_type ?? 'incoming',
        private: payload.private ?? false,
      });

      if (!response.id) {
        throw new ChatwootApiError('Chatwoot create message response did not include a message id');
      }

      return response.id;
    }

    if (!this.isConfigured()) {
      throw new ChatwootApiError('Chatwoot API is not configured');
    }

    const form = new FormData();
    form.append('content', payload.content);
    form.append('message_type', payload.message_type ?? 'incoming');

    // Chatwoot's MessageBuilder uses `params[:private] || false`. The string "false"
    // is truthy in Ruby and would mark the message as a private agent note.
    if (payload.private) {
      form.append('private', 'true');
    }

    for (const attachment of payload.attachments ?? []) {
      form.append('attachments[]', attachment.buffer, {
        filename: attachment.filename,
        contentType: attachment.contentType,
      });
    }

    const operation = 'create_message';
    const startedAt = Date.now();

    try {
      const response = await axios.request<ChatwootCreateMessageResponse>({
        method: 'POST',
        url: `${this.baseUrl}${path}`,
        data: form,
        timeout: CHATWOOT_API_TIMEOUT_MS,
        headers: {
          api_access_token: this.apiToken,
          ...form.getHeaders(),
        },
        validateStatus: (status) => status < 500,
      });

      this.recordChatwootRequestMetrics(operation, response.status, Date.now() - startedAt);

      if (response.status >= 400) {
        this.logger.error(`Chatwoot API POST ${path} failed with status ${response.status}`);
        throw new ChatwootApiError('Chatwoot API request failed', response.status);
      }

      if (!response.data?.id) {
        throw new ChatwootApiError('Chatwoot create message response did not include a message id');
      }

      return response.data.id;
    } catch (error) {
      if (error instanceof ChatwootApiError) {
        if (error.statusCode != null) {
          this.recordChatwootRequestMetrics(operation, error.statusCode, Date.now() - startedAt);
        } else {
          this.recordChatwootRequestMetrics(operation, undefined, Date.now() - startedAt);
        }

        throw error;
      }

      const axiosError = error as AxiosError;

      this.recordChatwootRequestMetrics(operation, undefined, Date.now() - startedAt);
      this.logger.error(`Chatwoot API POST ${path} error: ${axiosError.message}`);
      throw new ChatwootApiError('Chatwoot API request failed');
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new ChatwootApiError('Chatwoot API is not configured');
    }

    const operation = resolveChatwootOperation(path);
    const startedAt = Date.now();

    try {
      const response = await axios.request<T>({
        method,
        url: `${this.baseUrl}${path}`,
        data: body,
        params,
        timeout: CHATWOOT_API_TIMEOUT_MS,
        headers: {
          api_access_token: this.apiToken,
          'Content-Type': 'application/json',
        },
        validateStatus: (status) => status < 500,
      });

      this.recordChatwootRequestMetrics(operation, response.status, Date.now() - startedAt);

      if (response.status >= 400) {
        this.logger.error(`Chatwoot API ${method} ${path} failed with status ${response.status}`);
        throw new ChatwootApiError('Chatwoot API request failed', response.status);
      }

      return response.data;
    } catch (error) {
      if (error instanceof ChatwootApiError) {
        if (error.statusCode != null) {
          this.recordChatwootRequestMetrics(operation, error.statusCode, Date.now() - startedAt);
        } else {
          this.recordChatwootRequestMetrics(operation, undefined, Date.now() - startedAt);
        }

        throw error;
      }

      const axiosError = error as AxiosError;

      this.recordChatwootRequestMetrics(operation, undefined, Date.now() - startedAt);
      this.logger.error(`Chatwoot API ${method} ${path} error: ${axiosError.message}`);
      throw new ChatwootApiError('Chatwoot API request failed');
    }
  }

  private recordChatwootRequestMetrics(operation: string, statusCode: number | undefined, durationMs: number): void {
    const statusClass = resolveHttpStatusClass(statusCode);

    incrementCounter(this.otelMeterName, 'communication.chatwoot.requests', {
      operation,
      status_class: statusClass,
    });
    recordHistogram(this.otelMeterName, 'communication.chatwoot.request.duration_ms', durationMs, {
      operation,
      status_class: statusClass,
    });
  }
}

function resolveChatwootOperation(path: string): string {
  if (path.includes('/contacts/search')) {
    return 'search_contacts';
  }

  if (path.includes('/contact_inboxes')) {
    return 'create_contact_inbox';
  }

  if (path.includes('/messages')) {
    return 'create_message';
  }

  if (path.includes('/conversations')) {
    return 'create_conversation';
  }

  if (path.includes('/contacts')) {
    return 'create_contact';
  }

  return 'unknown';
}

function resolveHttpStatusClass(statusCode: number | undefined): string {
  if (statusCode == null || !Number.isFinite(statusCode)) {
    return 'error';
  }

  return `${Math.floor(statusCode / 100)}xx`;
}
