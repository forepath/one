import { Public, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { SkipThrottle } from '@nestjs/throttler';
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';

import {
  INCIDENT_STATUSES,
  renderStatusPage,
  StatusPageService,
  type IncidentDto,
  type IncidentStatus,
  type PublicStatus,
} from '../health/status-page.service';
import { NodeNamePipe } from '../utils/name.pipe';

export class CreateIncidentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsIn(INCIDENT_STATUSES)
  status!: IncidentStatus;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/\S/)
  message!: string;
}

export class UpdateIncidentDto {
  @IsIn(INCIDENT_STATUSES)
  status!: IncidentStatus;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/\S/)
  message!: string;
}

/** Hostname of the request as the ingress forwarded it. */
function hostOf(req: Request): string {
  return String(req.headers.host ?? '');
}

/**
 * Public status pages (3.25), reached through the ingress for the page's hostname (`/` → `/api/public/status/`).
 * No login: they show only service states, uptime and incident notes.
 */
// Every visitor arrives through the ingress (one address per ingress node), and answers are cached for 30 s:
// a per-address limit would let one client take the page away from everyone.
@SkipThrottle()
@Public()
@Controller('public/status')
export class PublicStatusController {
  constructor(private readonly pages: StatusPageService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
  @Header('Cache-Control', 'public, max-age=30')
  async page(@Req() req: Request): Promise<string> {
    return renderStatusPage(await this.pages.publicStatus(hostOf(req)));
  }

  @Get('status.json')
  @Header('Cache-Control', 'public, max-age=30')
  async json(@Req() req: Request): Promise<PublicStatus> {
    return await this.pages.publicStatus(hostOf(req));
  }
}

/** Incident notes of a project (3.25): operators write them, members read them; shown on its status pages. */
@Controller('projects/:project/incidents')
export class IncidentsController {
  constructor(private readonly pages: StatusPageService) {}

  @Get()
  @RequireScopes('projects:read')
  async list(@Param('project', NodeNamePipe) project: string, @Req() req?: RequestWithUser): Promise<IncidentDto[]> {
    return await this.pages.incidents(req, project);
  }

  @Post()
  @RequireScopes('projects:admin')
  async create(
    @Param('project', NodeNamePipe) project: string,
    @Body() dto: CreateIncidentDto,
    @Req() req?: RequestWithUser,
  ): Promise<IncidentDto> {
    return await this.pages.createIncident(req, project, dto);
  }

  @Put(':id')
  @RequireScopes('projects:admin')
  async update(
    @Param('project', NodeNamePipe) project: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentDto,
    @Req() req?: RequestWithUser,
  ): Promise<IncidentDto> {
    return await this.pages.updateIncident(req, project, id, dto);
  }
}
