import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { CreateRegexFilterRuleDto } from '../dto/create-regex-filter-rule.dto';
import { RegexFilterRuleResponseDto } from '../dto/regex-filter-rule-response.dto';
import { UpdateRegexFilterRuleDto } from '../dto/update-regex-filter-rule.dto';
import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { AgentsFiltersService } from '../services/agents-filters.service';

/**
 * HTTP CRUD for regex-based chat filter rules.
 */
@Controller('agents-filters')
export class AgentsFiltersController {
  constructor(private readonly agentsFiltersService: AgentsFiltersService) {}

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<RegexFilterRuleResponseDto[]> {
    const rows = await this.agentsFiltersService.list(limit ?? 100, offset ?? 0);

    return rows.map((r) => this.toDto(r));
  }

  @Get('count')
  async count(): Promise<{ count: number }> {
    const count = await this.agentsFiltersService.count();

    return { count };
  }

  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<RegexFilterRuleResponseDto> {
    const row = await this.agentsFiltersService.getById(id);

    return this.toDto(row);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateRegexFilterRuleDto): Promise<RegexFilterRuleResponseDto> {
    const row = await this.agentsFiltersService.create(dto);

    return this.toDto(row);
  }

  @Put(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRegexFilterRuleDto,
  ): Promise<RegexFilterRuleResponseDto> {
    const row = await this.agentsFiltersService.update(id, dto);

    return this.toDto(row);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.agentsFiltersService.delete(id);
  }

  private toDto(row: RegexFilterRuleEntity): RegexFilterRuleResponseDto {
    return {
      id: row.id,
      pattern: row.pattern,
      regexFlags: row.regexFlags,
      direction: row.direction,
      filterType: row.filterType,
      replaceContent: row.replaceContent,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
