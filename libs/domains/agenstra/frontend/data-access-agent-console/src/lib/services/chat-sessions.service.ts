import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  ChatSessionMessageResponseDto,
  ChatSessionResponseDto,
  CreateChatSessionDto,
  ListChatSessionsParams,
  UpdateChatSessionDto,
} from '../state/chat-sessions/chat-sessions.types';

@Injectable({
  providedIn: 'root',
})
export class ChatSessionsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  listChatSessions(
    clientId: string,
    agentId: string,
    params?: ListChatSessionsParams,
  ): Observable<ChatSessionResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<ChatSessionResponseDto[]>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/chats`, {
      params: httpParams,
    });
  }

  countChatSessions(clientId: string, agentId: string): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/chats/count`);
  }

  createChatSession(
    clientId: string,
    agentId: string,
    createDto: CreateChatSessionDto = {},
  ): Observable<ChatSessionResponseDto> {
    return this.http.post<ChatSessionResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/chats`,
      createDto,
    );
  }

  getChatSession(clientId: string, agentId: string, chatId: string): Observable<ChatSessionResponseDto> {
    return this.http.get<ChatSessionResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}`,
    );
  }

  updateChatSession(
    clientId: string,
    agentId: string,
    chatId: string,
    updateDto: UpdateChatSessionDto,
  ): Observable<ChatSessionResponseDto> {
    return this.http.put<ChatSessionResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}`,
      updateDto,
    );
  }

  deleteChatSession(clientId: string, agentId: string, chatId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}`);
  }

  listChatSessionMessages(
    clientId: string,
    agentId: string,
    chatId: string,
    params?: ListChatSessionsParams,
  ): Observable<ChatSessionMessageResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<ChatSessionMessageResponseDto[]>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/chats/${chatId}/messages`,
      { params: httpParams },
    );
  }
}
