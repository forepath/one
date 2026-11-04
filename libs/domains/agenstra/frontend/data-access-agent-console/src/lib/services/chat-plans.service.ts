import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  ChatPlanActivityDto,
  ChatPlanListResponseDto,
  ChatPlansQuery,
  UpdateChatPlanDto,
} from '../state/chat-plans/chat-plans.types';
import type { ChatPlanResponse } from '../state/container-socket/container-socket.types';

/** Chat plans of an agent (agent-controller REST) for the plans page. Plan commands stay on the clients socket. */
@Injectable({
  providedIn: 'root',
})
export class ChatPlansService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  /** Newest first; `search` matches title, original request and plan body. */
  listPlans(clientId: string, agentId: string, query: ChatPlansQuery): Observable<ChatPlanListResponseDto> {
    let params = new HttpParams().set('limit', String(query.limit)).set('offset', String(query.offset));

    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }

    if (query.state) {
      params = params.set('state', query.state);
    }

    return this.http.get<ChatPlanListResponseDto>(`${this.agentUrl(clientId, agentId)}/plans`, { params });
  }

  getPlan(clientId: string, agentId: string, planId: string): Observable<ChatPlanResponse> {
    return this.http.get<ChatPlanResponse>(this.planUrl(clientId, agentId, planId));
  }

  updatePlan(clientId: string, agentId: string, planId: string, dto: UpdateChatPlanDto): Observable<ChatPlanResponse> {
    return this.http.patch<ChatPlanResponse>(this.planUrl(clientId, agentId, planId), dto);
  }

  listActivity(
    clientId: string,
    agentId: string,
    planId: string,
    options: { limit?: number; offset?: number } = {},
  ): Observable<ChatPlanActivityDto[]> {
    let params = new HttpParams();

    if (options.limit !== undefined) {
      params = params.set('limit', String(options.limit));
    }

    if (options.offset) {
      params = params.set('offset', String(options.offset));
    }

    return this.http.get<ChatPlanActivityDto[]>(`${this.planUrl(clientId, agentId, planId)}/activity`, { params });
  }

  private agentUrl(clientId: string, agentId: string): string {
    return `${this.apiUrl}/clients/${clientId}/agents/${agentId}`;
  }

  private planUrl(clientId: string, agentId: string, planId: string): string {
    return `${this.agentUrl(clientId, agentId)}/plans/${planId}`;
  }
}
