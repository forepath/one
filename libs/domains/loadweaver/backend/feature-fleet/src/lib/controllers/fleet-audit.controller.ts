import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Query, Req } from '@nestjs/common';

import { FleetAuditQueryDto } from '../dto/fleet.dto';
import { FleetAccessService } from '../services/fleet-access.service';
import { FleetAuditService, type FleetAuditEntryDto } from '../services/fleet-audit.service';

/** The fleet's own audit log (fleet admins). */
@Controller('audit')
export class FleetAuditController {
  constructor(
    private readonly access: FleetAccessService,
    private readonly audit: FleetAuditService,
  ) {}

  @Get()
  @RequireScopes('fleet:admin')
  async list(@Query() query: FleetAuditQueryDto, @Req() req?: RequestWithUser): Promise<FleetAuditEntryDto[]> {
    this.access.assertAdmin(this.access.caller(req));

    return await this.audit.list({
      clusterId: query.cluster,
      action: query.action,
      before: query.before,
      limit: query.limit,
    });
  }
}
