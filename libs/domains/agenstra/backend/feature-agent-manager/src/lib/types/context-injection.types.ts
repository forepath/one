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
  /**
   * Initiatives / initiative documents of the workspace (controller-resolved, same order as `initiativeContextRefs`).
   * Pre-granted to initiative step runs, ticket automation of linked stories and plans created from a story.
   */
  initiativeContexts?: string[];
  initiativeContextRefs?: Array<{ kind: 'initiative' | 'artifact'; sha: string; title?: string }>;
  autoEnrichmentEnabled?: boolean;
}
