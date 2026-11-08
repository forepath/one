import type { TicketStatus } from '../tickets/tickets.types';

export type ExternalImportProviderId = 'atlassian';
export type ExternalImportKind = 'jira' | 'confluence';

/**
 * Atlassian connection auth variant:
 * - `app` (default): OAuth 2.0 client credentials of an Atlassian service account (`oauthClientId` + `oauthClientSecret`)
 * - `token`: account email + API token (HTTP Basic against the site)
 */
export type AtlassianConnectionAuthType = 'app' | 'token';

/** Result of the last connection test persisted on the connection. */
export type AtlassianConnectionTestStatus = 'ok' | 'failed' | 'untested';

export interface ListAtlassianConnectionsParams {
  limit?: number;
  offset?: number;
  search?: string;
}

/** Same shape as connections list; used for GET /connections/atlassian/configs pagination. */
export type ListExternalImportConfigsParams = ListAtlassianConnectionsParams;

export interface AtlassianSiteConnectionDto {
  id: string;
  label?: string | null;
  baseUrl: string;
  authType: AtlassianConnectionAuthType;
  /** `token` connections only. */
  accountEmail: string | null;
  /** OAuth client id of the service account credential (`app` connections only; not a secret). */
  oauthClientId: string | null;
  cloudId: string | null;
  lastTestStatus: AtlassianConnectionTestStatus;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
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

/** `app` (default) requires `oauthClientId` + `oauthClientSecret`; `token` requires `accountEmail` + `apiToken`. */
export interface CreateAtlassianSiteConnectionDto {
  label?: string;
  baseUrl: string;
  authType?: AtlassianConnectionAuthType;
  accountEmail?: string;
  apiToken?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

/** Omitted secrets keep the stored ones; switching `authType` requires the credentials of the new type. */
export interface UpdateAtlassianSiteConnectionDto {
  label?: string | null;
  baseUrl?: string;
  authType?: AtlassianConnectionAuthType;
  accountEmail?: string;
  /** When omitted, existing token is kept. */
  apiToken?: string;
  oauthClientId?: string;
  /** When omitted, existing secret is kept. */
  oauthClientSecret?: string;
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
  /** ISO timestamp; persisted as the connection's `lastTestedAt`. */
  testedAt: string;
}
