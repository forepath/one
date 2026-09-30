export const AGENSTRA_SEARCH_ENTITY_TYPES = [
  'clients',
  'agents',
  'tickets',
  'knowledge-nodes',
  'filter-rules',
  'deployment-runs',
  'chat-io',
  'filter-drops',
  'filter-flags',
  'entity-events',
  'atlassian-connections',
  'import-configs',
  'environments',
  'users',
  'opencode-providers',
  'opencode-mcp-servers',
] as const;

export type AgenstraSearchEntityType = (typeof AGENSTRA_SEARCH_ENTITY_TYPES)[number];

export interface AgenstraSearchDocument {
  id: string;
  entityType: AgenstraSearchEntityType;
  clientId?: string | null;
  clientIds?: string[];
  instanceScoped?: boolean;
  statisticsClientId?: string | null;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  content?: string | null;
  status?: string | null;
  priority?: string | null;
  pattern?: string | null;
  filterType?: string | null;
  filterDisplayName?: string | null;
  filterReason?: string | null;
  direction?: string | null;
  interactionKind?: string | null;
  entityEventType?: string | null;
  originalEntityId?: string | null;
  label?: string | null;
  baseUrl?: string | null;
  accountEmail?: string | null;
  provider?: string | null;
  importKind?: string | null;
  agentType?: string | null;
  containerType?: string | null;
  variable?: string | null;
  agentId?: string | null;
  role?: string | null;
  wordCount?: number | null;
  charCount?: number | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  searchableText?: string | null;
}

export interface AgenstraSearchUpsertInput {
  entityType: AgenstraSearchEntityType;
  document: AgenstraSearchDocument;
}

export interface AgenstraSearchIdsParams {
  entityType: AgenstraSearchEntityType;
  query: string;
  /** Mandatory client scope from auth context. Fail closed when empty unless instanceScoped. */
  clientIds?: string | string[] | null;
  /** Instance-admin scope for entities without clientId (e.g. atlassian connections). */
  instanceScoped?: boolean;
  additionalFilters?: Record<string, string | string[] | number | boolean | null | undefined>;
  limit?: number;
  offset?: number;
}

export interface AgenstraSearchIdsResult {
  ids: string[];
  total: number;
}

export interface AgenstraReindexBatchResult {
  indexed: number;
  hasMore: boolean;
}

export const AGENSTRA_SEARCH_TEXT_FIELDS = [
  'searchableText',
  'title',
  'name',
  'description',
  'content',
  'status',
  'priority',
  'pattern',
  'filterType',
  'filterDisplayName',
  'filterReason',
  'direction',
  'interactionKind',
  'entityEventType',
  'originalEntityId',
  'label',
  'baseUrl',
  'accountEmail',
  'provider',
  'importKind',
  'agentType',
  'containerType',
  'variable',
  'agentId',
  'role',
  'id',
] as const;

export const AGENSTRA_SEARCH_INDEX_MAPPINGS: Record<string, unknown> = {
  properties: {
    id: { type: 'keyword' },
    entityType: { type: 'keyword' },
    clientId: { type: 'keyword' },
    clientIds: { type: 'keyword' },
    instanceScoped: { type: 'boolean' },
    statisticsClientId: { type: 'keyword' },
    agentId: { type: 'keyword' },
    originalEntityId: { type: 'keyword' },
    status: { type: 'keyword' },
    priority: { type: 'keyword' },
    direction: { type: 'keyword' },
    interactionKind: { type: 'keyword' },
    filterType: { type: 'keyword' },
    entityEventType: { type: 'keyword' },
    provider: { type: 'keyword' },
    importKind: { type: 'keyword' },
    agentType: { type: 'keyword' },
    containerType: { type: 'keyword' },
    role: { type: 'keyword' },
    title: { type: 'text' },
    name: { type: 'text' },
    description: { type: 'text' },
    content: { type: 'text' },
    pattern: { type: 'text' },
    filterDisplayName: { type: 'text' },
    filterReason: { type: 'text' },
    label: { type: 'text' },
    baseUrl: { type: 'text' },
    accountEmail: { type: 'text' },
    variable: { type: 'text' },
    searchableText: { type: 'text' },
    wordCount: { type: 'integer' },
    charCount: { type: 'integer' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};
