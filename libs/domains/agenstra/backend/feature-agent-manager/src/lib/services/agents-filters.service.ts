import { Injectable } from '@nestjs/common';

import { CreateRegexFilterRuleDto } from '../dto/create-regex-filter-rule.dto';
import { UpdateRegexFilterRuleDto } from '../dto/update-regex-filter-rule.dto';
import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { RegexFilterRulesRepository } from '../repositories/regex-filter-rules.repository';
import {
  assertReplaceContentForFilterType,
  compileRegexOrThrow,
  normalizeRegexFlags,
} from '../utils/regex-filter-rule.utils';

import { RegexFilterRulesCacheService } from './regex-filter-rules-cache.service';

/**
 * CRUD for regex filter rules (HTTP API + cache invalidation).
 */
@Injectable()
export class AgentsFiltersService {
  constructor(
    private readonly repository: RegexFilterRulesRepository,
    private readonly cache: RegexFilterRulesCacheService,
  ) {}

  async list(limit = 100, offset = 0): Promise<RegexFilterRuleEntity[]> {
    return await this.repository.findAll(limit, offset);
  }

  async count(): Promise<number> {
    return await this.repository.count();
  }

  async getById(id: string): Promise<RegexFilterRuleEntity> {
    return await this.repository.findByIdOrThrow(id);
  }

  async create(dto: CreateRegexFilterRuleDto): Promise<RegexFilterRuleEntity> {
    assertReplaceContentForFilterType(dto.filterType, dto.replaceContent);
    const flags = normalizeRegexFlags(dto.regexFlags);

    compileRegexOrThrow(dto.pattern, flags);
    const row = await this.repository.create({
      pattern: dto.pattern,
      regexFlags: flags,
      direction: dto.direction,
      filterType: dto.filterType,
      replaceContent: dto.filterType === 'filter' ? dto.replaceContent : null,
      priority: dto.priority ?? 0,
    });

    this.cache.invalidate();

    return row;
  }

  async update(id: string, dto: UpdateRegexFilterRuleDto): Promise<RegexFilterRuleEntity> {
    const existing = await this.repository.findByIdOrThrow(id);
    const filterType = dto.filterType ?? existing.filterType;
    let replaceContent = dto.replaceContent !== undefined ? dto.replaceContent : existing.replaceContent;

    if (filterType !== 'filter') {
      replaceContent = null;
    }

    assertReplaceContentForFilterType(filterType, replaceContent);
    const pattern = dto.pattern ?? existing.pattern;
    const regexFlags = dto.regexFlags !== undefined ? normalizeRegexFlags(dto.regexFlags) : existing.regexFlags;

    compileRegexOrThrow(pattern, regexFlags);
    const updated = await this.repository.update(id, {
      pattern,
      regexFlags,
      direction: dto.direction ?? existing.direction,
      filterType,
      replaceContent: filterType === 'filter' ? replaceContent : null,
      priority: dto.priority ?? existing.priority,
    });

    this.cache.invalidate();

    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
    this.cache.invalidate();
  }
}
