import { Injectable } from '@nestjs/common';

import { RegexFilterRulesEvaluateService } from '@forepath/agenstra/backend/feature-agent-manager/plugin-deps';
import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '@forepath/agenstra/backend/util-plugin-host';

@Injectable()
export class ChatFilterDbRegexIncomingProvider implements ChatFilter {
  private static readonly TYPE = 'database-regex-incoming';

  constructor(private readonly evaluateService: RegexFilterRulesEvaluateService) {}

  getType(): string {
    return ChatFilterDbRegexIncomingProvider.TYPE;
  }

  getDisplayName(): string {
    return 'Database regex rules (incoming)';
  }

  getDirection(): FilterDirection {
    return FilterDirection.INCOMING;
  }

  async filter(message: string, _context?: FilterContext): Promise<FilterResult> {
    return await this.evaluateService.evaluate(message, FilterDirection.INCOMING);
  }
}
