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

import { ClusterAccessService } from '../services/cluster-access.service';
import { ResourceStoreService } from '../services/resource-store.service';

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
    private readonly access: ClusterAccessService,
  ) {}

  @Get('resources')
  @RequireScopes('resources:read')
  async list(@Query('kind') kind?: string, @Req() req?: RequestWithUser): Promise<Resource[]> {
    await this.access.assert(req, 'read');

    return await this.store.listAll({ kind: kind ? assertKind(kind) : undefined });
  }

  /** Export as one YAML bundle (the same format Git and the UI use). */
  @Get('resources/export')
  @RequireScopes('resources:read')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  async export(@Req() req?: RequestWithUser): Promise<string> {
    await this.access.assert(req, 'read');

    return stringifyResourceDocuments(await this.store.listAll());
  }

  @Get('resources/:kind/:name')
  @RequireScopes('resources:read')
  async get(
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Query('project') project?: string,
    @Req() req?: RequestWithUser,
  ): Promise<Resource> {
    await this.access.assert(req, 'read');

    if (
      !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ||
      (project !== undefined && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(project))
    ) {
      throw new BadRequestException('invalid name');
    }

    const resource = await this.store.get(assertKind(kind), name, project ?? null);

    if (!resource) throw new NotFoundException('resource not found');

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
