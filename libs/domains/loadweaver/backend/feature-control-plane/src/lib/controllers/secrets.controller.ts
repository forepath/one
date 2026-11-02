import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBase64, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { atLeast, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { actorFromRequest, ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';
import {
  capRolesToFleetIdentity,
  fleetIdentityHeader,
  fleetIdentityOf,
  isFleetRelayCaller,
} from '../fleet-identity/fleet-identity.utils';
import { MAX_SECRET_BYTES, SecretsService, type SecretSummary, type SecretNamesDto } from '../services/secrets.service';
import { NodeNamePipe } from '../utils/name.pipe';
import { SecretsResponseFilter } from './secrets-response.filter';

export class SecretNamesProjectDto {
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project!: string;
}

export class ListSecretNamesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class ListSecretsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 200;
}

export class SetSecretDto {
  /** UTF-8 value. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SECRET_BYTES)
  value?: string;

  /** Binary value, base64. */
  @IsOptional()
  @IsBase64()
  @MaxLength(Math.ceil((MAX_SECRET_BYTES * 4) / 3) + 4)
  valueBase64?: string;
}

/**
 * Project secrets (3.22). Values are write-only; responses contain only safe metadata.
 * Project admins and operators manage ordinary secrets; platform-reserved names require a cluster admin.
 */
@Controller()
@UseFilters(SecretsResponseFilter)
export class SecretsController {
  constructor(
    private readonly secrets: SecretsService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  private async caller(req?: RequestWithUser): Promise<AccessCaller> {
    const identity = fleetIdentityOf(req);
    if (!identity && (isFleetRelayCaller(req, ON_BEHALF_OF_SCOPE) || fleetIdentityHeader(req)))
      throw new ForbiddenException('secrets through a fleet need a verified fleet identity');
    const caller = await this.projectAccess.caller(req);
    // ProjectAccessService's API-key fast path has no person cap; apply the same shared cap here too.
    return identity ? { ...caller, ...capRolesToFleetIdentity(caller, identity) } : caller;
  }

  private async assertWriter(req: RequestWithUser | undefined, project: string, name?: string): Promise<AccessCaller> {
    const caller = await this.caller(req);

    // Check roles before looking up the project, so non-members cannot discover whether it exists.
    if (!atLeast(projectRole(caller, project), 'operator'))
      throw new ForbiddenException('project operator or admin role required');

    if (name?.startsWith('lw-') && caller.clusterRole !== 'cluster-admin')
      throw new ForbiddenException('platform-reserved secrets require a cluster admin');
    return caller;
  }

  @Get('projects/:project/secrets')
  @Header('Cache-Control', 'no-store')
  @RequireScopes('secrets:read')
  async list(
    @Param('project', NodeNamePipe) project: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ items: SecretSummary[] }> {
    const caller = await this.assertWriter(req, project);

    return { items: await this.secrets.list(project, caller.clusterRole === 'cluster-admin') };
  }

  @Get('secrets')
  @Header('Cache-Control', 'no-store')
  @RequireScopes('secrets:read')
  async listAll(
    @Query() query: ListSecretsQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ items: SecretSummary[] }> {
    const caller = await this.caller(req);
    return { items: await this.secrets.listAll(caller, query) };
  }

  /** Writers may list names; platform names stay cluster-admin only. Not audited. */
  @Get('projects/:project/secrets/names')
  @Header('Cache-Control', 'no-store')
  @RequireScopes('secrets:read')
  async listNames(
    @Param() params: SecretNamesProjectDto,
    @Query() query: ListSecretNamesQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<SecretNamesDto> {
    const caller = await this.assertWriter(req, params.project);

    return await this.secrets.listNames(params.project, query.q, query.limit, caller.clusterRole === 'cluster-admin');
  }

  @Put('projects/:project/secrets/:name')
  @Header('Cache-Control', 'no-store')
  @RequireScopes('secrets:write')
  async set(
    @Param('project', NodeNamePipe) project: string,
    @Param('name') name: string,
    @Body() dto: SetSecretDto,
    @Req() req?: RequestWithUser,
  ): Promise<SecretSummary> {
    await this.assertWriter(req, project, name);

    const value =
      dto.valueBase64 !== undefined ? Buffer.from(dto.valueBase64, 'base64') : Buffer.from(dto.value ?? '', 'utf8');

    try {
      return await this.secrets.setValue(project, name, value, actorFromRequest(req), { req });
    } finally {
      value.fill(0);
    }
  }

  @Delete('projects/:project/secrets/:name')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('secrets:write')
  async remove(
    @Param('project', NodeNamePipe) project: string,
    @Param('name') name: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.assertWriter(req, project, name);
    await this.secrets.remove(project, name, actorFromRequest(req), { req });
  }
}
