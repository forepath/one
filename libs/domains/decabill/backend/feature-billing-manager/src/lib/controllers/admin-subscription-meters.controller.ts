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
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';

import { CreateUsageRecordDto, UpdateUsageMeterEntryDto } from '../dto/create-usage-record.dto';
import { SubscriptionMeterSummaryDto, UsageMeterEntryResponseDto } from '../dto/meter-response.dto';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { MeterBillingService } from '../services/meter-billing.service';
import { UsageService } from '../services/usage.service';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('admin/billing/subscriptions')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class AdminSubscriptionMetersController {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly usageService: UsageService,
    private readonly meterBillingService: MeterBillingService,
  ) {}

  @Get(':id/meters')
  @RequireScopes('usage:read')
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
  @RequireScopes('usage:read')
  async listEntries(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<UsageMeterEntryResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    ensureAdmin(userInfo);
    await this.subscriptionsRepository.findByIdOrThrow(id);

    return await this.usageService.listMeterEntries(id);
  }

  @Post(':id/meter-entries')
  @RequireScopes('usage:write')
  async createEntry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: Omit<CreateUsageRecordDto, 'subscriptionId'>,
    @Req() req?: RequestWithUser,
  ): Promise<{ id: string }> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId && !userInfo.isApiKeyAuth) {
      throw new BadRequestException('User not authenticated');
    }

    ensureAdmin(userInfo);
    await this.subscriptionsRepository.findByIdOrThrow(id);

    const record = await this.usageService.createUsage({
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

    return { id: record.id };
  }

  @Post(':id/meter-entries/:entryId')
  @RequireScopes('usage:write')
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
  @RequireScopes('usage:write')
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
