import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { AlertService, type AlertDto, type SilenceDto } from '../alerts/alert.service';
import { toCsv } from '../utils/csv.utils';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class ListAlertsQueryDto {
  @IsOptional()
  @IsIn(['open', 'resolved', 'all'])
  state?: 'open' | 'resolved' | 'all';

  @IsOptional()
  @Matches(NAME)
  project?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class ExportAlertsQueryDto extends ListAlertsQueryDto {
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

export class ListSilencesQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  expired?: boolean;
}

export class CreateSilenceDto {
  /** A rule name (`builtin:node-down`, `rule:<project>/<name>`) or a prefix ending in `*`. */
  @IsOptional()
  @Matches(/^[a-z0-9:_/.*-]{1,255}$/)
  rule?: string;

  @IsOptional()
  @Matches(NAME)
  project?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  key?: string;

  @IsString()
  @MaxLength(1024)
  @Matches(/\S/)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsISO8601()
  endsAt!: string;
}

/** Alerts, acknowledgements and silences (3.18). */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertService) {}

  @Get()
  @RequireScopes('alerts:read')
  async list(@Query() query: ListAlertsQueryDto, @Req() req?: RequestWithUser): Promise<AlertDto[]> {
    return await this.alerts.list(req, query);
  }

  /** CSV / JSON export of the alert list (3.18), same filters and scoping. */
  @Get('export')
  @RequireScopes('alerts:read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment')
  async export(@Query() query: ExportAlertsQueryDto, @Req() req?: RequestWithUser): Promise<string> {
    const { format, ...filter } = query;
    const alerts = await this.alerts.list(req, { state: 'all', ...filter, limit: filter.limit ?? 1000 });

    if (format === 'json') return JSON.stringify(alerts);

    return toCsv(
      [
        'id',
        'rule',
        'key',
        'project',
        'severity',
        'state',
        'title',
        'value',
        'startedAt',
        'firedAt',
        'resolvedAt',
        'acknowledgedBy',
      ],
      alerts.map((a) => [
        a.id,
        a.rule,
        a.key,
        a.project,
        a.severity,
        a.state,
        a.title,
        a.value,
        a.startedAt,
        a.firedAt,
        a.resolvedAt,
        a.acknowledgedBy,
      ]),
    );
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequireScopes('alerts:write')
  async acknowledge(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<AlertDto> {
    return await this.alerts.acknowledge(req, id);
  }

  @Get('silences')
  @RequireScopes('alerts:read')
  async silences(@Query() query: ListSilencesQueryDto, @Req() req?: RequestWithUser): Promise<SilenceDto[]> {
    return await this.alerts.silences(req, query.expired === true);
  }
  @Get(':id')
  @RequireScopes('alerts:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<AlertDto> {
    return await this.alerts.get(req, id);
  }

  @Post('silences')
  @RequireScopes('alerts:write')
  async createSilence(@Body() dto: CreateSilenceDto, @Req() req?: RequestWithUser): Promise<SilenceDto> {
    return await this.alerts.createSilence(req, dto);
  }

  @Delete('silences/:id')
  @HttpCode(204)
  @RequireScopes('alerts:write')
  async endSilence(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.alerts.endSilence(req, id);
  }
}
