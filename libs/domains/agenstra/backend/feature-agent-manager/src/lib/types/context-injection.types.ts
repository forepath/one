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
  /** Plans of the agent's environment linked as context (controller-resolved, same order as `planContextRefs`). */
  planShas?: string[];
  planContexts?: string[];
  planContextRefs?: Array<{ sha: string; title?: string }>;
  autoEnrichmentEnabled?: boolean;
}
