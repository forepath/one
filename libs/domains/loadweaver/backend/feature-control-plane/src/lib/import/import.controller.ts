import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import type { PlanResponseDto } from '../dto/plan.dto';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';

import { NodeNamePipe } from '../utils/name.pipe';
import { ZodValidationPipe } from '../utils/zod-validation.pipe';
import { ImportService, type ImportDetail, type ImportSelectionView, type ImportSummary } from './import.service';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The import wizard's selections (3.21). */
export const importSelectionsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            item: z.string().regex(/^(compose|container):.{1,256}$/),
            choice: z.enum(['import', 'migrate', 'ignore']),
            project: z.string().regex(NAME).optional(),
            deployment: z.string().regex(NAME).optional(),
            http: z.record(z.string().regex(/^\d{1,5}$/), z.string().max(253)).optional(),
            volumes: z.record(z.string().max(4200), z.enum(['copy', 'empty', 'keep'])).optional(),
            variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096)).optional(),
          })
          .strict(),
      )
      .max(1024),
    wipeFormerIdentity: z.boolean().optional(),
  })
  .strict();

/** Import of existing Docker hosts and former nodes (3.21): discoveries, wizard selections, join plans. */
@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Get()
  @RequireScopes('cluster:read')
  async list(@Req() req?: RequestWithUser): Promise<ImportSummary[]> {
    return await this.imports.list(req);
  }

  @Get(':node')
  @RequireScopes('cluster:read')
  async get(@Param('node', NodeNamePipe) node: string, @Req() req?: RequestWithUser): Promise<ImportDetail> {
    return await this.imports.get(req, node);
  }

  @Post(':node/discover')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes('plans:create')
  async discover(
    @Param('node', NodeNamePipe) node: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ request: string }> {
    return await this.imports.requestDiscovery(req, node);
  }

  @Put(':node/selection')
  @RequireScopes('plans:create')
  async select(
    @Param('node', NodeNamePipe) node: string,
    @Body(new ZodValidationPipe(importSelectionsSchema)) body: z.infer<typeof importSelectionsSchema>,
    @Req() req?: RequestWithUser,
  ): Promise<ImportSelectionView> {
    return await this.imports.saveSelections(req, node, body);
  }

  @Post(':node/plan')
  @RequireScopes('plans:create')
  async plan(@Param('node', NodeNamePipe) node: string, @Req() req?: RequestWithUser): Promise<PlanResponseDto> {
    return await this.imports.createPlan(req, node);
  }

  @Delete(':node')
  @RequireScopes('plans:create')
  async discard(
    @Param('node', NodeNamePipe) node: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ discarded: boolean; nodeLeft: boolean }> {
    return await this.imports.discard(req, node);
  }
}
