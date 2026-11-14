import { RequireScopes } from '@forepath/identity/backend';
import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';

import { getUserFromRequest, type RequestWithUser } from '../../../utils/billing-access.utils';
import type {
  ContainerManagerContainersResponseDto,
  ContainerManagerLogsResponseDto,
  ContainerManagerNetworksResponseDto,
  ContainerManagerStatsHistoryResponseDto,
} from '../dto/container-manager.dto';
import { ContainerManagerService } from '../services/container-manager.service';

@Controller('subscriptions/:subscriptionId/items/:itemId/container-manager')
export class ContainerManagerController {
  constructor(private readonly containerManagerService: ContainerManagerService) {}

  @RequireScopes('subscriptions:read')
  @Get('containers')
  async listContainers(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerContainersResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.containerManagerService.listContainers(subscriptionId, itemId, {
      userId: userInfo.userId,
    });
  }

  @RequireScopes('subscriptions:read')
  @Get('containers/:containerId/stats-history')
  async getStatsHistory(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Param('containerId') containerId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerStatsHistoryResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.containerManagerService.getStatsHistory(subscriptionId, itemId, containerId, {
      userId: userInfo.userId,
    });
  }

  @RequireScopes('subscriptions:read')
  @Get('containers/:containerId/logs')
  async getLogs(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Param('containerId') containerId: string,
    @Query('tail') tailRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerLogsResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.containerManagerService.getLogs(subscriptionId, itemId, containerId, {
      userId: userInfo.userId,
      tail: this.parseOptionalTail(tailRaw),
    });
  }

  @RequireScopes('subscriptions:read')
  @Get('networks')
  async listNetworks(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ContainerManagerNetworksResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.containerManagerService.listNetworks(subscriptionId, itemId, {
      userId: userInfo.userId,
    });
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
