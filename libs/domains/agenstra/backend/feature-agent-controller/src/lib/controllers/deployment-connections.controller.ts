/**
 * Security: instance admins only (or API key) via {@link DeploymentConnectionsController.assertAdmin}, on top of the
 * `connections:admin` PAT scope. Connection secrets (`token`, `privateKey`) are write-only and never returned.
 */
import type { ConnectionTestResult, DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { RequireScopes, UserRole, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import {
  CreateDeploymentConnectionDto,
  UpdateDeploymentConnectionDto,
} from '../dto/deployments/deployment-connection.dto';
import { DeploymentConnectionsService } from '../services/deployment-connections.service';

@Controller('connections/deployments')
@RequireScopes('connections:admin')
export class DeploymentConnectionsController {
  constructor(private readonly connections: DeploymentConnectionsService) {}

  private assertAdmin(req?: RequestWithUser): void {
    const u = getUserFromRequest(req || ({} as RequestWithUser));

    if (u.isApiKeyAuth) {
      return;
    }

    if (u.userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('provider') provider?: string,
  ): Promise<DeploymentConnectionSummary[]> {
    this.assertAdmin(req);

    return await this.connections.findAll(limit ?? 10, offset ?? 0, search, provider);
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<DeploymentConnectionSummary> {
    this.assertAdmin(req);

    return await this.connections.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateDeploymentConnectionDto,
    @Req() req: RequestWithUser,
  ): Promise<DeploymentConnectionSummary> {
    this.assertAdmin(req);

    return await this.connections.create(dto, getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null);
  }

  @Put(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateDeploymentConnectionDto,
    @Req() req: RequestWithUser,
  ): Promise<DeploymentConnectionSummary> {
    this.assertAdmin(req);

    return await this.connections.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    this.assertAdmin(req);

    await this.connections.delete(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<ConnectionTestResult> {
    this.assertAdmin(req);

    return await this.connections.test(id);
  }
}
