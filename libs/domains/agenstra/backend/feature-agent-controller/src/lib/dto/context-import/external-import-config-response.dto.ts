import type { ExternalImportKind, ExternalImportProviderId } from '../../entities/external-import.enums';
import type { TicketStatus } from '../../entities/ticket.enums';

export class ExternalImportConfigResponseDto {
  id!: string;
  provider!: ExternalImportProviderId;
  importKind!: ExternalImportKind;
  atlassianConnectionId!: string;
  clientId!: string;
  enabled!: boolean;
  jiraBoardId?: number | null;
  jql?: string | null;
  importTargetTicketStatus?: TicketStatus | null;
  confluenceSpaceKey?: string | null;
  confluenceRootPageId?: string | null;
  cql?: string | null;
  agenstraParentTicketId?: string | null;
  agenstraParentFolderId?: string | null;
  lastRunAt?: Date | null;
  lastError?: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
