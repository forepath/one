/** Reserved tokens for chat role markers and conversation template overhead. */
export const PROJECT_ESTIMATE_PROMPT_TEMPLATE_OVERHEAD_TOKENS = 64;

/**
 * Conservative characters-per-token estimate for Qwen instruct models in WebLLM.
 * Slightly pessimistic to avoid ContextWindowSizeExceededError at runtime.
 */
export const PROJECT_ESTIMATE_PROMPT_CHARS_PER_TOKEN = 2.75;
