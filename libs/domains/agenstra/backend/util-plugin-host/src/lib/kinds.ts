export const AGENSTRA_EXTENSION_KINDS = {
  AGENT_PROVIDER: 'agent-provider',
  PIPELINE_PROVIDER: 'pipeline-provider',
  CHAT_FILTER: 'chat-filter',
  PROVISIONING_PROVIDER: 'provisioning-provider',
  EXTERNAL_IMPORT_PROVIDER: 'external-import-provider',
  EMBEDDING_PROVIDER: 'embedding-provider',
} as const;

export type AgenstraExtensionKind = (typeof AGENSTRA_EXTENSION_KINDS)[keyof typeof AGENSTRA_EXTENSION_KINDS];
