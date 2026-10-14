import { Injectable } from '@nestjs/common';

import { AgentMessageFiltersService } from '../../services/agent-message-filters.service';
import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '../chat-filter.interface';

/** Layered message filter rules (agent configuration → Security → Message filters) for user messages. */
@Injectable()
export class MessageFiltersIncomingChatFilter implements ChatFilter {
  static readonly TYPE = 'message-filters-incoming';

  constructor(private readonly messageFilters: AgentMessageFiltersService) {}

  getType(): string {
    return MessageFiltersIncomingChatFilter.TYPE;
  }

  getDisplayName(): string {
    return 'Message filters (incoming)';
  }

  getDirection(): FilterDirection {
    return FilterDirection.INCOMING;
  }

  async filter(message: string, context?: FilterContext): Promise<FilterResult> {
    return await this.messageFilters.evaluate(context?.agentId, message, 'incoming');
  }
}
