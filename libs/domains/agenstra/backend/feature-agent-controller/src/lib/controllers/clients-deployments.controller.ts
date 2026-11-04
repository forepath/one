import {
  ClientUsersRepository,
  ensureClientAccess,
  RequireScopes,
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
  Query,
  Req,
} from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentDeploymentsProxyService } from '../services/client-agent-deployments-proxy.service';

/**
 * Controller for proxied deployment and CI/CD pipeline endpoints.
 * Proxies requests to remote agent-manager services for deployment operations.
 */
@Controller('clients/:id/agents/:agentId/deployments')
export class ClientsDeploymentsController {
  constructor(
    private readonly proxyService: ClientAgentDeploymentsProxyService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  /**
   * Get deployment configuration for an agent (proxied).
   */
  @Get('configuration')
  @RequireScopes('agent_deployments:read')
  async getConfiguration(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<unknown> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.getConfiguration(clientId, agentId);
  }

  /**
   * Create or update deployment configuration for an agent (proxied).
   */
  @Post('configuration')
  @RequireScopes('agent_deployments:write')
  async upsertConfiguration(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: unknown,
    @Req() req?: RequestWithUser,
  ): Promise<unknown> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.upsertConfiguration(clientId, agentId, dto);
  }

  /**
   * Delete deployment configuration for an agent (proxied).
   */
  @Delete('configuration')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('agent_deployments:write')
  async deleteConfiguration(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.proxyService.deleteConfiguration(clientId, agentId);
  }

  /**
   * List repositories accessible with the agent's deployment configuration (proxied).
   */
  @Get('repositories')
  @RequireScopes('agent_deployments:read')
  async listRepositories(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<unknown[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.listRepositories(clientId, agentId);
  }

  /**
   * List branches for a repository (proxied).
   */
  @Get('repositories/:repositoryId/branches')
  @RequireScopes('agent_deployments:read')
  async listBranches(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('repositoryId') repositoryId: string,
    @Req() req?: RequestWithUser,
  ): Promise<unknown[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.listBranches(clientId, agentId, repositoryId);
  }

  /**
   * List workflows for a repository (proxied).
   */
  @Get('repositories/:repositoryId/workflows')
  @RequireScopes('agent_deployments:read')
  async listWorkflows(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('repositoryId') repositoryId: string,
    @Query('branch') branch?: string,
    @Req() req?: RequestWithUser,
  ): Promise<unknown[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.listWorkflows(clientId, agentId, repositoryId, branch);
  }

  /**
   * Trigger a workflow run (proxied).
   */
  @Post('workflows/trigger')
  @RequireScopes('agent_deployments:write')
  async triggerWorkflow(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: unknown,
    @Req() req?: RequestWithUser,
  ): Promise<unknown> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.triggerWorkflow(clientId, agentId, dto);
  }

  /**
   * List deployment runs for an agent (proxied).
   */
  @Get('runs')
  @RequireScopes('agent_deployments:read')
  async listRuns(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Req() req?: RequestWithUser,
  ): Promise<unknown[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.listRuns(clientId, agentId, limit, offset, search);
  }

  /**
   * Get the status of a pipeline run (proxied).
   */
  @Get('runs/:runId')
  @RequireScopes('agent_deployments:read')
  async getRunStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
    @Req() req?: RequestWithUser,
  ): Promise<unknown> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.getRunStatus(clientId, agentId, runId);
  }

  /**
   * Get logs for a pipeline run (proxied).
   */
  @Get('runs/:runId/logs')
  @RequireScopes('agent_deployments:read')
  async getRunLogs(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ logs: string }> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.getRunLogs(clientId, agentId, runId);
  }

  /**
   * List jobs/steps for a pipeline run (proxied).
   */
  @Get('runs/:runId/jobs')
  @RequireScopes('agent_deployments:read')
  async listRunJobs(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
    @Req() req?: RequestWithUser,
  ): Promise<unknown[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.listRunJobs(clientId, agentId, runId);
  }

  /**
   * Get logs for a specific job/step (proxied).
   */
  @Get('runs/:runId/jobs/:jobId/logs')
  @RequireScopes('agent_deployments:read')
  async getJobLogs(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
    @Param('jobId') jobId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ logs: string }> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.getJobLogs(clientId, agentId, runId, jobId);
  }

  /**
   * Cancel a running pipeline (proxied).
   */
  @Post('runs/:runId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('agent_deployments:write')
  async cancelRun(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.proxyService.cancelRun(clientId, agentId, runId);
  }
}
