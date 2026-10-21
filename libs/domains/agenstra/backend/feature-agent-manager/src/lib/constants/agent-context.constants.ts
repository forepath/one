/**
 * Agent context MCP: prompts carry short hints plus a context ticket; the worker-side
 * `agenstra` MCP server reads the referenced content from the manager on demand.
 */

/** Base URL (incl. `/api`) workers use to reach this manager. Unset disables context MCP (inline fallback). */
export const AGENT_CONTEXT_MCP_MANAGER_URL_ENV = 'AGENT_CONTEXT_MCP_MANAGER_URL';

/** Set to `false` to force the legacy inline `<hidden-context>` composition. */
export const AGENT_CONTEXT_MCP_ENABLED_ENV = 'AGENT_CONTEXT_MCP_ENABLED';

/** Optional dedicated HMAC secret for per-agent context tokens; falls back to `ENCRYPTION_KEY`. */
export const AGENT_CONTEXT_TOKEN_SECRET_ENV = 'AGENT_CONTEXT_TOKEN_SECRET';

/** Context tickets stay valid this long after their last use (sessions continue across turns). */
export const AGENT_CONTEXT_TICKET_IDLE_TTL_MS = 2 * 60 * 60 * 1000;

/** Upper bound of tickets kept per agent (oldest are evicted first). */
export const AGENT_CONTEXT_MAX_TICKETS_PER_AGENT = 50;

/** How long an MCP access request waits for a user decision before returning `pending`. */
export const AGENT_CONTEXT_ACCESS_WAIT_MS = 120_000;

/** Pending access requests are dropped (denied) after this long without a decision. */
export const AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS = 30 * 60 * 1000;

/** Prefix of access-request ids; replies arrive on the permission reply endpoint. */
export const AGENT_CONTEXT_ACCESS_REQUEST_ID_PREFIX = 'ctx_';

/** `question` event subtype rendered like a permission prompt in the console. */
export const AGENT_CONTEXT_ACCESS_QUESTION_SUBTYPE = 'context_access';

/** Socket.IO event (manager → controller, with ack) resolving metadata / content on demand. */
export const AGENT_CONTEXT_REQUEST_EVENT = 'agentContextRequest';

/** Ack timeout per controller socket for {@link AGENT_CONTEXT_REQUEST_EVENT}. */
export const AGENT_CONTEXT_REQUEST_TIMEOUT_MS = 15_000;

/** Cache for "is the platform MCP server connected in this worker" probes. */
export const AGENT_CONTEXT_MCP_STATUS_CACHE_TTL_MS = 30_000;

/** Max refs per access request / items per search. */
export const AGENT_CONTEXT_MAX_REFS_PER_REQUEST = 20;
export const AGENT_CONTEXT_MAX_SEARCH_RESULTS = 50;
