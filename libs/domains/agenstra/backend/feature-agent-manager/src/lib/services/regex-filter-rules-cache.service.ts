import { Injectable } from '@nestjs/common';

import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { RegexFilterRulesRepository } from '../repositories/regex-filter-rules.repository';

/**
 * In-memory cache of all regex rules ordered by priority (invalidated on CRUD).
 */
@Injectable()
export class RegexFilterRulesCacheService {
  private cached: RegexFilterRuleEntity[] | null = null;

  constructor(private readonly repository: RegexFilterRulesRepository) {}

  invalidate(): void {
    this.cached = null;
  }

  async getAllOrdered(): Promise<RegexFilterRuleEntity[]> {
    if (this.cached) {
      return this.cached;
    }

    this.cached = await this.repository.findAllOrdered();

    return this.cached;
  }
}
