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
import { BackorderEntity } from '../entities/backorder.entity';
import { BackordersRepository } from '../repositories/backorders.repository';
import { BackorderService } from '../services/backorder.service';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('backorders')
export class BackordersController {
  constructor(
    private readonly backorderService: BackorderService,
    private readonly backordersRepository: BackordersRepository,
  ) {}

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

    return rows.map((row) => this.mapToResponse(row));
  }

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

    return this.mapToResponse(row);
  }

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

    return this.mapToResponse(row);
  }

  private mapToResponse(row: BackorderEntity): BackorderResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      serviceTypeId: row.serviceTypeId,
      planId: row.planId,
      status: row.status,
      failureReason: row.failureReason,
      requestedConfigSnapshot: row.requestedConfigSnapshot ?? {},
      providerErrors: row.providerErrors ?? {},
      preferredAlternatives: row.preferredAlternatives ?? {},
      retryAfter: row.retryAfter,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
