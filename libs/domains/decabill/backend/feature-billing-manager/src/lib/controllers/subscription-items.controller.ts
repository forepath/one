import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { ServerInfoResponseDto } from '../dto/server-info-response.dto';
import { SubscriptionItemServerService } from '../services/subscription-item-server.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('subscriptions/:subscriptionId/items')
export class SubscriptionItemsController {
  constructor(private readonly subscriptionItemServerService: SubscriptionItemServerService) {}

  @Get()
  async listItems(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Req() req?: RequestWithUser,
  ) {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.subscriptionItemServerService.listItems(subscriptionId, userInfo.userId);
  }

  @Get(':itemId/server-info')
  async getServerInfo(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ServerInfoResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const info = await this.subscriptionItemServerService.getServerInfo(subscriptionId, itemId, userInfo.userId);

    return toServerInfoResponse(info);
  }

  @Post(':itemId/actions/start')
  async startServer(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ success: boolean }> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionItemServerService.startServer(subscriptionId, itemId, userInfo.userId);

    return { success: true };
  }

  @Post(':itemId/actions/stop')
  async stopServer(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ success: boolean }> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionItemServerService.stopServer(subscriptionId, itemId, userInfo.userId);

    return { success: true };
  }

  @Post(':itemId/actions/restart')
  async restartServer(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ success: boolean }> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionItemServerService.restartServer(subscriptionId, itemId, userInfo.userId);

    return { success: true };
  }
}

function toServerInfoResponse(info: {
  name: string;
  publicIp: string;
  privateIp?: string;
  status: string;
  metadata?: Record<string, unknown>;
  hostname?: string;
  hostnameFqdn?: string;
}): ServerInfoResponseDto {
  return {
    name: info.name,
    publicIp: info.publicIp,
    privateIp: info.privateIp,
    status: info.status,
    metadata: info.metadata,
    hostname: info.hostname,
    hostnameFqdn: info.hostnameFqdn,
  };
}
