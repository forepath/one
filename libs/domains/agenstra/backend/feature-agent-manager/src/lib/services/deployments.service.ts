import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

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
import { DeploymentConfigurationEntity } from '../entities/deployment-configuration.entity';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { PipelineProviderFactory } from '../providers/pipeline-provider.factory';
import { PipelineProviderCredentials } from '../providers/pipeline-provider.interface';
import { AgentsRepository } from '../repositories/agents.repository';
import { DeploymentConfigurationsRepository } from '../repositories/deployment-configurations.repository';
import { DeploymentRunsRepository } from '../repositories/deployment-runs.repository';

/**
 * Service for deployment and CI/CD pipeline operations.
 * Orchestrates pipeline provider operations and manages deployment configurations and runs.
 */
@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);

  constructor(
    private readonly deploymentConfigurationsRepository: DeploymentConfigurationsRepository,
    private readonly deploymentRunsRepository: DeploymentRunsRepository,
    private readonly agentsRepository: AgentsRepository,
    private readonly pipelineProviderFactory: PipelineProviderFactory,
  ) {}

  /**
   * Get deployment configuration for an agent.
   */
  async getConfiguration(agentId: string): Promise<DeploymentConfigurationResponseDto | null> {
    const config = await this.deploymentConfigurationsRepository.findByAgentId(agentId);

    if (!config) {
      return null;
    }

    return this.mapConfigurationToDto(config);
  }

  /**
   * Create or update deployment configuration for an agent.
   */
  async upsertConfiguration(
    agentId: string,
    dto: CreateDeploymentConfigurationDto | UpdateDeploymentConfigurationDto,
  ): Promise<DeploymentConfigurationResponseDto> {
    // Verify agent exists
    await this.agentsRepository.findByIdOrThrow(agentId);

    // Determine provider type - required for create, optional for update
    let providerType: string;

    if ('providerType' in dto && dto.providerType) {
      providerType = dto.providerType;
    } else {
      // For updates without providerType, get it from existing configuration
      const existingConfig = await this.deploymentConfigurationsRepository.findByAgentId(agentId);

      if (!existingConfig) {
        throw new BadRequestException('Cannot update deployment configuration: no existing configuration found');
      }

      providerType = existingConfig.providerType;
    }

    // Verify provider exists
    if (!this.pipelineProviderFactory.hasProvider(providerType)) {
      throw new BadRequestException(`Pipeline provider '${providerType}' is not available`);
    }

    const config = await this.deploymentConfigurationsRepository.upsertByAgentId(agentId, {
      providerType,
      repositoryId: dto.repositoryId,
      defaultBranch: dto.defaultBranch,
      workflowId: dto.workflowId,
      providerToken: dto.providerToken,
      providerBaseUrl: dto.providerBaseUrl,
    } as Partial<DeploymentConfigurationEntity>);

    return this.mapConfigurationToDto(config);
  }

  /**
   * Delete deployment configuration for an agent.
   */
  async deleteConfiguration(agentId: string): Promise<void> {
    await this.deploymentConfigurationsRepository.deleteByAgentId(agentId);
  }

  /**
   * List repositories accessible with the agent's deployment configuration.
   */
  async listRepositories(agentId: string): Promise<RepositoryResponseDto[]> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };
    const repositories = await provider.listRepositories(credentials);

    return repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      url: repo.url,
      private: repo.private,
    }));
  }

  /**
   * List branches for a repository.
   */
  async listBranches(agentId: string, repositoryId: string): Promise<BranchResponseDto[]> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };
    const branches = await provider.listBranches(credentials, repositoryId);

    return branches.map((branch) => ({
      name: branch.name,
      sha: branch.sha,
      default: branch.default,
    }));
  }

  /**
   * List workflows for a repository.
   */
  async listWorkflows(agentId: string, repositoryId: string, branch?: string): Promise<WorkflowResponseDto[]> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };
    const workflows = await provider.listWorkflows(credentials, repositoryId, branch);

    return workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      path: workflow.path,
      state: workflow.state,
      canTrigger: workflow.canTrigger,
    }));
  }

  /**
   * Trigger a workflow run.
   */
  async triggerWorkflow(agentId: string, dto: TriggerWorkflowDto): Promise<DeploymentRunResponseDto> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };
    const run = await provider.triggerWorkflow(credentials, config.repositoryId, dto.workflowId, dto.ref, dto.inputs);
    // Store run in database
    const runEntity = await this.deploymentRunsRepository.upsertByProviderRunId(config.id, run.id, {
      runName: run.name,
      status: run.status,
      conclusion: run.conclusion,
      ref: run.ref,
      sha: run.sha,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      htmlUrl: run.htmlUrl,
    });

    return this.mapRunToDto(runEntity);
  }

  /**
   * Get the status of a pipeline run.
   */
  async getRunStatus(agentId: string, runId: string): Promise<DeploymentRunResponseDto> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    // Look up the run entity to get the providerRunId
    const runEntity = await this.deploymentRunsRepository.findById(runId);

    if (!runEntity) {
      throw new NotFoundException(`Deployment run with ID ${runId} not found`);
    }

    if (runEntity.configurationId !== config.id) {
      throw new BadRequestException(`Deployment run ${runId} does not belong to agent ${agentId}`);
    }

    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };
    // Use providerRunId (GitHub run ID) instead of database UUID
    const run = await provider.getRunStatus(credentials, config.repositoryId, runEntity.providerRunId);
    // Update run in database
    const updatedRunEntity = await this.deploymentRunsRepository.upsertByProviderRunId(config.id, run.id, {
      runName: run.name,
      status: run.status,
      conclusion: run.conclusion,
      ref: run.ref,
      sha: run.sha,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      htmlUrl: run.htmlUrl,
    });

    return this.mapRunToDto(updatedRunEntity);
  }

  /**
   * Get logs for a pipeline run.
   */
  async getRunLogs(agentId: string, runId: string): Promise<string> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    // Look up the run entity to get the providerRunId
    const runEntity = await this.deploymentRunsRepository.findById(runId);

    if (!runEntity) {
      throw new NotFoundException(`Deployment run with ID ${runId} not found`);
    }

    if (runEntity.configurationId !== config.id) {
      throw new BadRequestException(`Deployment run ${runId} does not belong to agent ${agentId}`);
    }

    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };

    // Use providerRunId (GitHub run ID) instead of database UUID
    return await provider.getRunLogs(credentials, config.repositoryId, runEntity.providerRunId);
  }

  /**
   * List jobs/steps for a pipeline run.
   */
  async listRunJobs(agentId: string, runId: string): Promise<JobResponseDto[]> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    // Look up the run entity to get the providerRunId
    const runEntity = await this.deploymentRunsRepository.findById(runId);

    if (!runEntity) {
      throw new NotFoundException(`Deployment run with ID ${runId} not found`);
    }

    if (runEntity.configurationId !== config.id) {
      throw new BadRequestException(`Deployment run ${runId} does not belong to agent ${agentId}`);
    }

    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };
    // Use providerRunId (GitHub run ID) instead of database UUID
    const jobs = await provider.listRunJobs(credentials, config.repositoryId, runEntity.providerRunId);

    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    }));
  }

  /**
   * Get logs for a specific job/step.
   */
  async getJobLogs(agentId: string, runId: string, jobId: string): Promise<string> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    // Look up the run entity to get the providerRunId
    const runEntity = await this.deploymentRunsRepository.findById(runId);

    if (!runEntity) {
      throw new NotFoundException(`Deployment run with ID ${runId} not found`);
    }

    if (runEntity.configurationId !== config.id) {
      throw new BadRequestException(`Deployment run ${runId} does not belong to agent ${agentId}`);
    }

    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };

    // Use providerRunId (GitHub run ID) instead of database UUID
    return await provider.getJobLogs(credentials, config.repositoryId, runEntity.providerRunId, jobId);
  }

  /**
   * Cancel a running pipeline.
   */
  async cancelRun(agentId: string, runId: string): Promise<void> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    // Look up the run entity to get the providerRunId
    const runEntity = await this.deploymentRunsRepository.findById(runId);

    if (!runEntity) {
      throw new NotFoundException(`Deployment run with ID ${runId} not found`);
    }

    if (runEntity.configurationId !== config.id) {
      throw new BadRequestException(`Deployment run ${runId} does not belong to agent ${agentId}`);
    }

    const provider = this.pipelineProviderFactory.getProvider(config.providerType);
    const credentials: PipelineProviderCredentials = {
      token: config.providerToken,
      baseUrl: config.providerBaseUrl,
    };

    // Use providerRunId (GitHub run ID) instead of database UUID
    await provider.cancelRun(credentials, config.repositoryId, runEntity.providerRunId);

    // Update run status in database
    runEntity.status = 'cancelled';
    runEntity.conclusion = 'cancelled';
    await this.deploymentRunsRepository.update(runEntity.id, runEntity);
  }

  /**
   * List deployment runs for an agent.
   */
  async listRuns(agentId: string, limit = 50, offset = 0): Promise<DeploymentRunResponseDto[]> {
    const config = await this.deploymentConfigurationsRepository.findByAgentIdOrThrow(agentId);
    const runs = await this.deploymentRunsRepository.findByConfigurationId(config.id, limit, offset);

    return runs.map((run) => this.mapRunToDto(run));
  }

  /**
   * Map configuration entity to DTO.
   */
  private mapConfigurationToDto(config: DeploymentConfigurationEntity): DeploymentConfigurationResponseDto {
    return {
      id: config.id,
      agentId: config.agentId,
      providerType: config.providerType,
      repositoryId: config.repositoryId,
      defaultBranch: config.defaultBranch,
      workflowId: config.workflowId,
      providerBaseUrl: config.providerBaseUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  /**
   * Map run entity to DTO.
   */
  private mapRunToDto(run: DeploymentRunEntity): DeploymentRunResponseDto {
    return {
      id: run.id,
      configurationId: run.configurationId,
      providerRunId: run.providerRunId,
      runName: run.runName,
      status: run.status,
      conclusion: run.conclusion,
      ref: run.ref,
      sha: run.sha,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      htmlUrl: run.htmlUrl,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }
}
