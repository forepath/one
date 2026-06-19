export interface ExternalContextImportConfig {
  id: string;
  provider: string;
  importKind: string;
  atlassianConnectionId: string;
  clientId: string;
  enabled: boolean;
  jiraBoardId?: number | null;
  jql?: string | null;
  importTargetTicketStatus: string;
}

export interface ExternalContextImportRunContext {
  config: ExternalContextImportConfig;
  /** Max external items to process in this invocation (pagination budget). */
  itemBudget: number;
}

export interface ExternalContextImportRunResult {
  processedCount: number;
  hasMore: boolean;
  errorMessage?: string;
}

/**
 * Pluggable source for importing external tickets/knowledge into Agenstra.
 */
export interface ExternalContextImportProvider {
  getType(): string;
  runImport(ctx: ExternalContextImportRunContext): Promise<ExternalContextImportRunResult>;
  testConnection?(connectionId: string): Promise<{ ok: boolean; message?: string }>;
}
