import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { APP_NAME_PATTERN, SEMVER_PATTERN, TRUST_LABELS } from '@forepath/loadweaver/shared/util-app-catalog';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { NodeNamePipe } from '../utils/name.pipe';
import { ZodValidationPipe } from '../utils/zod-validation.pipe';
import { AppCatalogsService, type AppCatalogDto, type AppDetailDto, type AppSummaryDto } from './app-catalogs.service';
import {
  AppPlansService,
  UNINSTALL_DATA_POLICIES,
  type AppPlanResponseDto,
  type InstalledAppDto,
} from './app-plans.service';
import { SUGGESTION_GROUPS } from './app-plans.utils';

const name = z.string().regex(APP_NAME_PATTERN);
const parameters = z
  .record(z.string().max(64), z.union([z.string().max(4096), z.number(), z.boolean(), z.null()]))
  .refine((p) => Object.keys(p).length <= 200, 'at most 200 parameters');
const secrets = z
  .record(z.string().max(128), z.string().max(400))
  .refine((s) => Object.keys(s).length <= 100, 'at most 100 secrets');
const title = z.string().trim().min(1).max(200);

export const installPlanBodySchema = z
  .object({
    project: name,
    deployment: name.optional(),
    parameters: parameters.optional(),
    secrets: secrets.optional(),
    suggestions: z.array(z.enum(SUGGESTION_GROUPS)).max(SUGGESTION_GROUPS.length).optional(),
    title: title.optional(),
  })
  .strict();

export const updatePlanBodySchema = z
  .object({
    version: z.string().regex(SEMVER_PATTERN),
    parameters: parameters.optional(),
    secrets: secrets.optional(),
    backup: z.enum(['now', 'skip']).optional(),
    title: title.optional(),
  })
  .strict();

export const uninstallPlanBodySchema = z
  .object({
    dataPolicy: z.enum(UNINSTALL_DATA_POLICIES),
    confirm: z.string().max(63).optional(),
    removeSuggested: z.boolean().optional(),
    title: title.optional(),
  })
  .strict();

export const refreshBodySchema = z.object({ catalog: name.optional() }).strict();

const VERSION_PARAM = new ZodValidationPipe(z.string().regex(SEMVER_PATTERN, 'must be a semantic version'));
const OPTIONAL_VERSION = new ZodValidationPipe(z.string().regex(SEMVER_PATTERN).optional());
const OPTIONAL_NAME = new ZodValidationPipe(name.optional());
const OPTIONAL_TRUST = new ZodValidationPipe(z.enum(TRUST_LABELS).optional());
const OPTIONAL_QUERY = new ZodValidationPipe(z.string().max(200).optional());

/** Refreshes reach the catalogs' registries / repositories: a few per minute and caller. */
const REFRESH_THROTTLE = { default: { limit: 6, ttl: 60_000 } };

/**
 * App store (P1). Browsing: any project membership or cluster role. Plans (install / update / uninstall → a
 * Workspace draft): like drafting the Deployment in that project (developer). Catalog refresh: cluster admins; the
 * catalog sources themselves are `Cluster.spec.appStore`, changed through plans.
 */
@Controller('apps')
export class AppStoreController {
  constructor(
    private readonly catalogs: AppCatalogsService,
    private readonly plans: AppPlansService,
  ) {}

  @Get('catalogs')
  @RequireScopes('resources:read')
  async listCatalogs(@Req() req?: RequestWithUser): Promise<{ catalogs: AppCatalogDto[]; allowedTrust: string[] }> {
    return await this.catalogs.catalogs(req);
  }

  @Post('catalogs/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(REFRESH_THROTTLE)
  @RequireScopes('cluster:admin')
  async refresh(
    @Body(new ZodValidationPipe(refreshBodySchema)) body: z.infer<typeof refreshBodySchema>,
    @Req() req?: RequestWithUser,
  ): Promise<{ catalogs: AppCatalogDto[] }> {
    return await this.catalogs.refresh(req, body?.catalog);
  }

  @Get()
  @RequireScopes('resources:read')
  async listApps(
    @Query('q', OPTIONAL_QUERY) q?: string,
    @Query('catalog', OPTIONAL_NAME) catalog?: string,
    @Query('trust', OPTIONAL_TRUST) trust?: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ apps: AppSummaryDto[] }> {
    return await this.catalogs.apps(req, { q, catalog, trust });
  }

  @Get('installed')
  @RequireScopes('resources:read')
  async installed(
    @Query('project', OPTIONAL_NAME) project?: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ apps: InstalledAppDto[] }> {
    return await this.plans.installedApps(req, project);
  }

  @Get(':catalog/:app')
  @RequireScopes('resources:read')
  async app(
    @Param('catalog', NodeNamePipe) catalog: string,
    @Param('app', NodeNamePipe) app: string,
    @Query('version', OPTIONAL_VERSION) version?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AppDetailDto> {
    return await this.catalogs.app(req, catalog, app, version);
  }

  @Post(':catalog/:app/:version/plan')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes('plans:create')
  async installPlan(
    @Param('catalog', NodeNamePipe) catalog: string,
    @Param('app', NodeNamePipe) app: string,
    @Param('version', VERSION_PARAM) version: string,
    @Body(new ZodValidationPipe(installPlanBodySchema)) body: z.infer<typeof installPlanBodySchema>,
    @Req() req?: RequestWithUser,
  ): Promise<AppPlanResponseDto> {
    return await this.plans.installPlan(req, catalog, app, version, {
      ...body,
      parameters: body.parameters as Record<string, unknown> | undefined,
    });
  }

  @Post('installed/:project/:deployment/update-plan')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes('plans:create')
  async updatePlan(
    @Param('project', NodeNamePipe) project: string,
    @Param('deployment', NodeNamePipe) deployment: string,
    @Body(new ZodValidationPipe(updatePlanBodySchema)) body: z.infer<typeof updatePlanBodySchema>,
    @Req() req?: RequestWithUser,
  ): Promise<AppPlanResponseDto> {
    return await this.plans.updatePlan(req, project, deployment, body);
  }

  @Post('installed/:project/:deployment/uninstall-plan')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes('plans:create')
  async uninstallPlan(
    @Param('project', NodeNamePipe) project: string,
    @Param('deployment', NodeNamePipe) deployment: string,
    @Body(new ZodValidationPipe(uninstallPlanBodySchema)) body: z.infer<typeof uninstallPlanBodySchema>,
    @Req() req?: RequestWithUser,
  ): Promise<AppPlanResponseDto> {
    return await this.plans.uninstallPlan(req, project, deployment, body);
  }
}
