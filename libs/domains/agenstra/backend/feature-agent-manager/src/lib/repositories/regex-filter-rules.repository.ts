import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';

/**
 * Repository for regex filter rules.
 */
@Injectable()
export class RegexFilterRulesRepository {
  constructor(
    @InjectRepository(RegexFilterRuleEntity)
    private readonly repository: Repository<RegexFilterRuleEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<RegexFilterRuleEntity> {
    const row = await this.repository.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException(`Regex filter rule with ID ${id} not found`);
    }

    return row;
  }

  async findAllOrdered(): Promise<RegexFilterRuleEntity[]> {
    return await this.repository.find({
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  async findAll(limit = 100, offset = 0): Promise<RegexFilterRuleEntity[]> {
    return await this.repository.find({
      take: limit,
      skip: offset,
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  async count(): Promise<number> {
    return await this.repository.count();
  }

  async create(dto: Partial<RegexFilterRuleEntity>): Promise<RegexFilterRuleEntity> {
    const row = this.repository.create(dto);

    return await this.repository.save(row);
  }

  async update(id: string, dto: Partial<RegexFilterRuleEntity>): Promise<RegexFilterRuleEntity> {
    const row = await this.findByIdOrThrow(id);

    Object.assign(row, dto);

    return await this.repository.save(row);
  }

  async delete(id: string): Promise<void> {
    const row = await this.findByIdOrThrow(id);

    await this.repository.remove(row);
  }
}
