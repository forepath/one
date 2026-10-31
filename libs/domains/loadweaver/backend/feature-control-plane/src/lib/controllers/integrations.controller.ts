import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, Matches } from 'class-validator';

import type { IntegrationEnvStatus } from '../integrations/integrations-env';
import {
  INTEGRATION_TEST_KINDS,
  IntegrationsService,
  type IntegrationTestKind,
  type IntegrationTestResult,
} from '../integrations/integrations.service';

/** Connection tests reach external services: a few per minute and caller are plenty. */
const TEST_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

export class IntegrationTestDto {
  @IsIn(INTEGRATION_TEST_KINDS)
  kind!: IntegrationTestKind;

  /** Resource name, or the SIEM target's name (`Cluster.spec.observability.siem[].name`). */
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  name!: string;
}

/**
 * External integrations (3.41): the read-only status of env-configured integrations (cluster admins) and connection
 * tests of the applied providers (the write rule of the tested resource; see `INTEGRATION_TEST_ACCESS`).
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @RequireScopes('cluster:read')
  async status(@Req() req?: RequestWithUser): Promise<{ env: IntegrationEnvStatus[] }> {
    return { env: await this.integrations.status(req) };
  }

  /**
   * PAT: `cluster:read` for the route, plus `cluster:nodes` (DnsProvider, BackupTarget, IpPool) or `cluster:admin`
   * (SiemTarget), checked per kind.
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Throttle(TEST_THROTTLE)
  @RequireScopes('cluster:read')
  async test(@Body() dto: IntegrationTestDto, @Req() req?: RequestWithUser): Promise<IntegrationTestResult> {
    return await this.integrations.test(req, { kind: dto.kind, name: dto.name });
  }
}
