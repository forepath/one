import type { TicketStatus } from '../tickets/tickets.types';

export type ExternalImportProviderId = 'atlassian';
export type ExternalImportKind = 'jira' | 'confluence';

export interface ListAtlassianConnectionsParams {
  limit?: number;
  offset?: number;
}

/** Same shape as connections list; used for GET /imports/atlassian/configs pagination. */
export type ListExternalImportConfigsParams = ListAtlassianConnectionsParams;

export interface AtlassianSiteConnectionDto {
  id: string;
  label?: string | null;
  baseUrl: string;
  accountEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalImportConfigDto {
  id: string;
  provider: ExternalImportProviderId;
  importKind: ExternalImportKind;
  atlassianConnectionId: string;
  clientId: string;
  enabled: boolean;
  jiraBoardId?: number | null;
  jql?: string | null;
  importTargetTicketStatus?: TicketStatus | null;
  confluenceSpaceKey?: string | null;
  confluenceRootPageId?: string | null;
  cql?: string | null;
  agenstraParentTicketId?: string | null;
  agenstraParentFolderId?: string | null;
  lastRunAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAtlassianSiteConnectionDto {
  label?: string;
  baseUrl: string;
  accountEmail: string;
  apiToken: string;
}

export interface UpdateAtlassianSiteConnectionDto {
  label?: string | null;
  baseUrl?: string;
  accountEmail?: string;
  /** When omitted, existing token is kept. */
  apiToken?: string;
}

export interface CreateExternalImportConfigDto {
  provider: ExternalImportProviderId;
  importKind: ExternalImportKind;
  atlassianConnectionId: string;
  clientId: string;
  enabled?: boolean;
  jiraBoardId?: number | null;
  jql?: string | null;
  importTargetTicketStatus?: TicketStatus | null;
  confluenceSpaceKey?: string | null;
  confluenceRootPageId?: string | null;
  cql?: string | null;
  agenstraParentTicketId?: string | null;
  agenstraParentFolderId?: string | null;
}

export interface UpdateExternalImportConfigDto {
  atlassianConnectionId?: string;
  clientId?: string;
  enabled?: boolean;
  jiraBoardId?: number | null;
  jql?: string | null;
  importTargetTicketStatus?: TicketStatus | null;
  confluenceSpaceKey?: string | null;
  confluenceRootPageId?: string | null;
  cql?: string | null;
  agenstraParentTicketId?: string | null;
  agenstraParentFolderId?: string | null;
}

export interface AtlassianConnectionTestResultDto {
  ok: boolean;
  message?: string;
}
