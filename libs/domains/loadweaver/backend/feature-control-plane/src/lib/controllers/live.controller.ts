import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';

import { LiveRecordsService, type TerminalSessionDto, type TunnelDto } from '../live/live-records.service';

export class LiveSessionsQueryDto {
  @IsOptional()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project?: string;
}

/** Terminal sessions (audit records and recordings) and open debug tunnels (3.19). */
@Controller('live')
export class LiveController {
  constructor(private readonly sessions: LiveRecordsService) {}

  @Get('sessions')
  @RequireScopes('audit:read')
  async list(@Query() q: LiveSessionsQueryDto, @Req() req?: RequestWithUser): Promise<TerminalSessionDto[]> {
    return await this.sessions.sessions(req, q.project);
  }

  @Get('sessions/:id/recording')
  @RequireScopes('audit:read')
  async recording(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<StreamableFile> {
    const cast = await this.sessions.recording(req, id);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="session-${id}.cast"`);

    return new StreamableFile(cast);
  }

  @Get('tunnels')
  @RequireScopes('projects:read')
  async tunnels(@Req() req?: RequestWithUser): Promise<TunnelDto[]> {
    return await this.sessions.tunnels(req);
  }
}
