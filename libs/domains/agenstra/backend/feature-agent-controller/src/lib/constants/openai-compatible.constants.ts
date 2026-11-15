const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Routes on which a raw personal access token (`Authorization: Bearer fp_pat_…`) is accepted (exchanged in-process
 * for the regular PAT JWT, see `PatBearerExchangeMiddleware`): the OpenAI-compatible API only, because OpenAI SDKs
 * use a static API key. Anchored, UUID-constrained and case-insensitive like the Express router, so no other route
 * can match (the lookahead keeps the match a clean path prefix, which Express requires for `app.use(pattern, …)`).
 * Paths include the controller's global prefix (`api`).
 */
export const OPENAI_COMPATIBLE_ROUTE_PATTERN = new RegExp(`^/api/clients/${UUID}/agents/${UUID}/openai/v1(?=/|$)`, 'i');

export const AGENSTRA_RAW_PAT_BEARER_PATHS: readonly RegExp[] = [OPENAI_COMPATIBLE_ROUTE_PATTERN];

/**
 * JSON body limit of the OpenAI-compatible routes (the global limit is 100kb). OpenAI clients resend the whole
 * conversation with every Chat Completions request; only the new turn reaches the agent.
 */
export const OPENAI_COMPATIBLE_MAX_BODY_SIZE = '1mb';

/** Request / response header selecting (and reporting) the chat session of a turn. */
export const OPENAI_COMPATIBLE_CHAT_ID_HEADER = 'X-Agenstra-Chat-Id';
