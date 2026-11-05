import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { RequireInteractiveSession } from '../decorators/require-scopes.decorator';
import { AppAuthorizationDecisionDto, AppAuthorizationRequestQueryDto } from '../dto/auth/identity-app.dto';
import { UsersAuthGuard, type AuthenticatedUsersRequestUser } from '../guards/users-auth.guard';
import { IdentityAppAuthorizationService } from '../services/identity-app-authorization.service';
import { IdentityAppsService } from '../services/identity-apps.service';

interface RequestWithUser extends Request {
  user?: AuthenticatedUsersRequestUser;
}

/** Second-factor checks on approve: same budget as login. */
const AUTH_SECRET_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Grant page API and the user's own authorized apps. Interactive sessions only: a PAT or app token can never
 * approve an app (that would let a machine credential mint new credentials).
 */
@Controller('auth/apps')
@UseGuards(UsersAuthGuard)
@RequireInteractiveSession()
export class IdentityAppAuthorizationController {
  constructor(
    private readonly authorizationService: IdentityAppAuthorizationService,
    private readonly appsService: IdentityAppsService,
  ) {}

  /** What the grant page shows: app, grantable vs. ungrantable scopes, 2FA requirement. Read-only. */
  @Get('authorize')
  async getAuthorization(@Query() query: AppAuthorizationRequestQueryDto, @Req() req: RequestWithUser) {
    return this.authorizationService.getAuthorizationInfo(req.user!.id, query.app_id);
  }

  /** Approve or deny; returns the redirect to the app's registered return URL. */
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('authorize')
  @HttpCode(HttpStatus.OK)
  async decide(@Body() dto: AppAuthorizationDecisionDto, @Req() req: RequestWithUser) {
    const request = {
      appId: dto.appId,
      state: dto.state,
      codeChallenge: dto.codeChallenge,
      codeChallengeMethod: dto.codeChallengeMethod,
    };
    const redirectUrl =
      dto.decision === 'approve'
        ? await this.authorizationService.approve(req.user!.id, request, dto.code)
        : await this.authorizationService.deny(req.user!.id, request);

    return { redirectUrl };
  }

  @Get('grants')
  async listOwnGrants(@Req() req: RequestWithUser) {
    return this.appsService.listOwnGrants(req.user!.id);
  }

  @Delete('grants/:grantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOwnGrant(@Param('grantId', ParseUUIDPipe) grantId: string, @Req() req: RequestWithUser) {
    await this.appsService.revokeOwnGrant(req.user!.id, grantId);
  }
}
