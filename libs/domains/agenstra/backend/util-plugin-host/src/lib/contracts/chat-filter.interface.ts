/**
 * Chat filter interface for implementing message filtering logic.
 * Filters can be applied to incoming (user) messages, outgoing (agent) messages,
 * or both (bidirectional).
 */
export interface ChatFilter {
  /**
   * Get the unique type identifier for this filter.
   * @returns The filter type string (e.g., 'profanity', 'pii', 'content-policy')
   */
  getType(): string;

  /**
   * Get the human-readable display name for this filter.
   * @returns The display name string
   */
  getDisplayName(): string;

  /**
   * Get the direction(s) this filter applies to.
   * @returns Filter direction: 'incoming', 'outgoing', or 'bidirectional'
   */
  getDirection(): FilterDirection;

  /**
   * Check if a message should be filtered.
   * @param message - The message content to check
   * @param context - Optional context about the message (agentId, actor, etc.)
   * @returns Filter result indicating if message should be filtered and action to take
   */
  filter(message: string, context?: FilterContext): Promise<FilterResult>;
}

/**
 * Filter direction enum.
 */
export enum FilterDirection {
  /**
   * Filter applies only to incoming messages (from user to agent).
   */
  INCOMING = 'incoming',

  /**
   * Filter applies only to outgoing messages (from agent to user).
   */
  OUTGOING = 'outgoing',

  /**
   * Filter applies to both incoming and outgoing messages.
   */
  BIDIRECTIONAL = 'bidirectional',
}

/**
 * Context information for filter evaluation.
 */
export interface FilterContext {
  /**
   * The UUID of the agent associated with the message.
   */
  agentId?: string;

  /**
   * The actor type: 'user' or 'agent'.
   */
  actor?: 'user' | 'agent';

  /**
   * Additional metadata that may be useful for filtering decisions.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a filter check.
 * Union type to ensure action is only present when filtered is true.
 */
export type FilterResult =
  | {
      /**
       * Message was filtered.
       */
      filtered: true;

      /**
       * Action to take when message is filtered.
       * - 'drop': Do not process the message further (do not persist, do not send to LLM, do not broadcast)
       * - 'flag': Process the message normally but mark it as filtered in the database
       */
      action: 'drop' | 'flag';

      /**
       * Optional reason for filtering (for logging and debugging).
       */
      reason?: string;

      /**
       * Optional modified message content.
       * If provided, this modified message will be used instead of the original message.
       * Only applicable when action is 'flag' (dropped messages cannot be modified).
       * If not provided and action is 'flag', the original message is used.
       */
      modifiedMessage?: string;
    }
  | {
      /**
       * Message was not filtered.
       */
      filtered: false;
    };

/**
 * Information about a filter that was applied to a message.
 */
export interface AppliedFilterInfo {
  /**
   * The filter type identifier.
   */
  type: string;

  /**
   * The filter display name.
   */
  displayName: string;

  /**
   * Whether this filter matched (filtered the message).
   */
  matched: boolean;

  /**
   * Optional reason if the filter matched.
   */
  reason?: string;
}

/**
 * Result of applying all filters to a message.
 */
export interface FilterApplicationResult {
  /**
   * The original message that was filtered.
   */
  message: string;

  /**
   * The modified message (if any filter modified it).
   * If present, this should be used instead of the original message.
   * Only present when status is 'filtered' and action is 'flag'.
   */
  modifiedMessage?: string;

  /**
   * The final filter status: 'allowed', 'filtered', or 'dropped'.
   */
  status: 'allowed' | 'filtered' | 'dropped';

  /**
   * List of all filters that were applied.
   */
  appliedFilters: AppliedFilterInfo[];

  /**
   * The filter that matched (if any).
   */
  matchedFilter?: AppliedFilterInfo;

  /**
   * The action to take (only present if filtered).
   */
  action?: 'drop' | 'flag';

  /**
   * Timestamp when filters were applied.
   */
  timestamp: string;
}
