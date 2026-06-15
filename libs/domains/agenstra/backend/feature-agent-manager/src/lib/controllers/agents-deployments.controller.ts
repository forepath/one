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
} from '@nestjs/common';

import {
  CreateDeploymentConfigurationDto,
  DeploymentConfigurationResponseDto,
  UpdateDeploymentConfigurationDto,
} from '../dto/deployment-configuration.dto';
import {
  BranchResponseDto,
  DeploymentRunResponseDto,
  JobResponseDto,
  RepositoryResponseDto,
  TriggerWorkflowDto,
  WorkflowResponseDto,
} from '../dto/deployment-run.dto';
import { DeploymentsService } from '../services/deployments.service';

/**
 * Controller for deployment and CI/CD pipeline endpoints.
 * Provides operations for managing deployment configurations and pipeline runs.
 */
@Controller('agents/:agentId/deployments')
export class AgentsDeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  /**
   * Get deployment configuration for an agent.
   */
  @Get('configuration')
  async getConfiguration(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<DeploymentConfigurationResponseDto | null> {
    return await this.deploymentsService.getConfiguration(agentId);
  }

  /**
   * Create or update deployment configuration for an agent.
   */
  @Post('configuration')
  async upsertConfiguration(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: CreateDeploymentConfigurationDto | UpdateDeploymentConfigurationDto,
  ): Promise<DeploymentConfigurationResponseDto> {
    return await this.deploymentsService.upsertConfiguration(agentId, dto);
  }

  /**
   * Delete deployment configuration for an agent.
   */
  @Delete('configuration')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConfiguration(@Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string): Promise<void> {
    await this.deploymentsService.deleteConfiguration(agentId);
  }

  /**
   * List repositories accessible with the agent's deployment configuration.
   */
  @Get('repositories')
  async listRepositories(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<RepositoryResponseDto[]> {
    return await this.deploymentsService.listRepositories(agentId);
  }

  /**
   * List branches for a repository.
   */
  @Get('repositories/:repositoryId/branches')
  async listBranches(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('repositoryId') repositoryId: string,
  ): Promise<BranchResponseDto[]> {
    return await this.deploymentsService.listBranches(agentId, repositoryId);
  }

  /**
   * List workflows for a repository.
   */
  @Get('repositories/:repositoryId/workflows')
  async listWorkflows(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('repositoryId') repositoryId: string,
    @Query('branch') branch?: string,
  ): Promise<WorkflowResponseDto[]> {
    return await this.deploymentsService.listWorkflows(agentId, repositoryId, branch);
  }

  /**
   * Trigger a workflow run.
   */
  @Post('workflows/trigger')
  async triggerWorkflow(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: TriggerWorkflowDto,
  ): Promise<DeploymentRunResponseDto> {
    return await this.deploymentsService.triggerWorkflow(agentId, dto);
  }

  /**
   * List deployment runs for an agent.
   */
  @Get('runs')
  async listRuns(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<DeploymentRunResponseDto[]> {
    return await this.deploymentsService.listRuns(agentId, limit ?? 50, offset ?? 0);
  }

  /**
   * Get the status of a pipeline run.
   */
  @Get('runs/:runId')
  async getRunStatus(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
  ): Promise<DeploymentRunResponseDto> {
    return await this.deploymentsService.getRunStatus(agentId, runId);
  }

  /**
   * Get logs for a pipeline run.
   */
  @Get('runs/:runId/logs')
  async getRunLogs(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
  ): Promise<{ logs: string }> {
    const logs = await this.deploymentsService.getRunLogs(agentId, runId);

    return { logs };
  }

  /**
   * List jobs/steps for a pipeline run.
   */
  @Get('runs/:runId/jobs')
  async listRunJobs(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
  ): Promise<JobResponseDto[]> {
    return await this.deploymentsService.listRunJobs(agentId, runId);
  }

  /**
   * Get logs for a specific job/step.
   */
  @Get('runs/:runId/jobs/:jobId/logs')
  async getJobLogs(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
    @Param('jobId') jobId: string,
  ): Promise<{ logs: string }> {
    const logs = await this.deploymentsService.getJobLogs(agentId, runId, jobId);

    return { logs };
  }

  /**
   * Cancel a running pipeline.
   */
  @Post('runs/:runId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelRun(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('runId') runId: string,
  ): Promise<void> {
    await this.deploymentsService.cancelRun(agentId, runId);
  }
}
