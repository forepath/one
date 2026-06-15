/**
 * Response body for listing models available to an agent.
 * Keys are provider-specific model identifiers; values are human-readable names.
 */
export type AgentModelsResponseDto = Record<string, string>;
