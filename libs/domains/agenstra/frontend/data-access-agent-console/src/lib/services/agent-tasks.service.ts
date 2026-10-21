import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AgentTaskDetailResponseDto,
  AgentTaskResponseDto,
  AgentTaskRunNowResponseDto,
  AgentTaskRunResponseDto,
  CreateAgentTaskDto,
  UpdateAgentTaskDto,
} from '../state/agent-tasks/agent-tasks.types';

/** Recurring agent tasks of a workspace (agent-controller REST). */
@Injectable({
  providedIn: 'root',
})
export class AgentTasksService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  listTasks(clientId: string, agentId?: string): Observable<AgentTaskResponseDto[]> {
    let params = new HttpParams();

    if (agentId) {
      params = params.set('agentId', agentId);
    }

    return this.http.get<AgentTaskResponseDto[]>(`${this.apiUrl}/clients/${clientId}/agent-tasks`, { params });
  }

  getTask(clientId: string, agentId: string, taskId: string): Observable<AgentTaskDetailResponseDto> {
    return this.http.get<AgentTaskDetailResponseDto>(this.taskUrl(clientId, agentId, taskId));
  }

  createTask(clientId: string, agentId: string, dto: CreateAgentTaskDto): Observable<AgentTaskResponseDto> {
    return this.http.post<AgentTaskResponseDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/tasks`, dto);
  }

  updateTask(
    clientId: string,
    agentId: string,
    taskId: string,
    dto: UpdateAgentTaskDto,
  ): Observable<AgentTaskResponseDto> {
    return this.http.patch<AgentTaskResponseDto>(this.taskUrl(clientId, agentId, taskId), dto);
  }

  deleteTask(clientId: string, agentId: string, taskId: string): Observable<void> {
    return this.http.delete<void>(this.taskUrl(clientId, agentId, taskId));
  }

  /** Runs newest first; `limit` / `offset` page the session history, `includeTranscript` adds its chat events. */
  listRuns(
    clientId: string,
    agentId: string,
    taskId: string,
    options: { limit?: number; offset?: number; includeTranscript?: boolean } = {},
  ): Observable<AgentTaskRunResponseDto[]> {
    let params = new HttpParams();

    if (options.limit !== undefined) {
      params = params.set('limit', String(options.limit));
    }

    if (options.offset) {
      params = params.set('offset', String(options.offset));
    }

    if (options.includeTranscript) {
      params = params.set('includeTranscript', 'true');
    }

    return this.http.get<AgentTaskRunResponseDto[]>(`${this.taskUrl(clientId, agentId, taskId)}/runs`, { params });
  }

  runNow(clientId: string, agentId: string, taskId: string): Observable<AgentTaskRunNowResponseDto> {
    return this.http.post<AgentTaskRunNowResponseDto>(`${this.taskUrl(clientId, agentId, taskId)}/runs`, {});
  }

  private taskUrl(clientId: string, agentId: string, taskId: string): string {
    return `${this.apiUrl}/clients/${clientId}/agents/${agentId}/tasks/${taskId}`;
  }
}
