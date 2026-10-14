import { Injectable } from '@nestjs/common';

import { AgentMessageFiltersService } from '../../services/agent-message-filters.service';
import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '../chat-filter.interface';

/** Layered message filter rules (agent configuration → Security → Message filters) for agent responses. */
@Injectable()
export class MessageFiltersOutgoingChatFilter implements ChatFilter {
  static readonly TYPE = 'message-filters-outgoing';

  constructor(private readonly messageFilters: AgentMessageFiltersService) {}

  getType(): string {
    return MessageFiltersOutgoingChatFilter.TYPE;
  }

  getDisplayName(): string {
    return 'Message filters (outgoing)';
  }

  getDirection(): FilterDirection {
    return FilterDirection.OUTGOING;
  }

  async filter(message: string, context?: FilterContext): Promise<FilterResult> {
    return await this.messageFilters.evaluate(context?.agentId, message, 'outgoing');
  }
}
