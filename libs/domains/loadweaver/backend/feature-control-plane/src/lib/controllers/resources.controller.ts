import { Public, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  RESOURCE_KIND_NAMES,
  RESOURCE_KINDS,
  resourceJsonSchema,
  stringifyResourceDocuments,
  type Resource,
  type ResourceKind,
} from '@forepath/loadweaver/shared/util-model';
import { BadRequestException, Controller, Get, Header, NotFoundException, Param, Query, Req } from '@nestjs/common';

import { canReadProject, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ResourceStoreService } from '../services/resource-store.service';

/** Cluster-level resources for cluster roles, project resources for whoever may read the project (3.17). */
function readable(caller: AccessCaller, resource: Resource): boolean {
  return resource.metadata.project ? canReadProject(caller, resource.metadata.project) : !!caller.clusterRole;
}

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function assertKind(kind: string): ResourceKind {
  if (!(kind in RESOURCE_KINDS)) throw new NotFoundException(`unknown kind ${kind}`);

  return kind as ResourceKind;
}

/**
 * Read access to desired state and the published JSON Schemas (3.29).
 */
@Controller()
export class ResourcesController {
  constructor(
    private readonly store: ResourceStoreService,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Every readable resource, or those of one kind. Optional narrowing for reference pickers (2026-10-29): `project`
   * (that project's resources), `q` (case-insensitive substring of the name or project) and `limit` (1-200).
   */
  @Get('resources')
  @RequireScopes('resources:read')
  async list(
    @Query('kind') kind?: string,
    @Req() req?: RequestWithUser,
    @Query('project') project?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<Resource[]> {
    const caller = await this.access.caller(req);

    if (project !== undefined && !NAME.test(project)) throw new BadRequestException('invalid project');

    const max = limit === undefined ? null : Number(limit);

    if (max !== null && (!Number.isInteger(max) || max < 1 || max > 200)) {
      throw new BadRequestException('limit must be 1-200');
    }

    const term = (q ?? '').trim().toLowerCase().slice(0, 128);
    const found = (
      await this.store.listAll({ kind: kind ? assertKind(kind) : undefined, ...(project ? { project } : {}) })
    )
      .filter((r) => readable(caller, r))
      .filter(
        (r) =>
          !term ||
          r.metadata.name.toLowerCase().includes(term) ||
          (r.metadata.project ?? '').toLowerCase().includes(term),
      );

    return max === null ? found : found.slice(0, max);
  }

  /** Export as one YAML bundle (the same format Git and the UI use). */
  @Get('resources/export')
  @RequireScopes('resources:read')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  async export(@Req() req?: RequestWithUser): Promise<string> {
    const caller = await this.access.caller(req);

    return stringifyResourceDocuments((await this.store.listAll()).filter((r) => readable(caller, r)));
  }

  @Get('resources/:kind/:name')
  @RequireScopes('resources:read')
  async get(
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Query('project') project?: string,
    @Req() req?: RequestWithUser,
  ): Promise<Resource> {
    const caller = await this.access.caller(req);

    if (
      !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ||
      (project !== undefined && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(project))
    ) {
      throw new BadRequestException('invalid name');
    }

    const resource = await this.store.get(assertKind(kind), name, project ?? null);

    if (!resource || !readable(caller, resource)) throw new NotFoundException('resource not found');

    return resource;
  }

  /** JSON Schemas are public documentation, like the published schema files. */
  @Get('schemas')
  @Public()
  schemas(): { kind: ResourceKind; description: string }[] {
    return RESOURCE_KIND_NAMES.map((kind) => ({ kind, description: RESOURCE_KINDS[kind].description }));
  }

  @Get('schemas/:kind')
  @Public()
  schema(@Param('kind') kind: string): Record<string, unknown> {
    return resourceJsonSchema(assertKind(kind));
  }
}
