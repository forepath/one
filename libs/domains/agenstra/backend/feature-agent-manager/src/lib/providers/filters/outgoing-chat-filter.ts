import { Injectable } from '@nestjs/common';

import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '../chat-filter.interface';

/**
 * Example outgoing filter implementation.
 * Filters only outgoing messages (from agent to user).
 */
@Injectable()
export class OutgoingChatFilter implements ChatFilter {
  private static readonly TYPE = 'outgoing-example';

  /**
   * Get the unique type identifier for this filter.
   * @returns 'outgoing-example'
   */
  getType(): string {
    return OutgoingChatFilter.TYPE;
  }

  /**
   * Get the human-readable display name for this filter.
   * @returns 'Outgoing Filter Example'
   */
  getDisplayName(): string {
    return 'Outgoing Filter Example';
  }

  /**
   * Get the direction(s) this filter applies to.
   * @returns 'outgoing' (applies only to agent messages)
   */
  getDirection(): FilterDirection {
    return FilterDirection.OUTGOING;
  }

  /**
   * Check if a message should be filtered.
   * This is an example implementation - replace with actual filtering logic.
   * @param message - The message content to check
   * @param _context - Optional context about the message (unused in example)
   * @returns Filter result
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async filter(message: string, _context?: FilterContext): Promise<FilterResult> {
    // Example: Filter messages containing "test-filter" (replace with actual logic)
    if (message.toLowerCase().includes('test-filter')) {
      return {
        filtered: true,
        action: 'flag', // or 'drop' to prevent processing
        reason: 'Message contains test-filter keyword',
      };
    }

    return {
      filtered: false,
    };
  }
}
