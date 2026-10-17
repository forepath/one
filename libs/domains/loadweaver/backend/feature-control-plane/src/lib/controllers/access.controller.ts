import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import {
  ProjectAccessService,
  type CrossProjectRequest,
  type ProjectSettingsDto,
} from '../access/project-access.service';
import type { ClusterMemberEntity, ClusterRole } from '../entities/cluster-member.entity';
import {
  APPROVAL_MODES,
  PROJECT_ROLES,
  type ApprovalMode,
  type ProjectMemberEntity,
  type ProjectRole,
} from '../entities/project-access.entity';
import { NodeNamePipe } from '../utils/name.pipe';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class SetClusterMemberDto {
  @IsIn(['cluster-admin', 'infra-operator', 'auditor'])
  role!: ClusterRole;
}

export class SetProjectMemberDto {
  @IsIn(PROJECT_ROLES)
  role!: ProjectRole;
}

export class ProjectSettingsPatchDto {
  @IsOptional()
  @IsIn(APPROVAL_MODES)
  approvalMode?: ApprovalMode;

  @IsOptional()
  @IsBoolean()
  developerExec?: boolean;

  @IsOptional()
  @IsBoolean()
  recordTerminals?: boolean;
}

export class AcceptPolicyDto {
  @Matches(NAME)
  project!: string;

  @Matches(NAME)
  policy!: string;

  @Matches(/^[0-9a-f]{64}$/)
  specHash!: string;
}

export class ImportAccessDto {
  @IsString()
  @MaxLength(1_048_576)
  yaml!: string;
}

/**
 * Access (3.17): cluster and project memberships, project settings and cross-project acceptances change
 * immediately (never through plan / apply) and are audited; access can be exported / imported as YAML.
 */
@Controller()
export class AccessController {
  constructor(private readonly access: ProjectAccessService) {}

  /** Who the caller is here: cluster role and project roles (the console's navigation, `loadweaver whoami`). */
  @Get('access/me')
  @RequireScopes('cluster:read')
  async me(
    @Req() req?: RequestWithUser,
  ): Promise<{ userId: string | null; clusterRole: ClusterRole | null; projects: Record<string, ProjectRole> }> {
    const caller = await this.access.caller(req);

    return {
      userId: caller.userId ?? null,
      clusterRole: caller.clusterRole ?? null,
      projects: Object.fromEntries(caller.projects),
    };
  }

  @Get('cluster/members')
  @RequireScopes('cluster:read')
  async clusterMembers(@Req() req?: RequestWithUser): Promise<ClusterMemberEntity[]> {
    return await this.access.clusterMembers(req);
  }

  @Put('cluster/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('cluster:admin')
  async setClusterMember(
    @Param('userId') userId: string,
    @Body() dto: SetClusterMemberDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.access.setClusterMember(req, userId, dto.role);
  }

  @Delete('cluster/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('cluster:admin')
  async removeClusterMember(@Param('userId') userId: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.access.setClusterMember(req, userId, null);
  }

  @Get('projects/:project/members')
  @RequireScopes('projects:read')
  async members(
    @Param('project', NodeNamePipe) project: string,
    @Req() req?: RequestWithUser,
  ): Promise<ProjectMemberEntity[]> {
    return await this.access.members(req, project);
  }

  @Put('projects/:project/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('projects:admin')
  async setMember(
    @Param('project', NodeNamePipe) project: string,
    @Param('userId') userId: string,
    @Body() dto: SetProjectMemberDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.access.setMember(req, project, userId, dto.role);
  }

  @Delete('projects/:project/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('projects:admin')
  async removeMember(
    @Param('project', NodeNamePipe) project: string,
    @Param('userId') userId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.access.setMember(req, project, userId, null);
  }

  @Get('projects/:project/settings')
  @RequireScopes('projects:read')
  async settings(
    @Param('project', NodeNamePipe) project: string,
    @Req() req?: RequestWithUser,
  ): Promise<ProjectSettingsDto> {
    return await this.access.projectSettings(req, project);
  }

  @Put('projects/:project/settings')
  @RequireScopes('projects:admin')
  async updateSettings(
    @Param('project', NodeNamePipe) project: string,
    @Body() dto: ProjectSettingsPatchDto,
    @Req() req?: RequestWithUser,
  ): Promise<ProjectSettingsDto> {
    return await this.access.updateSettings(req, project, dto);
  }

  @Get('projects/:project/requests')
  @RequireScopes('projects:read')
  async requests(
    @Param('project', NodeNamePipe) project: string,
    @Req() req?: RequestWithUser,
  ): Promise<CrossProjectRequest[]> {
    return await this.access.requests(req, project);
  }

  @Post('projects/:project/acceptances')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('projects:admin')
  async accept(
    @Param('project', NodeNamePipe) project: string,
    @Body() dto: AcceptPolicyDto,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.access.accept(req, project, dto);
  }

  @Get('access/export')
  @RequireScopes('cluster:admin')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  async exportAccess(@Req() req?: RequestWithUser): Promise<string> {
    return await this.access.exportAccess(req);
  }

  @Post('access/import')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async importAccess(@Body() dto: ImportAccessDto, @Req() req?: RequestWithUser): Promise<{ changed: number }> {
    return await this.access.importAccess(req, dto.yaml);
  }
}
