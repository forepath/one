import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';

import { CreateCatalogSettingsOperationDto, CreateRestoreOperationDto, ListOperationsQueryDto } from '../dto/fleet.dto';
import { FleetAccessService } from '../services/fleet-access.service';
import { FleetOperationsService, type FleetOperationDto } from '../services/fleet-operations.service';

/** Cross-cluster restore / clone (3.20), apply catalog settings (P1) and the state of fleet operations. */
@Controller('operations')
export class FleetOperationsController {
  constructor(
    private readonly access: FleetAccessService,
    private readonly operations: FleetOperationsService,
  ) {}

  @Get()
  @RequireScopes('fleet:read')
  async list(@Query() query: ListOperationsQueryDto, @Req() req?: RequestWithUser): Promise<FleetOperationDto[]> {
    return await this.operations.list(this.access.caller(req), query);
  }

  @Post()
  @RequireScopes('fleet:restore')
  async create(@Body() dto: CreateRestoreOperationDto, @Req() req?: RequestWithUser): Promise<FleetOperationDto> {
    return await this.operations.createRestore(this.access.caller(req), dto);
  }

  /** Apply catalog settings (P1 app store) to the selected clusters: one operation per cluster. Fleet admins. */
  @Post('catalog-settings')
  @RequireScopes('fleet:admin')
  async createCatalogSettings(
    @Body() dto: CreateCatalogSettingsOperationDto,
    @Req() req?: RequestWithUser,
  ): Promise<FleetOperationDto[]> {
    return await this.operations.createCatalogSettings(this.access.caller(req), dto);
  }

  @Get(':id')
  @RequireScopes('fleet:read')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<FleetOperationDto> {
    return await this.operations.get(this.access.caller(req), id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('fleet:restore')
  async cancel(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<FleetOperationDto> {
    return await this.operations.cancel(this.access.caller(req), id);
  }
}
