import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  TicketAutomationResponseDto,
  TicketAutomationRunResponseDto,
  UpdateTicketAutomationDto,
} from '../state/ticket-automation/ticket-automation.types';
import type {
  CreateTicketDto,
  CreateTicketResultDto,
  ListTicketsParams,
  MigrateTicketDto,
  MigrateTicketResultDto,
  PrototypePromptResponseDto,
  StartBodyGenerationSessionResponseDto,
  TicketActivityResponseDto,
  TicketCommentResponseDto,
  TicketResponseDto,
  UpdateTicketDto,
} from '../state/tickets/tickets.types';

@Injectable({
  providedIn: 'root',
})
export class TicketsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  listTickets(params?: ListTicketsParams): Observable<TicketResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.clientId) {
      httpParams = httpParams.set('clientId', params.clientId);
    }

    if (params?.status) {
      httpParams = httpParams.set('status', params.status);
    }

    if (params?.parentId === null) {
      httpParams = httpParams.set('parentId', 'null');
    } else if (params?.parentId !== undefined) {
      httpParams = httpParams.set('parentId', params.parentId);
    }

    return this.http.get<TicketResponseDto[]>(`${this.apiUrl}/tickets`, { params: httpParams });
  }

  getTicket(id: string, includeDescendants = false): Observable<TicketResponseDto> {
    let params = new HttpParams();

    if (includeDescendants) {
      params = params.set('includeDescendants', 'true');
    }

    return this.http.get<TicketResponseDto>(`${this.apiUrl}/tickets/${id}`, { params });
  }

  createTicket(dto: CreateTicketDto): Observable<CreateTicketResultDto> {
    return this.http.post<CreateTicketResultDto>(`${this.apiUrl}/tickets`, dto);
  }

  updateTicket(id: string, dto: UpdateTicketDto): Observable<TicketResponseDto> {
    return this.http.patch<TicketResponseDto>(`${this.apiUrl}/tickets/${id}`, dto);
  }

  migrateTicket(id: string, dto: MigrateTicketDto): Observable<MigrateTicketResultDto> {
    return this.http.post<MigrateTicketResultDto>(`${this.apiUrl}/tickets/${id}/migrate`, dto);
  }

  deleteTicket(id: string, releaseExternalSyncMarker?: boolean): Observable<void> {
    let params = new HttpParams();

    if (releaseExternalSyncMarker === true) {
      params = params.set('releaseExternalSyncMarker', 'true');
    }

    return this.http.delete<void>(`${this.apiUrl}/tickets/${id}`, { params });
  }

  getPrototypePrompt(id: string): Observable<PrototypePromptResponseDto> {
    return this.http.get<PrototypePromptResponseDto>(`${this.apiUrl}/tickets/${id}/prototype-prompt`);
  }

  listComments(ticketId: string): Observable<TicketCommentResponseDto[]> {
    return this.http.get<TicketCommentResponseDto[]>(`${this.apiUrl}/tickets/${ticketId}/comments`);
  }

  addComment(ticketId: string, body: string): Observable<TicketCommentResponseDto> {
    return this.http.post<TicketCommentResponseDto>(`${this.apiUrl}/tickets/${ticketId}/comments`, { body });
  }

  listActivity(ticketId: string, limit = 50, offset = 0): Observable<TicketActivityResponseDto[]> {
    const params = new HttpParams().set('limit', String(limit)).set('offset', String(offset));

    return this.http.get<TicketActivityResponseDto[]>(`${this.apiUrl}/tickets/${ticketId}/activity`, {
      params,
    });
  }

  startBodyGenerationSession(ticketId: string, agentId?: string): Observable<StartBodyGenerationSessionResponseDto> {
    return this.http.post<StartBodyGenerationSessionResponseDto>(
      `${this.apiUrl}/tickets/${ticketId}/body-generation-sessions`,
      agentId ? { agentId } : {},
    );
  }

  applyGeneratedBody(ticketId: string, generationId: string, content: string): Observable<TicketResponseDto> {
    return this.http.post<TicketResponseDto>(`${this.apiUrl}/tickets/${ticketId}/apply-generated-body`, {
      generationId,
      content,
    });
  }

  getTicketAutomation(ticketId: string): Observable<TicketAutomationResponseDto> {
    return this.http.get<TicketAutomationResponseDto>(`${this.apiUrl}/tickets/${ticketId}/automation`);
  }

  patchTicketAutomation(ticketId: string, dto: UpdateTicketAutomationDto): Observable<TicketAutomationResponseDto> {
    return this.http.patch<TicketAutomationResponseDto>(`${this.apiUrl}/tickets/${ticketId}/automation`, dto);
  }

  approveTicketAutomation(ticketId: string): Observable<TicketAutomationResponseDto> {
    return this.http.post<TicketAutomationResponseDto>(`${this.apiUrl}/tickets/${ticketId}/automation/approve`, {});
  }

  unapproveTicketAutomation(ticketId: string): Observable<TicketAutomationResponseDto> {
    return this.http.post<TicketAutomationResponseDto>(`${this.apiUrl}/tickets/${ticketId}/automation/unapprove`, {});
  }

  listTicketAutomationRuns(ticketId: string): Observable<TicketAutomationRunResponseDto[]> {
    return this.http.get<TicketAutomationRunResponseDto[]>(`${this.apiUrl}/tickets/${ticketId}/automation/runs`);
  }

  getTicketAutomationRun(ticketId: string, runId: string): Observable<TicketAutomationRunResponseDto> {
    return this.http.get<TicketAutomationRunResponseDto>(`${this.apiUrl}/tickets/${ticketId}/automation/runs/${runId}`);
  }

  cancelTicketAutomationRun(ticketId: string, runId: string): Observable<TicketAutomationRunResponseDto> {
    return this.http.post<TicketAutomationRunResponseDto>(
      `${this.apiUrl}/tickets/${ticketId}/automation/runs/${runId}/cancel`,
      {},
    );
  }
}
