import { ContainerType } from '../entities/agent.entity';

export interface EnvironmentContextReference {
  id: string;
  containerType: ContainerType;
}

export interface ContextInjectionPayload {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  attachmentIds?: string[];
  attachmentContexts?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    agentPath?: string | null;
    downloadUrl: string;
  }>;
  ticketShas?: string[];
  ticketContexts?: string[];
  /** Controller-resolved sha/title per `ticketContexts` entry (same order). */
  ticketContextRefs?: Array<{ sha: string; title?: string }>;
  knowledgeShas?: string[];
  knowledgeContexts?: string[];
  autoEnrichmentEnabled?: boolean;
  /** Server-enriched; omitted when generic or workspace not included */
  workspaceContainerType?: ContainerType;
  /** Server-enriched; only non-generic environments */
  environmentContainerTypes?: EnvironmentContextReference[];
}
