import { RequireScopes } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { BackorderCancelDto } from '../dto/backorder-cancel.dto';
import { BackorderResponseDto } from '../dto/backorder-response.dto';
import { BackorderRetryDto } from '../dto/backorder-retry.dto';
import { BackorderStatus } from '../entities/backorder.entity';
import { BackordersRepository } from '../repositories/backorders.repository';
import { BackorderService } from '../services/backorder.service';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

/** Largest page of the backorder list. */
const MAX_BACKORDERS_LIMIT = 100;

/** `?status=pending,retrying` → validated statuses (`undefined` = all). */
function parseBackorderStatuses(status?: string): BackorderStatus[] | undefined {
  const values = (status ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) return undefined;

  const allowed = new Set<string>(Object.values(BackorderStatus));
  const invalid = values.filter((value) => !allowed.has(value));

  if (invalid.length > 0) {
    throw new BadRequestException(`Unknown backorder status: ${invalid.join(', ')}`);
  }

  return values as BackorderStatus[];
}

@Controller('backorders')
export class BackordersController {
  constructor(
    private readonly backorderService: BackorderService,
    private readonly backordersRepository: BackordersRepository,
  ) {}

  @RequireScopes('subscriptions:read')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Req() req?: RequestWithUser,
    @Query('status') status?: string,
  ): Promise<BackorderResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const rows = await this.backorderService.listForUser(
      userInfo.userId,
      Math.min(Math.max(limit ?? 10, 1), MAX_BACKORDERS_LIMIT),
      Math.max(offset ?? 0, 0),
      search,
      parseBackorderStatuses(status),
    );

    return await this.backorderService.mapManyToResponses(rows);
  }

  @RequireScopes('subscriptions:write')
  @Post(':id/retry')
  async retry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: BackorderRetryDto,
    @Req() req?: RequestWithUser,
  ): Promise<BackorderResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const backorder = await this.backordersRepository.findByIdOrThrow(id);

    if (backorder.userId !== userInfo.userId) {
      ensureAdmin(userInfo);
    }

    const row = await this.backorderService.retry(id);

    return await this.backorderService.mapToResponse(row);
  }

  @RequireScopes('subscriptions:write')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: BackorderCancelDto,
    @Req() req?: RequestWithUser,
  ): Promise<BackorderResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const backorder = await this.backordersRepository.findByIdOrThrow(id);

    if (backorder.userId !== userInfo.userId) {
      ensureAdmin(userInfo);
    }

    const row = await this.backorderService.cancel(id);

    return await this.backorderService.mapToResponse(row);
  }
}
