import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
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
  Query,
  Req,
} from '@nestjs/common';

import { CreateUsageRecordDto, UpdateUsageMeterEntryDto } from '../dto/create-usage-record.dto';
import { SubscriptionMeterHistoryDto } from '../dto/meter-history.dto';
import {
  PaginatedUsageMeterEntriesResponseDto,
  SubscriptionMeterSummaryDto,
  UsageMeterEntryResponseDto,
} from '../dto/meter-response.dto';
import { SubscriptionMeterHistoryQueryDto } from '../dto/subscription-meter-history-query.dto';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { MeterBillingService } from '../services/meter-billing.service';
import { UsageService } from '../services/usage.service';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';
import { parseMeterHistoryDateRange } from '../utils/meter-history-date.util';

/** Largest page of `GET :id/meter-entries`. */
const METER_ENTRIES_MAX_LIMIT = 100;

@Controller('admin/billing/subscriptions')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class AdminSubscriptionMetersController {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly usageService: UsageService,
    private readonly meterBillingService: MeterBillingService,
  ) {}

  @Get(':id/meters/history')
  @RequireScopes('billing_admin:read')
  async getMeterHistory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: SubscriptionMeterHistoryQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionMeterHistoryDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    ensureAdmin(userInfo);
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(id);
    const groupBy = query.groupBy ?? 'day';
    const { fromDate, toDate } = parseMeterHistoryDateRange(query.from, query.to, groupBy);

    return await this.meterBillingService.buildSubscriptionMeterHistory({
      subscription,
      from: fromDate,
      to: toDate,
      groupBy,
    });
  }

  @Get(':id/meters')
  @RequireScopes('billing_admin:read')
  async listMeters(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionMeterSummaryDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    ensureAdmin(userInfo);
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(id);

    return await this.meterBillingService.buildSubscriptionMeterSummaries({
      subscription,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    });
  }

  @Get(':id/meter-entries')
  @RequireScopes('billing_admin:read')
  async listEntries(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedUsageMeterEntriesResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    ensureAdmin(userInfo);
    await this.subscriptionsRepository.findByIdOrThrow(id);

    return await this.usageService.listMeterEntries(
      id,
      Math.min(Math.max(limit ?? 10, 1), METER_ENTRIES_MAX_LIMIT),
      Math.max(offset ?? 0, 0),
    );
  }

  @Post(':id/meter-entries')
  @RequireScopes('usage:write')
  async createEntry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: Omit<CreateUsageRecordDto, 'subscriptionId'>,
    @Req() req?: RequestWithUser,
  ): Promise<UsageMeterEntryResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId && !userInfo.isApiKeyAuth) {
      throw new BadRequestException('User not authenticated');
    }

    ensureAdmin(userInfo);
    await this.subscriptionsRepository.findByIdOrThrow(id);

    return await this.usageService.createMeterEntry({
      subscriptionId: id,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      usagePayload: body.usagePayload ?? {},
      usageSource: userInfo.isApiKeyAuth ? 'api-key' : 'admin',
      meterId: body.meterId,
      value: body.value,
      attachmentType: body.attachmentType,
      addonId: body.addonId,
    });
  }

  @Post(':id/meter-entries/:entryId')
  @RequireScopes('billing_admin:write')
  async updateEntry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body() body: UpdateUsageMeterEntryDto,
    @Req() req?: RequestWithUser,
  ): Promise<UsageMeterEntryResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    ensureAdmin(userInfo);
    await this.subscriptionsRepository.findByIdOrThrow(id);

    return await this.usageService.updateMeterEntry(id, entryId, body);
  }

  @Delete(':id/meter-entries/:entryId')
  @RequireScopes('billing_admin:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEntry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    ensureAdmin(userInfo);
    await this.subscriptionsRepository.findByIdOrThrow(id);
    await this.usageService.deleteMeterEntry(id, entryId);
  }
}
