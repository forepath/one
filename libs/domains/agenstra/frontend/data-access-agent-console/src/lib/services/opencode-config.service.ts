import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

export interface InheritedAdditiveDto {
  path: string;
  keys?: string[];
  items?: unknown[];
}

export interface OpencodeConfigDto {
  config: Record<string, unknown>;
  /** Raw JSON overrides for this layer (merged over `config`). */
  overrides?: Record<string, unknown>;
  secretKeys: string[];
  effective?: Record<string, unknown>;
  lockedPaths?: string[];
  inheritedAdditive?: InheritedAdditiveDto[];
  updatedAt?: string;
}

export interface UpsertOpencodeConfigPayload {
  config?: Record<string, unknown> | null;
  /** Raw JSON patch merged over `config`; empty object clears overrides when provided. */
  overrides?: Record<string, unknown> | null;
  secrets?: Record<string, string> | null;
}

export interface OpencodeAgentInfoDto {
  name: string;
  description?: string;
  mode: 'subagent' | 'primary' | 'all';
  builtIn: boolean;
  prompt?: string;
  model?: {
    modelID: string;
    providerID: string;
  };
  temperature?: number;
  color?: string;
}

export interface OpencodeAgentsListDto {
  agents: OpencodeAgentInfoDto[];
}

export interface OpencodeCommandInfoDto {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  source?: 'command' | 'mcp' | 'skill';
}

export interface OpencodeCommandsListDto {
  commands: OpencodeCommandInfoDto[];
}

export interface OpencodeProviderDto {
  id: string;
  name: string;
  env: string[];
  models: Array<{ id: string; name: string }>;
  npm?: string;
  api?: string;
}

export interface OpencodeProvidersListDto {
  providers: OpencodeProviderDto[];
}

@Injectable({ providedIn: 'root' })
export class OpencodeConfigService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  listProviders(): Observable<OpencodeProvidersListDto> {
    return this.http.get<OpencodeProvidersListDto>(`${this.apiUrl}/opencode-providers`);
  }

  getGlobal(): Observable<OpencodeConfigDto> {
    return this.http.get<OpencodeConfigDto>(`${this.apiUrl}/admin/opencode-config`);
  }

  putGlobal(payload: UpsertOpencodeConfigPayload): Observable<OpencodeConfigDto> {
    return this.http.put<OpencodeConfigDto>(`${this.apiUrl}/admin/opencode-config`, payload);
  }

  getWorkspace(clientId: string): Observable<OpencodeConfigDto> {
    return this.http.get<OpencodeConfigDto>(`${this.apiUrl}/clients/${clientId}/opencode-config`);
  }

  putWorkspace(clientId: string, payload: UpsertOpencodeConfigPayload): Observable<OpencodeConfigDto> {
    return this.http.put<OpencodeConfigDto>(`${this.apiUrl}/clients/${clientId}/opencode-config`, payload);
  }

  getAgent(clientId: string, agentId: string): Observable<OpencodeConfigDto> {
    return this.http.get<OpencodeConfigDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode-config`);
  }

  putAgent(clientId: string, agentId: string, payload: UpsertOpencodeConfigPayload): Observable<OpencodeConfigDto> {
    return this.http.put<OpencodeConfigDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode-config`,
      payload,
    );
  }

  listAgentAgents(clientId: string, agentId: string): Observable<OpencodeAgentsListDto> {
    return this.http.get<OpencodeAgentsListDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode-config/agents`,
    );
  }

  listAgentCommands(clientId: string, agentId: string): Observable<OpencodeCommandsListDto> {
    return this.http.get<OpencodeCommandsListDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode-config/commands`,
    );
  }
}
