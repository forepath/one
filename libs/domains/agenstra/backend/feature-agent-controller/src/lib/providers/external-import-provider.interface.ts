import type { ExternalImportConfigEntity } from '../entities/external-import-config.entity';

export interface ExternalContextImportRunContext {
  config: ExternalImportConfigEntity;
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
 * v1: only {@link AtlassianImportProvider} is registered.
 */
export interface ExternalContextImportProvider {
  /**
   * Get the unique type identifier for this provider.
   * This is used to identify which provider to use for provisioning.
   * @returns The provider type string (e.g., 'atlassian')
   */
  getType(): string;

  /**
   * Run the import for the given context.
   * @param ctx - The import context
   * @returns The import result
   */
  runImport(ctx: ExternalContextImportRunContext): Promise<ExternalContextImportRunResult>;

  /**
   * Test the connection to the external source.
   * @param connectionId - The connection identifier
   * @returns The connection result
   */
  testConnection?(connectionId: string): Promise<{ ok: boolean; message?: string }>;
}
