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
import { CreateIdentityAppDto, UpdateIdentityAppDto } from '../dto/auth/identity-app.dto';
import { UsersAuthGuard, type AuthenticatedUsersRequestUser } from '../guards/users-auth.guard';
import { IdentityAppsService } from '../services/identity-apps.service';

interface RequestWithUser extends Request {
  user?: AuthenticatedUsersRequestUser;
}

/**
 * Admin app management. Interactive admin sessions only: neither PATs nor app tokens can create apps,
 * rotate secrets or revoke authorizations (no scope can unlock these routes).
 */
@Controller('apps')
@UseGuards(UsersAuthGuard)
@RequireInteractiveSession()
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class IdentityAppsController {
  constructor(private readonly appsService: IdentityAppsService) {}

  @Get()
  async list() {
    return this.appsService.list();
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.appsService.get(id);
  }

  @Post()
  async create(@Body() dto: CreateIdentityAppDto, @Req() req: RequestWithUser) {
    return this.appsService.create(req.user!.id, dto);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIdentityAppDto) {
    return this.appsService.update(id, dto);
  }

  @Post(':id/secret')
  @HttpCode(HttpStatus.OK)
  async rotateSecret(@Param('id', ParseUUIDPipe) id: string) {
    return this.appsService.rotateSecret(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.appsService.remove(id);
  }

  @Get(':id/grants')
  async listGrants(@Param('id', ParseUUIDPipe) id: string) {
    return this.appsService.listGrants(id);
  }

  @Delete(':id/grants')
  @HttpCode(HttpStatus.OK)
  async revokeAllGrants(@Param('id', ParseUUIDPipe) id: string) {
    return this.appsService.revokeAllGrants(id);
  }

  @Delete(':id/grants/:grantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeGrant(@Param('id', ParseUUIDPipe) id: string, @Param('grantId', ParseUUIDPipe) grantId: string) {
    await this.appsService.revokeGrant(id, grantId);
  }
}
