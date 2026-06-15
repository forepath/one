import { Injectable } from '@nestjs/common';

import { RegexFilterRulesEvaluateService } from '../../services/regex-filter-rules-evaluate.service';
import { ChatFilter, FilterContext, FilterDirection, FilterResult } from '../chat-filter.interface';

@Injectable()
export class DatabaseRegexIncomingChatFilter implements ChatFilter {
  private static readonly TYPE = 'database-regex-incoming';

  constructor(private readonly evaluateService: RegexFilterRulesEvaluateService) {}

  getType(): string {
    return DatabaseRegexIncomingChatFilter.TYPE;
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
