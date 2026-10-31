import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';

import type { NodeResponseDto } from '../dto/node.dto';
import { actorFromRequest } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { NodesService } from '../services/nodes.service';
import { NodeNamePipe } from '../utils/name.pipe';
import type { NodePlatformComponentDto } from '../utils/node-platform.utils';

/**
 * Nodes of the cluster and their lifecycle actions (runtime actions, not plan / apply, 3.29).
 */
@Controller('nodes')
export class NodesController {
  constructor(
    private readonly nodes: NodesService,
    private readonly access: ClusterAccessService,
  ) {}

  @Get()
  @RequireScopes('cluster:read')
  async list(@Req() req?: RequestWithUser, @Query('runtime') runtime?: string): Promise<NodeResponseDto[]> {
    await this.access.assert(req, 'read');

    // `?runtime=microvm` (level ready) or `?runtime=>=sandboxed-kvm` (at least, 3.1).
    return await this.nodes.list(runtime ? { runtime } : {});
  }

  @Get(':name')
  @RequireScopes('cluster:read')
  async get(@Param('name', NodeNamePipe) name: string, @Req() req?: RequestWithUser): Promise<NodeResponseDto> {
    await this.access.assert(req, 'read');

    return await this.nodes.get(name);
  }

  /** Platform components the node runs (etcd, Postgres, registry, ingress …), read-only; same access as the node. */
  @Get(':name/platform')
  @RequireScopes('cluster:read')
  async platform(
    @Param('name', NodeNamePipe) name: string,
    @Req() req?: RequestWithUser,
  ): Promise<NodePlatformComponentDto[]> {
    await this.access.assert(req, 'read');

    return await this.nodes.platform(name);
  }

  @Post(':name/cordon')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:nodes')
  async cordon(@Param('name', NodeNamePipe) name: string, @Req() req?: RequestWithUser): Promise<NodeResponseDto> {
    await this.access.assert(req, 'infra');

    return await this.nodes.setLifecycle(name, 'cordoned', actorFromRequest(req));
  }

  /** Re-runs the node's isolation probes (3.1): cluster admins and infra operators. */
  @Post(':name/isolation-probe')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes('cluster:nodes')
  async isolationProbe(
    @Param('name', NodeNamePipe) name: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ node: string; probeNonce: string }> {
    await this.access.assert(req, 'infra');

    return await this.nodes.requestIsolationProbe(name, actorFromRequest(req));
  }

  @Post(':name/uncordon')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:nodes')
  async uncordon(@Param('name', NodeNamePipe) name: string, @Req() req?: RequestWithUser): Promise<NodeResponseDto> {
    await this.access.assert(req, 'infra');

    return await this.nodes.setLifecycle(name, 'active', actorFromRequest(req));
  }

  @Post(':name/drain')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:nodes')
  async drain(@Param('name', NodeNamePipe) name: string, @Req() req?: RequestWithUser): Promise<NodeResponseDto> {
    await this.access.assert(req, 'infra');

    return await this.nodes.setLifecycle(name, 'draining', actorFromRequest(req));
  }

  /** Operator confirmation that a node is gone (stateful failover without quorum, 3.2). Revokes its identity. */
  @Post(':name/confirm-lost')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:nodes')
  async confirmLost(@Param('name', NodeNamePipe) name: string, @Req() req?: RequestWithUser): Promise<NodeResponseDto> {
    await this.access.assert(req, 'admin');

    return await this.nodes.confirmLost(name, actorFromRequest(req));
  }

  @Post(':name/leave')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:nodes')
  async leave(@Param('name', NodeNamePipe) name: string, @Req() req?: RequestWithUser): Promise<NodeResponseDto> {
    await this.access.assert(req, 'infra');

    return await this.nodes.leave(name, actorFromRequest(req));
  }
}
