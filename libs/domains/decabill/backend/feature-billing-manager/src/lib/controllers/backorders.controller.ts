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
import { BackordersRepository } from '../repositories/backorders.repository';
import { BackorderService } from '../services/backorder.service';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

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
    @Req() req?: RequestWithUser,
  ): Promise<BackorderResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const rows = await this.backorderService.listForUser(userInfo.userId, limit ?? 10, offset ?? 0);

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
