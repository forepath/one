import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { RequireInteractiveSession } from '../decorators/require-scopes.decorator';
import { CreatePersonalAccessTokenDto, UpdatePersonalAccessTokenDto } from '../dto/auth/personal-access-token.dto';
import { UsersAuthGuard, type AuthenticatedUsersRequestUser } from '../guards/users-auth.guard';
import { PersonalAccessTokenService } from '../services/personal-access-token.service';

interface RequestWithUser extends Request {
  user?: AuthenticatedUsersRequestUser;
}

/**
 * PAT lifecycle (list/create/update/revoke). Auth:
 * - users mode: UsersAuthGuard (APP + controller) validates password JWT
 * - keycloak mode: global Keycloak/PAT chain authenticates; UsersAuthGuard requires synced `user.id`
 *
 * Admin list/revoke use both `@KeycloakRoles` (interactive OIDC) and `@UsersRoles` (PAT JWT / users-mode).
 */
@Controller()
@UseGuards(UsersAuthGuard)
export class PersonalAccessTokensController {
  constructor(private readonly patService: PersonalAccessTokenService) {}

  @RequireInteractiveSession()
  @Get('auth/token-scopes')
  async listScopes(@Req() req: RequestWithUser) {
    // Grant catalog must follow DB role (JWT role can lag demotion).
    return (await this.patService.getCatalogForUser(req.user!.id)).map((scope) => ({ scope }));
  }

  @RequireInteractiveSession()
  @Get('auth/tokens')
  async listOwn(@Req() req: RequestWithUser) {
    return (await this.patService.listForUser(req.user!.id)).map((item) => this.toResponse(item));
  }

  @RequireInteractiveSession()
  @Post('auth/tokens')
  async create(@Body() dto: CreatePersonalAccessTokenDto, @Req() req: RequestWithUser) {
    const created = await this.patService.create(req.user!.id, {
      name: dto.name,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    return this.toResponse(created, created.token);
  }

  @RequireInteractiveSession()
  @Patch('auth/tokens/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonalAccessTokenDto,
    @Req() req: RequestWithUser,
  ) {
    const updated = await this.patService.update(req.user!.id, id, {
      name: dto.name,
      scopes: dto.scopes,
    });

    return this.toResponse(updated);
  }

  @RequireInteractiveSession()
  @Delete('auth/tokens/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOwn(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    await this.patService.revoke(req.user!.id, id);
  }

  @RequireInteractiveSession()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @Get('users/:userId/tokens')
  async listForUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return (await this.patService.listForUserAdmin(userId)).map((item) => this.toResponse(item));
  }

  @RequireInteractiveSession()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @Delete('users/:userId/tokens/:tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
  ) {
    await this.patService.revokeAsAdmin(userId, tokenId);
  }

  private toResponse(
    item: {
      id: string;
      name: string;
      tokenPrefix: string;
      scopes: string[];
      expiresAt: Date | null;
      revokedAt: Date | null;
      lastUsedAt: Date | null;
      createdAt: Date;
    },
    token?: string,
  ) {
    return {
      id: item.id,
      name: item.name,
      tokenPrefix: item.tokenPrefix,
      scopes: item.scopes,
      expiresAt: item.expiresAt?.toISOString() ?? null,
      revokedAt: item.revokedAt?.toISOString() ?? null,
      lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      ...(token ? { token } : {}),
    };
  }
}
