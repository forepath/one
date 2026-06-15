import { Injectable } from '@nestjs/common';

import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '../chat-filter.interface';

/**
 * No-op filter implementation that never filters messages.
 * Useful for testing or as a default filter.
 */
@Injectable()
export class NoopChatFilter implements ChatFilter {
  private static readonly TYPE = 'noop';

  /**
   * Get the unique type identifier for this filter.
   * @returns 'noop'
   */
  getType(): string {
    return NoopChatFilter.TYPE;
  }

  /**
   * Get the human-readable display name for this filter.
   * @returns 'No-op Filter'
   */
  getDisplayName(): string {
    return 'No-op Filter';
  }

  /**
   * Get the direction(s) this filter applies to.
   * @returns 'bidirectional' (applies to all messages)
   */
  getDirection(): FilterDirection {
    return FilterDirection.BIDIRECTIONAL;
  }

  /**
   * Check if a message should be filtered.
   * This implementation never filters messages.
   * @param message - The message content to check
   * @param context - Optional context about the message
   * @returns Filter result indicating message should not be filtered
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async filter(message: string, context?: FilterContext): Promise<FilterResult> {
    // No-op filter: never filters messages
    return {
      filtered: false,
    };
  }
}
