import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { CancelSubscriptionDto } from '../dto/cancel-subscription.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { ResumeSubscriptionDto } from '../dto/resume-subscription.dto';
import { SubscriptionResponseDto } from '../dto/subscription-response.dto';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { SubscriptionService } from '../services/subscription.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  async create(@Body() dto: CreateSubscriptionDto, @Req() req?: RequestWithUser): Promise<SubscriptionResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const subscription = await this.subscriptionService.createSubscription(
      userInfo.userId,
      dto.planId,
      dto.requestedConfig,
      dto.autoBackorder ?? false,
    );

    return this.mapToResponse(subscription);
  }

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const rows = await this.subscriptionService.listSubscriptions(userInfo.userId, limit ?? 10, offset ?? 0);

    return rows.map((row) => this.mapToResponse(row));
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const row = await this.subscriptionService.getSubscription(id, userInfo.userId);

    return this.mapToResponse(row);
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: CancelSubscriptionDto,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const row = await this.subscriptionService.cancelSubscription(id, userInfo.userId);

    return this.mapToResponse(row);
  }

  @Post(':id/resume')
  async resume(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: ResumeSubscriptionDto,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const row = await this.subscriptionService.resumeSubscription(id, userInfo.userId);

    return this.mapToResponse(row);
  }

  private mapToResponse(row: SubscriptionEntity): SubscriptionResponseDto {
    return {
      id: row.id,
      number: row.number,
      planId: row.planId,
      userId: row.userId,
      status: row.status,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
      nextBillingAt: row.nextBillingAt,
      cancelRequestedAt: row.cancelRequestedAt,
      cancelEffectiveAt: row.cancelEffectiveAt,
      resumedAt: row.resumedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
