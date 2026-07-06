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
import { WithdrawSubscriptionDto } from '../dto/withdraw-subscription.dto';
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

    return (await this.subscriptionService.mapManyToResponses([subscription]))[0];
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

    return await this.subscriptionService.mapManyToResponses(rows);
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

    return (await this.subscriptionService.mapManyToResponses([row]))[0];
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

    return (await this.subscriptionService.mapManyToResponses([row]))[0];
  }

  @Post(':id/withdraw')
  async withdraw(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: WithdrawSubscriptionDto,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const { subscription, withdrawalResult } = await this.subscriptionService.withdrawSubscription(id, userInfo.userId);

    return this.subscriptionService.mapToResponse(subscription, [], undefined, withdrawalResult);
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

    return (await this.subscriptionService.mapManyToResponses([row]))[0];
  }
}
