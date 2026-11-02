import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { MetricsStore, type Series } from '../metrics/metrics.store';
import { toCsv } from '../utils/csv.utils';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

class RangeDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class MetricQueryDto extends RangeDto {
  @Matches(/^[a-z][a-z0-9_.]{0,63}$/)
  metric!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  entity?: string;

  @IsOptional()
  @Matches(NAME)
  node?: string;

  @IsOptional()
  @Matches(NAME)
  project?: string;

  @IsOptional()
  @IsIn(['entity', 'node', 'project', 'none'])
  groupBy?: 'entity' | 'node' | 'project' | 'none';

  @IsOptional()
  @IsIn(['avg', 'min', 'max', 'sum'])
  aggregation?: 'avg' | 'min' | 'max' | 'sum';
}

export class MetricExportDto extends MetricQueryDto {
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

export class FlowQueryDto extends RangeDto {
  @IsOptional()
  @IsIn(['allowed', 'denied', 'observed'])
  decision?: 'allowed' | 'denied' | 'observed';

  @IsOptional()
  @Matches(NAME)
  node?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  policy?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class EventQueryDto extends RangeDto {
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_.-]{0,63}$/)
  kind?: string;

  @IsOptional()
  @Matches(NAME)
  project?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class PrometheusQueryDto {
  @IsOptional()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project?: string;
}

/** Metrics, flows and event markers (3.18): resolution picked by range, scoped by access, exportable. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsStore) {}

  /** Metric names the caller has data for (series pickers). */
  @Get('names')
  @RequireScopes('metrics:read')
  async names(@Req() req?: RequestWithUser): Promise<string[]> {
    return await this.metrics.metricNames(req);
  }

  @Get('query')
  @RequireScopes('metrics:read')
  async query(@Query() dto: MetricQueryDto, @Req() req?: RequestWithUser): Promise<{ step: string; series: Series[] }> {
    return await this.metrics.query(req, dto);
  }

  @Get('export')
  @RequireScopes('metrics:read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async export(@Query() dto: MetricExportDto, @Req() req?: RequestWithUser): Promise<string> {
    const { format, ...query } = dto;
    const result = await this.metrics.query(req, query);

    if (format === 'json') return JSON.stringify(result);

    return toCsv(
      ['series', 'time', 'value'],
      result.series.flatMap((s) => s.points.map(([t, v]) => [s.key, t, v])),
    );
  }

  /** Prometheus scrape target (bearer token, e.g. a PAT with `metrics:read`); only what the caller may read. */
  @Get('prometheus')
  @RequireScopes('metrics:read')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async prometheus(@Query() dto: PrometheusQueryDto, @Req() req?: RequestWithUser): Promise<string> {
    return await this.metrics.prometheus(req, dto.project);
  }

  @Get('flows')
  @RequireScopes('metrics:read')
  async flows(@Query() dto: FlowQueryDto, @Req() req?: RequestWithUser) {
    return await this.metrics.flows(req, dto);
  }

  @Get('events')
  @RequireScopes('metrics:read')
  async events(@Query() dto: EventQueryDto, @Req() req?: RequestWithUser) {
    return await this.metrics.events(req, dto);
  }
}
