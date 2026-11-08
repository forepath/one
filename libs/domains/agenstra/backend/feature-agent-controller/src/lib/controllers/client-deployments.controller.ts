import type {
  DeploymentBranchSummary,
  DeploymentConnectionOption,
  DeploymentProviderWorkflowSummary,
  DeploymentRepositorySummary,
  DeploymentRunDetail,
  DeploymentRunLogs,
  DeploymentRunSummary,
  DeploymentWorkflowApprovalStatus,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  ClientUsersRepository,
  RequireScopes,
  ensureClientAccess,
  ensureWorkspaceManagementAccess,
  getUserFromRequest,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
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
  ParseEnumPipe,
} from '@nestjs/common';

import {
  ApproveDeploymentWorkflowDto,
  CreateDeploymentWorkflowDto,
  TriggerDeploymentRunDto,
  UpdateDeploymentWorkflowDto,
} from '../dto/deployments';
import { ClientsRepository } from '../repositories/clients.repository';
import { DeploymentRunsService } from '../services/deployment-runs.service';
import { DeploymentWorkflowsService } from '../services/deployment-workflows.service';

/** Values of the `approvalStatus` list filter. */
const DEPLOYMENT_WORKFLOW_APPROVAL_FILTER = { pending: 'pending', approved: 'approved' } as const;

/**
 * Workspace deployments: workflows on top of admin managed deployment connections, their runs, logs and live status.
 * - read (workflows, runs, run detail, logs): `deployments:read`, any workspace member
 * - trigger / cancel / sync: `deployments:write`, any workspace member
 * - workflow create / update / delete / approval and connection browsing: `deployments:write`, workspace management
 *
 * Workflows proposed or changed by an environment (MCP) are pending until a workspace admin approves them (`approval`,
 * or saving the complete editor form with `PUT`); nobody can start runs of a pending workflow.
 */
