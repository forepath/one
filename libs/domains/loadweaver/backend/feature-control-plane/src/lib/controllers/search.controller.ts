import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

import { SearchService, type SearchResult } from '../search/search.service';
import type { SearchAction } from '../search/search.utils';

/** `Kind:key` of a search document. */
const ITEM = /^[A-Za-z]{1,32}:[A-Za-z0-9_./:-]{1,400}$/;

export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class VisitedDto {
  @Matches(ITEM)
  item!: string;
}

/** Global search and command palette (3.25), favourites and recently visited items. */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequireScopes('cluster:read')
  async query(
    @Query() q: SearchQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ results: SearchResult[]; actions: SearchAction[] }> {
    return await this.search.search(req, q.q, q.limit);
  }

  @Get('favorites')
  @RequireScopes('cluster:read')
  async favourites(@Req() req?: RequestWithUser): Promise<string[]> {
    return await this.search.favourites(req);
  }

  @Put('favorites/:item')
  @HttpCode(204)
  @RequireScopes('cluster:read')
  async addFavourite(@Param('item') item: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.search.setFavourite(req, validItem(item), true);
  }

  @Delete('favorites/:item')
  @HttpCode(204)
  @RequireScopes('cluster:read')
  async removeFavourite(@Param('item') item: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.search.setFavourite(req, validItem(item), false);
  }

  @Post('recent')
  @HttpCode(204)
  @RequireScopes('cluster:read')
  async visited(@Body() dto: VisitedDto, @Req() req?: RequestWithUser): Promise<void> {
    await this.search.visited(req, dto.item);
  }
}

function validItem(item: string): string {
  if (!ITEM.test(item)) throw new BadRequestException('invalid item');

  return item;
}
