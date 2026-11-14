import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';

import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../../../utils/billing-access.utils';
import type {
  ContainerManagerContainersResponseDto,
  ContainerManagerLogsResponseDto,
  ContainerManagerNetworksResponseDto,
  ContainerManagerStatsHistoryResponseDto,
} from '../dto/container-manager.dto';
import { ContainerManagerService } from '../services/container-manager.service';

@Controller('admin/billing/subscriptions/:subscriptionId/items/:itemId/container-manager')
@UsersRoles(UserRole.ADMIN)
export class AdminContainerManagerController {
  constructor(private readonly containerManagerService: ContainerManagerService) {}

  @Get('containers')
  @RequireScopes('subscriptions:admin')
  async listContainers(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerContainersResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    ensureAdmin(userInfo);

    return await this.containerManagerService.listContainers(subscriptionId, itemId, { asAdmin: true });
  }

  @Get('containers/:containerId/stats-history')
  @RequireScopes('subscriptions:admin')
  async getStatsHistory(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Param('containerId') containerId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerStatsHistoryResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    ensureAdmin(userInfo);

    return await this.containerManagerService.getStatsHistory(subscriptionId, itemId, containerId, {
      asAdmin: true,
    });
  }

  @Get('containers/:containerId/logs')
  @RequireScopes('subscriptions:admin')
  async getLogs(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Param('containerId') containerId: string,
    @Query('tail') tailRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerLogsResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    ensureAdmin(userInfo);

    return await this.containerManagerService.getLogs(subscriptionId, itemId, containerId, {
      asAdmin: true,
      tail: this.parseOptionalTail(tailRaw),
    });
  }

  @Get('networks')
  @RequireScopes('subscriptions:admin')
  async listNetworks(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerNetworksResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    ensureAdmin(userInfo);

    return await this.containerManagerService.listNetworks(subscriptionId, itemId, { asAdmin: true });
  }

  private parseOptionalTail(raw: string | undefined): number | undefined {
    if (raw == null || raw.trim() === '') {
      return undefined;
    }

    const parsed = Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed)) {
      throw new BadRequestException('Invalid tail parameter');
    }

    return parsed;
  }
}
