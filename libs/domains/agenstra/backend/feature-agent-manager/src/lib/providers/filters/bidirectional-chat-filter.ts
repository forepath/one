import { Injectable } from '@nestjs/common';

import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '../chat-filter.interface';

/**
 * Example bidirectional filter implementation.
 * Filters both incoming and outgoing messages.
 */
@Injectable()
export class BidirectionalChatFilter implements ChatFilter {
  private static readonly TYPE = 'bidirectional-example';

  /**
   * Get the unique type identifier for this filter.
   * @returns 'bidirectional-example'
   */
  getType(): string {
    return BidirectionalChatFilter.TYPE;
  }

  /**
   * Get the human-readable display name for this filter.
   * @returns 'Bidirectional Filter Example'
   */
  getDisplayName(): string {
    return 'Bidirectional Filter Example';
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
   * This is an example implementation - replace with actual filtering logic.
   * @param message - The message content to check
   * @param _context - Optional context about the message (unused in example)
   * @returns Filter result
   */
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
