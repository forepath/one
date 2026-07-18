import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';

import { CreateUsageRecordDto } from '../dto/create-usage-record.dto';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { UsageService } from '../services/usage.service';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('admin/usage')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class AdminUsageController {
  constructor(
    private readonly usageService: UsageService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
  ) {}

  @Post('record')
  @RequireScopes('usage:write')
  async record(@Body() body: CreateUsageRecordDto, @Req() req?: RequestWithUser) {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId && !userInfo.isApiKeyAuth) {
      throw new BadRequestException('User not authenticated');
    }

    ensureAdmin(userInfo);
    await this.subscriptionsRepository.findByIdOrThrow(body.subscriptionId);

    const record = await this.usageService.createUsage({
      subscriptionId: body.subscriptionId,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      usagePayload: body.usagePayload ?? {},
      usageSource: userInfo.isApiKeyAuth ? 'api-key' : 'admin',
    });

    return { id: record.id };
  }
}
