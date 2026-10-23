import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  VirtualMachinesService,
  type VirtualMachineDto,
  type VirtualMachineSummaryDto,
  type VmSnapshotDto,
} from '../services/virtual-machines.service';
import { VmImageCatalogService } from '../services/vm-image-catalog.service';
import { VmImageImportService, type VmImageImportDto } from '../services/vm-image-import.service';
import type { VmRegistryImageDto } from '../utils/vm-image-catalog.utils';
import { NodeNamePipe } from '../utils/name.pipe';
import { VM_ACTIONS, type VmAction } from '../utils/vm-status.utils';

const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class VmSnapshotRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;
}

export class VmImageImportRequestDto {
  @IsString()
  @MinLength(9)
  @MaxLength(2048)
  url!: string;

  @IsString()
  @Matches(/^(?:sha256:)?[0-9a-fA-F]{64}$/)
  sha256!: string;

  /** `<repository>:<tag>` in the project (or `registry.lw/<project>/<repository>:<tag>`). */
  @IsString()
  @MaxLength(512)
  ref!: string;

  @IsOptional()
  @IsIn(['amd64', 'arm64'])
  arch?: 'amd64' | 'arm64';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['uefi', 'bios'], { each: true })
  firmware?: ('uefi' | 'bios')[];

  @IsOptional()
  @IsBoolean()
  guestAgent?: boolean;
}

/**
 * Full virtual machines (3.35): status, lifecycle actions and snapshots. Specs change through plans
 * (`VirtualMachine` resources); these routes only operate what is applied.
 */
@Controller()
export class VirtualMachinesController {
  constructor(private readonly vms: VirtualMachinesService) {}

  /** Every VM the caller may read (`?project=` filters). */
  @Get('virtual-machines')
  @RequireScopes('resources:read')
  async listAll(@Query('project') project?: string, @Req() req?: RequestWithUser): Promise<VirtualMachineSummaryDto[]> {
    if (project !== undefined && !PROJECT.test(project)) throw new BadRequestException('invalid project');

    return await this.vms.list(req, project);
  }

  @Get('projects/:project/virtual-machines')
  @RequireScopes('resources:read')
  async list(
    @Param('project', NodeNamePipe) project: string,
    @Req() req?: RequestWithUser,
  ): Promise<VirtualMachineSummaryDto[]> {
    return await this.vms.list(req, project);
  }

  @Get('projects/:project/virtual-machines/:name')
  @RequireScopes('resources:read')
  async get(
    @Param('project', NodeNamePipe) project: string,
    @Param('name', NodeNamePipe) name: string,
    @Req() req?: RequestWithUser,
  ): Promise<VirtualMachineDto> {
    return await this.vms.get(req, project, name);
  }

  @Get('projects/:project/virtual-machines/:name/snapshots')
  @RequireScopes('resources:read')
  async snapshots(
    @Param('project', NodeNamePipe) project: string,
    @Param('name', NodeNamePipe) name: string,
    @Req() req?: RequestWithUser,
  ): Promise<VmSnapshotDto[]> {
    return await this.vms.snapshots(req, project, name);
  }

  /** One backup per disk now (operators); same scope as "back up now". */
  @Post('projects/:project/virtual-machines/:name/snapshots')
  @RequireScopes('plans:apply')
  async createSnapshot(
    @Param('project', NodeNamePipe) project: string,
    @Param('name', NodeNamePipe) name: string,
    @Body() dto: VmSnapshotRequestDto,
    @Req() req?: RequestWithUser,
  ): Promise<VmSnapshotDto> {
    return await this.vms.createSnapshot(req, project, name, dto?.description);
  }

  /** Rewrites a stopped VM's boot disk from its pinned image (operators); cloud-init runs again. */
  @Post('projects/:project/virtual-machines/:name/reimage')
  @HttpCode(200)
  @RequireScopes('plans:apply')
  async reimage(
    @Param('project', NodeNamePipe) project: string,
    @Param('name', NodeNamePipe) name: string,
    @Req() req?: RequestWithUser,
  ): Promise<VirtualMachineDto> {
    return await this.vms.act(req, project, name, 'reimage');
  }

  /**
   * `start` | `stop` | `force-off` | `shutdown` (`Manual` VMs) | `reboot` | `reset`: the role that opens terminals
   * (operators / admins, developers with `developerExec`; scope `live:access`).
   */
  @Post('projects/:project/virtual-machines/:name/:action')
  @HttpCode(200)
  @RequireScopes('live:access')
  async act(
    @Param('project', NodeNamePipe) project: string,
    @Param('name', NodeNamePipe) name: string,
    @Param('action') action: string,
    @Req() req?: RequestWithUser,
  ): Promise<VirtualMachineDto> {
    if (action === 'reimage' || !(VM_ACTIONS as readonly string[]).includes(action))
      throw new BadRequestException('unknown action');

    return await this.vms.act(req, project, name, action as VmAction);
  }
}

/** VM image imports (3.35): download → verify → push as an OCI VM image artifact into the project's registry. */
@Controller('projects/:project/vm-images')
export class VmImagesController {
  constructor(
    private readonly imports: VmImageImportService,
    private readonly catalog: VmImageCatalogService,
  ) {}

  /** VM image artifacts in the project's registry repositories (pushed with `lw vm-image push` or imported). */
  @Get()
  @RequireScopes('resources:read')
  async images(
    @Param('project', NodeNamePipe) project: string,
    @Req() req?: RequestWithUser,
  ): Promise<VmRegistryImageDto[]> {
    return await this.catalog.list(req, project);
  }

  @Get('imports')
  @RequireScopes('resources:read')
  async list(
    @Param('project', NodeNamePipe) project: string,
    @Req() req?: RequestWithUser,
  ): Promise<VmImageImportDto[]> {
    return await this.imports.list(req, project);
  }

  @Get('imports/:id')
  @RequireScopes('resources:read')
  async get(
    @Param('project', NodeNamePipe) project: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<VmImageImportDto> {
    return await this.imports.get(req, project, id);
  }

  @Post('import')
  @HttpCode(202)
  @RequireScopes('registry:push')
  async create(
    @Param('project', NodeNamePipe) project: string,
    @Body() dto: VmImageImportRequestDto,
    @Req() req?: RequestWithUser,
  ): Promise<VmImageImportDto> {
    return await this.imports.create(req, project, dto);
  }
}
