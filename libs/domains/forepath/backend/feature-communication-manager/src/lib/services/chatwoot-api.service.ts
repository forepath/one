import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { CHATWOOT_API_TIMEOUT_MS } from '../constants/chatwoot-api.constants';
import {
  ChatwootContactsSearchResponse,
  ChatwootCreateContactPayload,
  ChatwootCreateContactResponse,
  ChatwootCreateContactInboxResponse,
  ChatwootCreateConversationPayload,
  ChatwootCreateConversationResponse,
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
    const response = await this.request<ChatwootCreateConversationResponse>(
      'POST',
      `/api/v1/accounts/${this.accountId}/conversations`,
      {
        inbox_id: this.inboxId,
        ...payload,
      },
    );

    if (!response.id) {
      throw new ChatwootApiError('Chatwoot create conversation response did not include a conversation id');
    }

    return response.id;
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

      if (response.status >= 400) {
        this.logger.error(`Chatwoot API ${method} ${path} failed with status ${response.status}`);
        throw new ChatwootApiError('Chatwoot API request failed', response.status);
      }

      return response.data;
    } catch (error) {
      if (error instanceof ChatwootApiError) {
        throw error;
      }

      const axiosError = error as AxiosError;

      this.logger.error(`Chatwoot API ${method} ${path} error: ${axiosError.message}`);
      throw new ChatwootApiError('Chatwoot API request failed');
    }
  }
}
