import { UserRole, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { CreateFilterRuleDto } from '../dto/filter-rules/create-filter-rule.dto';
import { FilterRuleResponseDto } from '../dto/filter-rules/filter-rule-response.dto';
import { UpdateFilterRuleDto } from '../dto/filter-rules/update-filter-rule.dto';
import { FilterRulesService } from '../services/filter-rules.service';

@Controller('filter-rules')
export class FilterRulesController {
  constructor(private readonly filterRulesService: FilterRulesService) {}

  private assertAdmin(req?: RequestWithUser): void {
    const u = getUserFromRequest(req || ({} as RequestWithUser));

    if (!u.isApiKeyAuth && u.userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<FilterRuleResponseDto[]> {
    this.assertAdmin(req);

    return await this.filterRulesService.findAll(limit ?? 10, offset ?? 0);
  }

  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<FilterRuleResponseDto> {
    this.assertAdmin(req);

    return await this.filterRulesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateFilterRuleDto, @Req() req: RequestWithUser): Promise<FilterRuleResponseDto> {
    this.assertAdmin(req);

    return await this.filterRulesService.create(dto);
  }

  @Put(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateFilterRuleDto,
    @Req() req: RequestWithUser,
  ): Promise<FilterRuleResponseDto> {
    this.assertAdmin(req);

    return await this.filterRulesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    this.assertAdmin(req);
    await this.filterRulesService.delete(id);
  }
}
