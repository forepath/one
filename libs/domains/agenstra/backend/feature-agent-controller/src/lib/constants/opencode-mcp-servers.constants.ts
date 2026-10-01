export const OPENCODE_MCP_SERVERS_REFRESH_JOB_NAME = 'opencode-mcp-servers.refresh';

/** Default official MCP Registry base URL (no trailing slash). */
export const OPENCODE_MCP_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';

/** Default page size when walking the registry list API. */
export const OPENCODE_MCP_SERVERS_PAGE_LIMIT = 100;

/**
 * Rows per TypeORM upsert batch.
 * Postgres binds ~12 columns per row; stay well under the 65535 parameter limit.
 */
export const OPENCODE_MCP_SERVERS_UPSERT_CHUNK_SIZE = 200;

/** Names per delete batch when removing stale catalog rows. */
export const OPENCODE_MCP_SERVERS_DELETE_CHUNK_SIZE = 500;

/** Default page size for GET /opencode/mcp-servers typeahead/list. */
export const OPENCODE_MCP_SERVERS_LIST_LIMIT_DEFAULT = 20;

/** Max page size for GET /opencode/mcp-servers. */
export const OPENCODE_MCP_SERVERS_LIST_LIMIT_MAX = 100;

/** Default refresh interval: 24 hours. */
export const OPENCODE_MCP_SERVERS_REFRESH_INTERVAL_MS_DEFAULT = 86_400_000;
