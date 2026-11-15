import { RequireScopes } from '@forepath/identity/backend';
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { ServerInfoResponseDto } from '../dto/server-info-response.dto';
import {
  SubscriptionItemDetailResponseDto,
  SubscriptionItemResponseDto,
  SubscriptionSshAccessKeyResponseDto,
} from '../dto/subscription-item-response.dto';
import { UpdateSubscriptionItemDisplayNameDto } from '../dto/update-subscription-item-display-name.dto';
import { SubscriptionItemServerService } from '../services/subscription-item-server.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';
import { toServerInfoResponse } from '../utils/subscription-item-response.utils';

@Controller('subscriptions/:subscriptionId/items')
export class SubscriptionItemsController {
  constructor(private readonly subscriptionItemServerService: SubscriptionItemServerService) {}

  @RequireScopes('subscriptions:read')
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

  @RequireScopes('subscriptions:read')
  @Get(':itemId')
  async getItemDetail(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionItemDetailResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.subscriptionItemServerService.getItemDetail(subscriptionId, itemId, userInfo.userId);
  }

  @RequireScopes('subscriptions:write')
  @Post(':itemId/display-name')
  async updateDisplayName(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() dto: UpdateSubscriptionItemDisplayNameDto,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionItemResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.subscriptionItemServerService.updateDisplayName(
      subscriptionId,
      itemId,
      userInfo.userId,
      dto.displayName ?? null,
    );
  }

  @RequireScopes('subscriptions:write')
  @Get(':itemId/ssh-access-key')
  async getSshAccessKey(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<SubscriptionSshAccessKeyResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.subscriptionItemServerService.getSshAccessKey(subscriptionId, itemId, userInfo.userId);
  }

  @RequireScopes('subscriptions:read')
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

  @RequireScopes('subscriptions:write')
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

  @RequireScopes('subscriptions:write')
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

  @RequireScopes('subscriptions:write')
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
