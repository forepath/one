import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { CreateUsageRecordDto } from '../dto/create-usage-record.dto';
import { UsageSummaryDto } from '../dto/usage-summary.dto';
import { SubscriptionService } from '../services/subscription.service';
import { UsageService } from '../services/usage.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('usage')
export class UsageController {
  constructor(
    private readonly usageService: UsageService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get('summary/:subscriptionId')
  async summary(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Req() req?: RequestWithUser,
  ): Promise<UsageSummaryDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionService.getSubscription(subscriptionId, userInfo.userId);
    const usage = await this.usageService.getLatestUsage(subscriptionId);

    if (!usage) {
      return {
        subscriptionId,
        periodStart: new Date(0),
        periodEnd: new Date(0),
        usagePayload: {},
      };
    }

    return {
      subscriptionId: usage.subscriptionId,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      usagePayload: usage.usagePayload,
    };
  }

  @Post('record')
  async record(@Body() body: CreateUsageRecordDto, @Req() req?: RequestWithUser) {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionService.getSubscription(body.subscriptionId, userInfo.userId);
    const record = await this.usageService.createUsage({
      subscriptionId: body.subscriptionId,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      usagePayload: body.usagePayload ?? {},
      usageSource: 'dataset',
    });

    return { id: record.id };
  }
}
