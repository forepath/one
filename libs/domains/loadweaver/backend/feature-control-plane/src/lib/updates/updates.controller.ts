import type { IncomingMessage } from 'node:http';

import { Public, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { unsignedBundlesAllowed, unsignedBundlesNotice } from '@forepath/loadweaver/shared/util-release';
import { maintenanceWindowSpecSchema } from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource, In, Not } from 'typeorm';
import { z } from 'zod';

import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { assertFleetApprovalIdentity, declaredContent } from '../fleet-identity/fleet-identity.utils';
import { actorFromRequest, ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { nodeConnectedInCluster } from '../services/nodes.service';
import { ZodValidationPipe } from '../utils/zod-validation.pipe';
import { ArtifactStore } from './artifact-store';
import { AptSnapshotService } from './apt-snapshot.service';
import { BundleService, bundleMaxBytes, declaredDigestSource } from './bundle.service';
import { ContractMigrationService } from './contract-migration.service';
import { nodeWindowState } from './maintenance-window.utils';
import { ReleasesService, toReleaseDto, type ReleaseDto } from './releases.service';
import { ACTIVE_ROLLOUT_STATUSES, RolloutEntity } from './rollout.entity';
import { RolloutService, type RolloutDto } from './rollout.service';

const createRolloutSchema = z
  .object({
    version: z.string().max(64).optional(),
    host: z.boolean().optional(),
    osUpgrade: z.boolean().optional(),
  })
  .strict();
const approveSchema = z.object({ emergency: z.boolean().optional() }).strict();
const versionParam = /^\d{1,6}\.\d{1,6}\.\d{1,6}(-[0-9A-Za-z.-]{1,40})?$/;

export interface UpdatesStatusDto {
  clusterVersion: string | null;
  controlPlaneVersion: string | null;
  policy: Awaited<ReturnType<BundleService['clusterUpdates']>>;
  activeRollout: string | null;
  latestAvailable: string | null;
  /** Unsigned bundles are accepted (`LOADWEAVER_ALLOW_UNSIGNED_BUNDLES`; M6 review L1), with the reason as `notice`. */
  unsignedBundles: { allowed: boolean; notice: string | null };
  nodes: {
    name: string;
    site: string;
    controlPlane: boolean;
    connected: boolean;
    agentVersion: string | null;
    release: string | null;
    target: string | null;
    os: string | null;
    kernel: string | null;
    rebootRequired: boolean;
    overrides: string[];
    components: boolean;
    window: { open: boolean; opensAt: string | null; closesAt: string | null; windows: string[] };
  }[];
  contractMigrations: { ready: boolean; blockers: string[] };
}

/**
 * Updates (3.26): releases, bundle download / upload, update plans and their rollout. Reading needs a cluster role;
 * importing bundles and planning / running updates are cluster-admin actions.
 */
@Controller('updates')
export class UpdatesController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClusterAccessService,
    private readonly releases: ReleasesService,
    private readonly bundles: BundleService,
    private readonly rollouts: RolloutService,
    private readonly contracts: ContractMigrationService,
  ) {}

  @Get('status')
  @RequireScopes('cluster:read')
  async status(@Req() req?: RequestWithUser): Promise<UpdatesStatusDto> {
    await this.access.assert(req, 'read');

    const nodes = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } });
    const windows = (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'MaintenanceWindow' } }))
      .map((r) => ({ name: r.name, parsed: maintenanceWindowSpecSchema.safeParse(r.spec) }))
      .flatMap((w) => (w.parsed.success ? [{ name: w.name, spec: w.parsed.data }] : []));
    const policy = await this.bundles.clusterUpdates();
    const active = await this.dataSource
      .getRepository(RolloutEntity)
      .findOne({ where: { status: In([...ACTIVE_ROLLOUT_STATUSES]) } });
    const contract = await this.contracts.readiness();
    const now = new Date();

    return {
      clusterVersion: await this.releases.clusterVersion(),
      controlPlaneVersion: this.releases.installedVersion(),
      policy,
      activeRollout: active?.id ?? null,
      latestAvailable: (await this.releases.availableNewer(policy.channel)).pop()?.version ?? null,
      unsignedBundles: { allowed: unsignedBundlesAllowed(), notice: unsignedBundlesNotice() },
      nodes: nodes.map((n) => {
        const window = nodeWindowState(windows, { name: n.name, site: n.site, labels: n.labels }, now);

        return {
          name: n.name,
          site: n.site,
          controlPlane: n.controlPlane,
          // A fresh heartbeat, like the nodes list (also live during the read-only fallback, 2026-10-31).
          connected: nodeConnectedInCluster(n, now.getTime()),
          agentVersion: n.agentVersion,
          release: n.componentVersions?.release ?? null,
          target: n.componentTarget?.release ?? null,
          os: n.os ? `${n.os.id} ${n.os.versionId}` : null,
          kernel: n.componentVersions?.kernel ?? n.os?.kernel ?? null,
          rebootRequired: !!n.componentVersions?.rebootRequired,
          overrides: n.componentVersions?.overrides ?? [],
          components: n.protocolFeatures.includes('components'),
          window: {
            open: window.open,
            opensAt: window.opensAt?.toISOString() ?? null,
            closesAt: window.closesAt?.toISOString() ?? null,
            windows: window.windows,
          },
        };
      }),
      contractMigrations: { ready: contract.ready, blockers: contract.blockers.slice(0, 20) },
    };
  }

  @Get('releases')
  @RequireScopes('cluster:read')
  async list(@Req() req?: RequestWithUser): Promise<ReleaseDto[]> {
    await this.access.assert(req, 'read');

    return await this.releases.list();
  }

  /** Downloads and imports a release's bundle (GitHub release or mirror) in the background. */
  @Post('releases/:version/download')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes('cluster:admin')
  async download(
    @Param('version') version: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ version: string; status: string }> {
    await this.access.assert(req, 'admin');

    if (!versionParam.test(version)) throw new BadRequestException('invalid version');

    void this.bundles.fetch(version, actorFromRequest(req)).catch(() => undefined);

    return { version, status: 'importing' };
  }

  /**
   * Air-gapped import: the bundle as the request body (`application/x-tar` or `application/octet-stream`), streamed and
   * verified before anything is stored; at most `LOADWEAVER_BUNDLE_MAX_BYTES`.
   */
  @Post('bundles')
  @RequireScopes('cluster:admin')
  async upload(@Req() req: RequestWithUser & IncomingMessage): Promise<ReleaseDto> {
    await this.access.assert(req, 'admin');

    const length = Number(req.headers['content-length'] ?? 0);

    if (length > bundleMaxBytes()) throw new PayloadTooLargeException('the bundle exceeds the size limit');

    if (/json|form/.test(String(req.headers['content-type'] ?? '')))
      throw new BadRequestException('send the bundle as application/x-tar');

    // Declared length + SHA-256 (optional natively; through a fleet the claim binds them): checked after receipt.
    const declared = declaredContent(req.headers as Record<string, string | string[] | undefined>);

    if (!declared) return toReleaseDto(await this.bundles.importStream(req, 'upload', actorFromRequest(req)));

    const checked = declaredDigestSource(req, declared);

    return toReleaseDto(
      await this.bundles.importStream(checked.source, 'upload', actorFromRequest(req), undefined, checked.verify),
    );
  }

  @Get('rollouts')
  @RequireScopes('cluster:read')
  async rolloutList(@Query('limit') limit?: string, @Req() req?: RequestWithUser): Promise<RolloutDto[]> {
    await this.access.assert(req, 'read');

    return await this.rollouts.list(limit ? Math.min(Math.max(Number(limit) || 50, 1), 200) : 50);
  }

  @Get('rollouts/:id')
  @RequireScopes('cluster:read')
  async rollout(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<RolloutDto> {
    await this.access.assert(req, 'read');

    return await this.rollouts.get(id);
  }

  /** Plans an update: the per-node / per-component diff, notes, warnings and the failure analysis of every wave. */
  @Post('rollouts')
  @RequireScopes('cluster:admin')
  async create(
    @Body(new ZodValidationPipe(createRolloutSchema)) body: z.infer<typeof createRolloutSchema>,
    @Req() req?: RequestWithUser,
  ): Promise<RolloutDto> {
    await this.access.assert(req, 'admin');

    return await this.rollouts.create(body, actorFromRequest(req));
  }

  @Post('rollouts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>,
    @Req() req?: RequestWithUser,
  ): Promise<RolloutDto> {
    // Through a fleet only with a verified person (3.24).
    assertFleetApprovalIdentity(req, ON_BEHALF_OF_SCOPE);
    await this.access.assert(req, 'admin');

    return await this.rollouts.approve(id, actorFromRequest(req), body ?? {});
  }

  @Post('rollouts/:id/pause')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async pause(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<RolloutDto> {
    await this.access.assert(req, 'admin');

    return await this.rollouts.pause(id, actorFromRequest(req));
  }

  @Post('rollouts/:id/resume')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async resume(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<RolloutDto> {
    await this.access.assert(req, 'admin');

    return await this.rollouts.resume(id, actorFromRequest(req));
  }

  @Post('rollouts/:id/rollback')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async rollback(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<RolloutDto> {
    await this.access.assert(req, 'admin');

    return await this.rollouts.rollback(id, actorFromRequest(req));
  }

  @Post('rollouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<RolloutDto> {
    await this.access.assert(req, 'admin');

    return await this.rollouts.cancel(id, actorFromRequest(req));
  }
}

const UPDATE_FILE_THROTTLE = { default: { limit: 600, ttl: 60_000 } };

/**
 * Release files for the nodes (3.26: nodes fetch only from the cluster): artifacts by SHA-256 and the cluster-local apt
 * source. Public like the installer — they hold released software only, and the node verifies every byte (signed
 * manifest, apt's own signature checks).
 */
@Controller('updates')
@Public()
@Throttle(UPDATE_FILE_THROTTLE)
export class UpdateFilesController {
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly apt: AptSnapshotService,
  ) {}

  @Get('artifacts/:sha256')
  async artifact(@Param('sha256') sha256: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new NotFoundException('artifact not found');

    const found = await this.artifacts.get(sha256);

    if (!found) throw new NotFoundException('artifact not found');

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    return new StreamableFile(found.stream, { type: 'application/octet-stream', length: found.size });
  }

  @Get('apt/:snapshot/:source/*path')
  async aptFile(
    @Param('snapshot') snapshot: string,
    @Param('source') source: string,
    @Param('path') path: string | string[],
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const joined = Array.isArray(path) ? path.join('/') : path;
    // apt percent-encodes some characters of package file names (`~` → `%7e`); paths are matched decoded.
    let relative = joined;

    try {
      relative = /%[0-9A-Fa-f]{2}/.test(joined) ? decodeURIComponent(joined) : joined;
    } catch {
      throw new NotFoundException('not in this snapshot');
    }

    const file = await this.apt.serve(snapshot, source, relative).catch(() => null);

    if (!file) throw new NotFoundException('not in this snapshot');

    res.setHeader('X-Content-Type-Options', 'nosniff');

    return new StreamableFile(file.stream, { type: file.contentType, length: file.size });
  }
}
