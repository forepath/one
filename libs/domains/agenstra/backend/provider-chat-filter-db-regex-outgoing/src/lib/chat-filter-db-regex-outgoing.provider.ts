import { Injectable } from '@nestjs/common';

import { RegexFilterRulesEvaluateService } from '@forepath/agenstra/backend/feature-agent-manager/plugin-deps';
import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '@forepath/agenstra/backend/util-plugin-host';

@Injectable()
export class ChatFilterDbRegexOutgoingProvider implements ChatFilter {
  private static readonly TYPE = 'database-regex-outgoing';

  constructor(private readonly evaluateService: RegexFilterRulesEvaluateService) {}

  getType(): string {
    return ChatFilterDbRegexOutgoingProvider.TYPE;
  }

  getDisplayName(): string {
    return 'Database regex rules (outgoing)';
  }

  getDirection(): FilterDirection {
    return FilterDirection.OUTGOING;
  }

  async filter(message: string, _context?: FilterContext): Promise<FilterResult> {
    return await this.evaluateService.evaluate(message, FilterDirection.OUTGOING);
  }
}
