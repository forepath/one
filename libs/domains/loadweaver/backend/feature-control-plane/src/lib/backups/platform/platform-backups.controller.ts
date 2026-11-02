import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { assertFleetApprovalIdentity } from '../../fleet-identity/fleet-identity.utils';
import { actorFromRequest, ON_BEHALF_OF_SCOPE } from '../../services/audit-log.service';
import { ClusterAccessService } from '../../services/cluster-access.service';
import { ZodValidationPipe } from '../../utils/zod-validation.pipe';
import {
  PlatformBackupsService,
  type PlatformBackupRunResult,
  type PlatformBackupStatusDto,
  type PlatformRestoreDto,
} from './platform-backups.service';
import { PLATFORM_BACKUP_KINDS, type PlatformBackupKind } from './platform-backups.utils';
import { PlatformCopyService, type PlatformCopyPassResult } from './platform-copy.service';
import { PlatformCutoverService, type PlatformCutoverDto } from './platform-cutover.service';
import type { DrInfoDocument } from './platform-dr.utils';
import { AuditLogService } from '../../services/audit-log.service';

const restoreSchema = z
  .object({
    /** ISO 8601 with offset; omitted = the end of the archive. */
    targetTime: z.string().max(40).optional(),
    node: z
      .string()
      .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
      .optional(),
  })
  .strict();
const openSearchRestoreSchema = z
  .object({
    snapshot: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,254}$/),
    indices: z
      .array(z.string().regex(/^[a-z0-9*][a-z0-9_.*+-]{0,254}$/))
      .min(1)
      .max(100),
    /** Restored indices are renamed `<prefix><index>`; empty restores under the original names (must not exist). */
    renamePrefix: z
      .string()
      .regex(/^([a-z0-9][a-z0-9_.-]{0,62})?$/)
      .optional(),
  })
  .strict();

/**
 * Backups of the control plane's own data (3.20): status, "back up now", point-in-time restores of the database
 * (into a new scope), index-level OpenSearch restores, etcd snapshot download. Cluster admins only (restores of the
 * control plane are cluster-level, 3.20 "self-service").
 */
@Controller('backups/platform')
export class PlatformBackupsController {
  constructor(
    private readonly backups: PlatformBackupsService,
    private readonly access: ClusterAccessService,
    private readonly copies: PlatformCopyService,
    private readonly cutovers: PlatformCutoverService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequireScopes('cluster:read')
  async status(@Req() req?: RequestWithUser): Promise<PlatformBackupStatusDto> {
    await this.access.assert(req, 'read');

    return await this.backups.status();
  }

  /** Copies the platform bucket to the external targets now (otherwise every few minutes and after each backup). Declared before
   * `:kind/run`, which would take `copies` for a kind. */
  @Post('copies/run')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async copyNow(@Req() req?: RequestWithUser): Promise<PlatformCopyPassResult[]> {
    await this.access.assert(req, 'admin');

    return await this.copies.run();
  }

  @Post(':kind/run')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async run(@Param('kind') kind: string, @Req() req?: RequestWithUser): Promise<PlatformBackupRunResult> {
    await this.access.assert(req, 'admin');

    if (!(PLATFORM_BACKUP_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('unknown kind');

    return await this.backups.run(kind as PlatformBackupKind, actorFromRequest(req));
  }

  @Get('postgres/restores')
  @RequireScopes('cluster:read')
  async restores(@Req() req?: RequestWithUser): Promise<PlatformRestoreDto[]> {
    await this.access.assert(req, 'read');

    return await this.backups.restores();
  }

  @Post('postgres/restores')
  @RequireScopes('cluster:admin')
  async restore(
    @Body(new ZodValidationPipe(restoreSchema)) body: z.infer<typeof restoreSchema>,
    @Req() req?: RequestWithUser,
  ): Promise<PlatformRestoreDto> {
    await this.access.assert(req, 'admin');

    return await this.backups.requestRestore(body, actorFromRequest(req));
  }

  @Delete('postgres/restores/:id')
  @RequireScopes('cluster:admin')
  async discard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<PlatformRestoreDto> {
    await this.access.assert(req, 'admin');

    return await this.backups.discardRestore(id, actorFromRequest(req));
  }

  @Post('opensearch/restore')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async restoreOpenSearch(
    @Body(new ZodValidationPipe(openSearchRestoreSchema)) body: z.infer<typeof openSearchRestoreSchema>,
    @Req() req?: RequestWithUser,
  ): Promise<{ indices: string[]; failedShards: number }> {
    await this.access.assert(req, 'admin');

    return await this.backups.restoreOpenSearch(body, actorFromRequest(req));
  }

  /**
   * What `loadweaver-agent bootstrap --restore --dr-info` needs besides the recovery kit and the target's credentials
   * (3.20): cluster id, database scope, the external targets (no credentials), key generations with KMS-wrapped roots.
   */
  @Get('dr-info')
  @RequireScopes('cluster:admin')
  async drInfo(@Res() res: Response, @Req() req?: RequestWithUser): Promise<void> {
    await this.access.assert(req, 'admin');

    const info: DrInfoDocument = await this.copies.drInfo();

    await this.audit.recordStandalone({
      actor: actorFromRequest(req),
      action: 'backup.dr-info-downloaded',
      target: `cluster/${info.clusterId}`,
    });
    res.setHeader('content-type', 'application/json');
    res.setHeader('content-disposition', `attachment; filename="loadweaver-dr-info-${info.clusterId}.json"`);
    res.send(`${JSON.stringify(info, null, 2)}\n`);
  }

  @Get('cutovers')
  @RequireScopes('cluster:read')
  async cutoverList(@Req() req?: RequestWithUser): Promise<PlatformCutoverDto[]> {
    await this.access.assert(req, 'read');

    return await this.cutovers.list();
  }

  /** Plans switching the control-plane database to a ready clone; a second cluster admin approves. */
  @Post('postgres/restores/:id/cutover')
  @RequireScopes('cluster:admin')
  async cutover(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<PlatformCutoverDto> {
    await this.access.assert(req, 'admin');

    return await this.cutovers.request(id, actorFromRequest(req));
  }

  @Post('cutovers/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async approveCutover(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<PlatformCutoverDto> {
    // Through a fleet only with a verified person (3.24).
    assertFleetApprovalIdentity(req, ON_BEHALF_OF_SCOPE);
    await this.access.assert(req, 'admin');

    return await this.cutovers.approve(id, actorFromRequest(req));
  }

  @Post('cutovers/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async cancelCutover(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<PlatformCutoverDto> {
    await this.access.assert(req, 'admin');

    return await this.cutovers.cancel(id, actorFromRequest(req));
  }

  @Get('etcd/:name')
  @RequireScopes('cluster:admin')
  async etcd(@Param('name') name: string, @Res() res: Response, @Req() req?: RequestWithUser): Promise<void> {
    await this.access.assert(req, 'admin');

    const snapshot = await this.backups.etcdSnapshotStream(name, actorFromRequest(req));

    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-disposition', `attachment; filename="${name}.db"`);

    if (snapshot.size) res.setHeader('content-length', String(snapshot.size));

    snapshot.body.pipe(res);
  }
}
