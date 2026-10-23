import type { Readable } from 'node:stream';

import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';

import { BackupTransferService } from './backup-transfer.service';
import type { BackupDto } from './backups.service';

const TAR_TYPES = new Set(['application/x-tar', 'application/octet-stream']);

/**
 * Cross-cluster restore / cloning through the fleet service (3.20, 3.24): whole-backup export as a tar archive,
 * import of such an archive into the catalog, and "back up everything now" (final backup before a teardown).
 */
@Controller('backups')
export class BackupTransferController {
  constructor(private readonly transfer: BackupTransferService) {}

  @Post('now/all')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async backupAll(@Req() req?: RequestWithUser): Promise<{ started: string[]; skipped: string[] }> {
    return await this.transfer.backupAll(req);
  }

  /**
   * Raw tar body (`Content-Type: application/x-tar`), streamed to a temporary file with a size cap (no body
   * parser runs for this content type).
   */
  @Post('imports')
  @RequireScopes('backups:import')
  async import(
    @Query('volume') volume: string,
    @Query('sourceCluster') sourceCluster?: string,
    @Query('sourceBackup') sourceBackup?: string,
    @Req() req?: RequestWithUser,
  ): Promise<BackupDto> {
    const type = String(req?.headers?.['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!req || !TAR_TYPES.has(type)) throw new BadRequestException('send the archive as application/x-tar');

    return await this.transfer.importArchive(
      req,
      { volume: volume ?? '', sourceCluster, sourceBackup },
      req as unknown as Readable,
    );
  }

  @Get(':id/archive')
  @RequireScopes('backups:export')
  async archive(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<StreamableFile> {
    const archive = await this.transfer.exportArchive(req, id);

    return new StreamableFile(archive.stream, {
      type: 'application/x-tar',
      length: archive.bytes,
      disposition: `attachment; filename="${archive.filename}"`,
    });
  }
}
