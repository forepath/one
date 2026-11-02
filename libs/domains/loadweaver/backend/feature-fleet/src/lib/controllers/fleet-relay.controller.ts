import type { IncomingMessage, ServerResponse } from 'node:http';

import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { All, Controller, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';

import { FleetRelayService } from '../services/fleet-relay.service';

/**
 * REST relay to the clusters (3.24): `/api/clusters/:id/api/<path>` → `<cluster>/api/<path>`. Read calls need
 * `fleet:read`, changing calls `fleet:relay` (checked in the service), both bounded by the caller's grants.
 */
@Controller('clusters')
export class FleetRelayController {
  constructor(private readonly relay: FleetRelayService) {}

  @All(':id/api/*path')
  @RequireScopes('fleet:read')
  async forward(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithUser & IncomingMessage,
    @Res() res: ServerResponse,
  ): Promise<void> {
    await this.relay.relay(req, res, id);
  }
}
