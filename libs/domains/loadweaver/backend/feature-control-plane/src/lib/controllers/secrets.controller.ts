import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import { IsBase64, IsOptional, IsString, MaxLength } from 'class-validator';

import { atLeast, projectRole } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { actorFromRequest } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { MAX_SECRET_BYTES, SecretsService, type SecretDto, type SecretVersionDto } from '../services/secrets.service';
import { NodeNamePipe } from '../utils/name.pipe';

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
 * Project secrets (3.22). Values are write-only: the API returns versions and fingerprints, never values.
 * Project admins and operators manage ordinary secrets; platform-reserved names require a cluster admin.
 */
@Controller('projects/:project/secrets')
export class SecretsController {
  constructor(
    private readonly secrets: SecretsService,
    private readonly access: ClusterAccessService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  private async assertWrite(req: RequestWithUser | undefined, project: string, name: string): Promise<void> {
    const caller = await this.projectAccess.caller(req);

    // Check roles before looking up the project, so non-members cannot discover whether it exists.
    if (!atLeast(projectRole(caller, project), 'operator'))
      throw new ForbiddenException('project operator or admin role required');

    if (name.startsWith('lw-') && caller.clusterRole !== 'cluster-admin')
      throw new ForbiddenException('platform-reserved secrets require a cluster admin');
  }

  @Get()
  @RequireScopes('secrets:read')
  async list(@Param('project', NodeNamePipe) project: string, @Req() req?: RequestWithUser): Promise<SecretDto[]> {
    await this.access.assert(req, 'admin');

    return await this.secrets.list(project);
  }

  @Put(':name')
  @RequireScopes('secrets:write')
  async set(
    @Param('project', NodeNamePipe) project: string,
    @Param('name') name: string,
    @Body() dto: SetSecretDto,
    @Req() req?: RequestWithUser,
  ): Promise<SecretVersionDto> {
    await this.assertWrite(req, project, name);

    const value =
      dto.valueBase64 !== undefined ? Buffer.from(dto.valueBase64, 'base64') : Buffer.from(dto.value ?? '', 'utf8');

    try {
      return await this.secrets.setValue(project, name, value, actorFromRequest(req), { req });
    } finally {
      value.fill(0);
    }
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('secrets:write')
  async remove(
    @Param('project', NodeNamePipe) project: string,
    @Param('name') name: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.assertWrite(req, project, name);
    await this.secrets.remove(project, name, actorFromRequest(req), { req });
  }
}
