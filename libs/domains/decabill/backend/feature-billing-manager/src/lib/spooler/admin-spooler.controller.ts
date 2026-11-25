import { getMissingPatScopes, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

import { requiredScopesForSpoolJob } from './spool-job-scopes.util';
import {
  ListSpoolJobsQueryDto,
  mapSpoolJob,
  type PaginatedSpoolJobsResponseDto,
  type SpoolJobResponseDto,
} from './spooler.dto';
import { SpoolerService } from './spooler.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * Spooler page (Administration): spooled printouts and document sends of the tenant, their files, retry and cancel.
 * Visible to admins and managers.
 */
@Controller('admin/billing/spooler/jobs')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
export class AdminSpoolerController {
  constructor(private readonly spooler: SpoolerService) {}

  @RequireScopes('spooler:admin')
  @Get()
  async list(@Query() query: ListSpoolJobsQueryDto): Promise<PaginatedSpoolJobsResponseDto> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const [{ items, total }, counts] = await Promise.all([
      this.spooler.list({
        status: query.status,
        kind: query.kind,
        documentType: query.documentType,
        documentId: query.documentId,
        limit,
        offset,
      }),
      this.spooler.countByStatus(),
    ]);

    return { items: items.map(mapSpoolJob), total, limit, offset, counts };
  }

  @RequireScopes('spooler:admin')
  @Get(':id')
  async get(@Param('id', UUID) id: string): Promise<SpoolJobResponseDto> {
    return mapSpoolJob(await this.spooler.get(id));
  }

  /** File of a completed printout job. */
  @RequireScopes('spooler:admin')
  @Get(':id/file')
  async file(
    @Param('id', UUID) id: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<StreamableFile> {
    await this.assertJobScopes(id, req);

    const { content, fileName, contentType } = await this.spooler.getOutput(id);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');

    return new StreamableFile(content);
  }

  @RequireScopes('spooler:admin')
  @Post(':id/retry')
  @HttpCode(200)
  async retry(@Param('id', UUID) id: string, @Req() req?: RequestWithUser): Promise<SpoolJobResponseDto> {
    await this.assertJobScopes(id, req);

    return mapSpoolJob(await this.spooler.retry(id, getUserFromRequest(req ?? ({} as RequestWithUser)).userId));
  }

  @RequireScopes('spooler:admin')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id', UUID) id: string, @Req() req?: RequestWithUser): Promise<SpoolJobResponseDto> {
    await this.assertJobScopes(id, req);

    return mapSpoolJob(await this.spooler.cancel(id, getUserFromRequest(req ?? ({} as RequestWithUser)).userId));
  }

  /**
   * Tokens (PAT / app) additionally need the scopes of the job's own domain (e.g. `invoices:admin` + `letters:admin`
   * to retry a letter); console sessions are role-checked only, like every other admin route.
   */
  private async assertJobScopes(id: string, req?: RequestWithUser): Promise<void> {
    const user = getUserFromRequest(req ?? ({} as RequestWithUser));

    if (!(user.amr ?? []).includes('pat')) return;

    const missing = getMissingPatScopes(user.scopes ?? [], requiredScopesForSpoolJob(await this.spooler.get(id)));

    if (missing.length > 0) {
      throw new ForbiddenException(`Insufficient token scope. Missing: ${missing.join(', ')}`);
    }
  }
}
