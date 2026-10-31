import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';

import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';

import type { LoadweaverClusterInfoResponseDto } from './loadweaver-cluster.dto';
import { LoadweaverClusterService } from './loadweaver-cluster.service';

@Controller('subscriptions/:subscriptionId/items/:itemId/loadweaver')
export class LoadweaverClusterController {
  constructor(private readonly clusterService: LoadweaverClusterService) {}

  @RequireScopes('subscriptions:read')
  @Get('cluster')
  async getCluster(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<LoadweaverClusterInfoResponseDto> {
    const userInfo = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.clusterService.getClusterInfo(subscriptionId, itemId, { userId: userInfo.userId });
  }
}

@Controller('admin/billing/subscriptions/:subscriptionId/items/:itemId/loadweaver')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class AdminLoadweaverClusterController {
  constructor(private readonly clusterService: LoadweaverClusterService) {}

  @RequireScopes('billing_admin:read')
  @Get('cluster')
  async getCluster(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Req() req?: RequestWithUser,
  ): Promise<LoadweaverClusterInfoResponseDto> {
    ensureAdmin(getUserFromRequest(req ?? ({} as RequestWithUser)));

    return await this.clusterService.getClusterInfo(subscriptionId, itemId, { asAdmin: true });
  }
}
