import { Injectable } from '@nestjs/common';

import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '../chat-filter.interface';

/**
 * Example incoming filter implementation.
 * Filters only incoming messages (from user to agent).
 */
@Injectable()
export class IncomingChatFilter implements ChatFilter {
  private static readonly TYPE = 'incoming-example';

  /**
   * Get the unique type identifier for this filter.
   * @returns 'incoming-example'
   */
  getType(): string {
    return IncomingChatFilter.TYPE;
  }

  /**
   * Get the human-readable display name for this filter.
   * @returns 'Incoming Filter Example'
   */
  getDisplayName(): string {
    return 'Incoming Filter Example';
  }

  /**
   * Get the direction(s) this filter applies to.
   * @returns 'incoming' (applies only to user messages)
   */
  getDirection(): FilterDirection {
    return FilterDirection.INCOMING;
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
