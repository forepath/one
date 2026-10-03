import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
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
  /** Explicit locks authored on this layer (global / workspace). */
  locks?: string[];
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
  /** Explicit locks for lower layers (global / workspace only). */
  locks?: string[] | null;
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

export type OpencodeMcpRuntimeStatus = 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration';

export interface OpencodeMcpServerStatusDto {
  name: string;
  status: OpencodeMcpRuntimeStatus;
  error?: string;
}

export interface OpencodeMcpStatusListDto {
  servers: OpencodeMcpServerStatusDto[];
}

export interface OpencodeMcpAuthStartDto {
  authorizationUrl: string;
  oauthState?: string;
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
  total: number;
  limit: number;
  offset: number;
}

export interface OpencodeCatalogListParams {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface OpencodeMcpServerDto {
  name: string;
  title: string;
  description: string;
  version: string;
  status: string;
  websiteUrl?: string;
  packages: unknown[];
  remotes: unknown[];
  repository?: Record<string, unknown>;
  publishedAt?: string;
  registryUpdatedAt?: string;
}

export interface OpencodeMcpServersListDto {
  servers: OpencodeMcpServerDto[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable({ providedIn: 'root' })
export class OpencodeConfigService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  listProviders(params?: OpencodeCatalogListParams): Observable<OpencodeProvidersListDto> {
    return this.http.get<OpencodeProvidersListDto>(`${this.apiUrl}/opencode/providers`, {
      params: this.catalogListParams(params),
    });
  }

  getProvider(id: string): Observable<OpencodeProviderDto> {
    return this.http.get<OpencodeProviderDto>(`${this.apiUrl}/opencode/providers/${encodeURIComponent(id)}`);
  }

  listMcpServers(params?: OpencodeCatalogListParams): Observable<OpencodeMcpServersListDto> {
    return this.http.get<OpencodeMcpServersListDto>(`${this.apiUrl}/opencode/mcp-servers`, {
      params: this.catalogListParams(params),
    });
  }

  getMcpServer(name: string): Observable<OpencodeMcpServerDto> {
    return this.http.get<OpencodeMcpServerDto>(`${this.apiUrl}/opencode/mcp-servers/${encodeURIComponent(name)}`);
  }

  private catalogListParams(params?: OpencodeCatalogListParams): HttpParams {
    let httpParams = new HttpParams();
    const search = params?.search?.trim();

    if (search) {
      httpParams = httpParams.set('search', search);
    }

    if (params?.limit != null) {
      httpParams = httpParams.set('limit', String(params.limit));
    }

    if (params?.offset != null) {
      httpParams = httpParams.set('offset', String(params.offset));
    }

    return httpParams;
  }

  getGlobal(): Observable<OpencodeConfigDto> {
    return this.http.get<OpencodeConfigDto>(`${this.apiUrl}/admin/opencode/config`);
  }

  putGlobal(payload: UpsertOpencodeConfigPayload): Observable<OpencodeConfigDto> {
    return this.http.put<OpencodeConfigDto>(`${this.apiUrl}/admin/opencode/config`, payload);
  }

  getWorkspace(clientId: string): Observable<OpencodeConfigDto> {
    return this.http.get<OpencodeConfigDto>(`${this.apiUrl}/clients/${clientId}/opencode/config`);
  }

  putWorkspace(clientId: string, payload: UpsertOpencodeConfigPayload): Observable<OpencodeConfigDto> {
    return this.http.put<OpencodeConfigDto>(`${this.apiUrl}/clients/${clientId}/opencode/config`, payload);
  }

  getAgent(clientId: string, agentId: string): Observable<OpencodeConfigDto> {
    return this.http.get<OpencodeConfigDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/config`);
  }

  putAgent(clientId: string, agentId: string, payload: UpsertOpencodeConfigPayload): Observable<OpencodeConfigDto> {
    return this.http.put<OpencodeConfigDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/config`,
      payload,
    );
  }

  listAgentAgents(clientId: string, agentId: string): Observable<OpencodeAgentsListDto> {
    return this.http.get<OpencodeAgentsListDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/config/agents`,
    );
  }

  listAgentCommands(clientId: string, agentId: string): Observable<OpencodeCommandsListDto> {
    return this.http.get<OpencodeCommandsListDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/config/commands`,
    );
  }

  listAgentMcpStatuses(clientId: string, agentId: string): Observable<OpencodeMcpStatusListDto> {
    return this.http.get<OpencodeMcpStatusListDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/mcp`);
  }

  startAgentMcpAuth(clientId: string, agentId: string, name: string): Observable<OpencodeMcpAuthStartDto> {
    return this.http.post<OpencodeMcpAuthStartDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/mcp/${encodeURIComponent(name)}/auth`,
      {},
    );
  }

  completeAgentMcpAuth(
    clientId: string,
    agentId: string,
    name: string,
    code: string,
  ): Observable<OpencodeMcpServerStatusDto> {
    return this.http.post<OpencodeMcpServerStatusDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/mcp/${encodeURIComponent(name)}/auth/callback`,
      { code },
    );
  }

  removeAgentMcpAuth(clientId: string, agentId: string, name: string): Observable<{ success: true }> {
    return this.http.delete<{ success: true }>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/opencode/mcp/${encodeURIComponent(name)}/auth`,
    );
  }
}