@Controller('clients/:clientId/deployments')
export class ClientDeploymentsController {
  constructor(
    private readonly workflows: DeploymentWorkflowsService,
    private readonly runs: DeploymentRunsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  // --- connection browsing (workspace management) -------------------------------------------------------------

  @Get('connections')
  @RequireScopes('deployments:write')
  async listConnections(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentConnectionOption[]> {
    await this.ensureManagement(clientId, req);

    return await this.workflows.listConnectionOptions(clientId);
  }

  @Get('connections/:connectionId/repositories')
  @RequireScopes('deployments:write')
  async listRepositories(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('connectionId', new ParseUUIDPipe({ version: '4' })) connectionId: string,
    @Query('search') search?: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentRepositorySummary[]> {
    await this.ensureManagement(clientId, req);

    return await this.workflows.listRepositories(clientId, connectionId, search);
  }

  @Get('connections/:connectionId/branches')
  @RequireScopes('deployments:write')
  async listBranches(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('connectionId', new ParseUUIDPipe({ version: '4' })) connectionId: string,
    @Query('repository') repository: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentBranchSummary[]> {
    await this.ensureManagement(clientId, req);

    return await this.workflows.listBranches(clientId, connectionId, repository);
  }

  @Get('connections/:connectionId/workflows')
  @RequireScopes('deployments:write')
  async listProviderWorkflows(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('connectionId', new ParseUUIDPipe({ version: '4' })) connectionId: string,
    @Query('repository') repository: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentProviderWorkflowSummary[]> {
    await this.ensureManagement(clientId, req);

    return await this.workflows.listProviderWorkflows(clientId, connectionId, repository);
  }

  // --- workflows -----------------------------------------------------------------------------------------------

  @Get('workflows')
  @RequireScopes('deployments:read')
  async listWorkflows(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('agentId', new ParseUUIDPipe({ version: '4', optional: true })) agentId?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('approvalStatus', new ParseEnumPipe(DEPLOYMENT_WORKFLOW_APPROVAL_FILTER, { optional: true }))
    approvalStatus?: DeploymentWorkflowApprovalStatus,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentWorkflowSummary[]> {
    await this.ensureAccess(clientId, req);

    return await this.workflows.list(clientId, { agentId, approvalStatus, search, limit, offset });
  }

  @Get('workflows/:workflowId')
  @RequireScopes('deployments:read')
  async getWorkflow(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('workflowId', new ParseUUIDPipe({ version: '4' })) workflowId: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentWorkflowSummary> {
    await this.ensureAccess(clientId, req);

    return await this.workflows.get(clientId, workflowId);
  }

  @Post('workflows')
  @RequireScopes('deployments:write')
  async createWorkflow(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Body() dto: CreateDeploymentWorkflowDto,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentWorkflowSummary> {
    await this.ensureManagement(clientId, req);

    return await this.workflows.create(clientId, dto, this.userId(req));
  }

  @Put('workflows/:workflowId')
  @RequireScopes('deployments:write')
  async updateWorkflow(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('workflowId', new ParseUUIDPipe({ version: '4' })) workflowId: string,
    @Body() dto: UpdateDeploymentWorkflowDto,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentWorkflowSummary> {
    await this.ensureManagement(clientId, req);

    return await this.workflows.update(clientId, workflowId, dto, this.userId(req));
  }

  /** Approve a workflow an environment proposed or changed (409 when it changed since the reviewed `updatedAt`). */
  @Post('workflows/:workflowId/approval')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('deployments:write')
  async approveWorkflow(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('workflowId', new ParseUUIDPipe({ version: '4' })) workflowId: string,
    @Body() dto: ApproveDeploymentWorkflowDto,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentWorkflowSummary> {
    await this.ensureManagement(clientId, req);

    return await this.workflows.approve(clientId, workflowId, dto.updatedAt, this.userId(req));
  }

  @Delete('workflows/:workflowId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('deployments:write')
  async deleteWorkflow(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('workflowId', new ParseUUIDPipe({ version: '4' })) workflowId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.ensureManagement(clientId, req);
    await this.workflows.remove(clientId, workflowId, this.userId(req));
  }

  @Post('workflows/:workflowId/trigger')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes('deployments:write')
  async trigger(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('workflowId', new ParseUUIDPipe({ version: '4' })) workflowId: string,
    @Body() dto: TriggerDeploymentRunDto,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentRunSummary> {
    await this.ensureAccess(clientId, req);

    return await this.runs.trigger(clientId, workflowId, dto ?? {}, this.userId(req));
  }

  @Post('workflows/:workflowId/sync')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('deployments:write')
  async sync(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('workflowId', new ParseUUIDPipe({ version: '4' })) workflowId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ synced: number }> {
    await this.ensureAccess(clientId, req);

    return await this.runs.sync(clientId, workflowId);
  }

  // --- runs ----------------------------------------------------------------------------------------------------

  @Get('runs')
  @RequireScopes('deployments:read')
  async listRuns(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('workflowId', new ParseUUIDPipe({ version: '4', optional: true })) workflowId?: string,
    @Query('agentId', new ParseUUIDPipe({ version: '4', optional: true })) agentId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<{ items: DeploymentRunSummary[]; total: number }> {
    await this.ensureAccess(clientId, req);

    return await this.runs.list(clientId, { workflowId, agentId, status, search, limit, offset });
  }

  @Get('runs/:runId')
  @RequireScopes('deployments:read')
  async getRun(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentRunDetail> {
    await this.ensureAccess(clientId, req);

    return await this.runs.getDetail(clientId, runId);
  }

  @Get('runs/:runId/logs')
  @RequireScopes('deployments:read')
  async getRunLogs(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Query('jobId') jobId?: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentRunLogs> {
    await this.ensureAccess(clientId, req);

    return await this.runs.getLogs(clientId, runId, jobId);
  }

  @Post('runs/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('deployments:write')
  async cancelRun(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentRunSummary> {
    await this.ensureAccess(clientId, req);

    return await this.runs.cancel(clientId, runId, this.userId(req));
  }

  private async ensureAccess(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  private async ensureManagement(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  private userId(req?: RequestWithUser): string | null {
    return getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null;
  }
}
