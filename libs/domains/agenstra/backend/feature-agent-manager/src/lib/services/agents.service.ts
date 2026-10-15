import { randomBytes } from 'crypto';

import {
  egressPolicyRequiresGuard,
  normalizeEffectiveEgressPolicy,
} from '@forepath/agenstra/shared/util-opencode-config';
import { PasswordService } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  HttpException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

import { AGENT_ID_LABEL, AGENT_WORKER_LABEL, agentWorkerContainerName } from '../constants/container-naming.constants';
import { egressGuardContainerName } from '../constants/egress-guard.constants';
import {
  type IsolationLevel,
  resolveSandboxedSharedNetnsIsolationRuntime,
} from '../constants/container-isolation.constants';
import { GitRepositorySetupMode, resolveGitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import type { AgentIsolationSelectionDto } from '../dto/container-isolation.dto';
import { AgentResponseDto } from '../dto/agent-response.dto';
import { CreateAgentResponseDto } from '../dto/create-agent-response.dto';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';
import { AgentEntity, ContainerType } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentProvider } from '../providers/agent-provider.interface';
import { AgentProviderModels } from '../providers/agent-provider.interface';
import { OpenCodeClientFactory } from '../providers/opencode/opencode-client.factory';
import { OPENCODE_SERVER_PORT, OPENCODE_SERVER_USERNAME_DEFAULT } from '../providers/opencode/opencode-provider.config';
import { VNC_WEBSOCKIFY_PORT } from '../constants/vnc.constants';
import { AgentsRepository } from '../repositories/agents.repository';
import { serializeAgentEnvironmentBaseline } from '../utils/agent-environment-baseline.utils';
import {
  buildIsolationSelection,
  containerRuntimeForIsolationLevel,
  effectiveIsolationLevel,
  IsolationResolutionError,
  resolveIsolationRequest,
  runtimeForIsolationLevel,
} from '../utils/container-isolation.utils';
import { expandProviderPathTildeInContainer } from '../utils/provider-container-path.utils';

import { AgentChatSessionsService } from './agent-chat-sessions.service';
import { AgentEgressService, EGRESS_GUARDED_AGENT_CAP_DROP } from './agent-egress.service';
import { AgentGitCredentialsService } from './agent-git-credentials.service';
import { DeploymentsService } from './deployments.service';
import { DockerService } from './docker.service';
import { IsolationCapabilitiesService } from './isolation-capabilities.service';
import {
  CREATE_ENVIRONMENT_PROGRESS_STEPS,
  EnvironmentProgressService,
  EnvironmentProgressTracker,
} from './environment-progress.service';
import { WorkspaceInotifySupervisor } from './workspace-inotify-supervisor.service';

/**
 * Service for agent business logic operations.
 * Orchestrates repository and password service operations.
 */
@Injectable()
export class AgentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentsService.name);
  private readonly PASSWORD_LENGTH = 16;
  private static readonly WORKSPACE_CONTEXT_HOST_PATH = '/opt/agents';
  private static readonly WORKSPACE_CONTEXT_CONTAINER_PATH = '/opt/workspace';
  private static readonly CONTAINER_RUNTIME_USER = 'agenstra';
  private static readonly CONTAINER_RUNTIME_GROUP = 'agenstra';

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly passwordService: PasswordService,
    private readonly agentProviderFactory: AgentProviderFactory,
    private readonly agentChatSessionsService: AgentChatSessionsService,
    private readonly openCodeClientFactory: OpenCodeClientFactory,
    private readonly gitCredentials: AgentGitCredentialsService,
    @Inject(forwardRef(() => DeploymentsService))
    private readonly deploymentsService?: DeploymentsService,
    @Inject(forwardRef(() => WorkspaceInotifySupervisor))
    private readonly workspaceInotifySupervisor?: WorkspaceInotifySupervisor,
    @Optional()
    private readonly environmentProgress?: EnvironmentProgressService,
    @Optional()
    private readonly agentEgress?: AgentEgressService,
    @Optional()
    private readonly isolationCapabilities?: IsolationCapabilitiesService,
  ) {}

  /**
   * Resolve the container isolation level of a new environment against the host's current (probed)
   * capabilities. Rejects stale capability revisions and unavailable levels instead of silently
   * running the workload with a different isolation level.
   */
  private async resolveCreationIsolation(
    createAgentDto: CreateAgentDto,
  ): Promise<{ level: IsolationLevel; runtime?: string; selection: AgentIsolationSelectionDto | null }> {
    if (!this.isolationCapabilities) {
      return { level: 'standard', selection: null };
    }

    const capabilities = await this.isolationCapabilities.getCapabilitiesForCreation();

    try {
      const resolution = resolveIsolationRequest(capabilities, createAgentDto);

      return {
        level: resolution.level,
        runtime: containerRuntimeForIsolationLevel(resolution.level),
        selection: buildIsolationSelection(resolution, capabilities.revision, createAgentDto.isolationSelection),
      };
    } catch (error) {
      if (error instanceof IsolationResolutionError) {
        if (error.code === 'invalid-level') {
          throw new BadRequestException(error.message);
        }

        if (error.code === 'host-not-runnable') {
          throw new ServiceUnavailableException(error.message);
        }

        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  /**
   * Generate a secure random password.
   * Uses alphanumeric characters to ensure compatibility.
   * @returns A random password string of PASSWORD_LENGTH characters
   */
  private generateRandomPassword(): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomBytesBuffer = randomBytes(this.PASSWORD_LENGTH);
    let password = '';

    for (let i = 0; i < this.PASSWORD_LENGTH; i++) {
      password += charset[randomBytesBuffer[i] % charset.length];
    }

    return password;
  }

  /**
   * Escape a string for safe shell usage.
   * @param str - The string to escape
   * @returns The escaped string safe for shell usage
   */
  private escapeForShell(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Ensure the provider agent config directory exists inside the container when the provider defines one.
   * Uses `mkdir -p` so nested paths (e.g. ~/.config/opencode) are created idempotently.
   */
  private async ensureProviderConfigBaseDirectoryExists(containerId: string, agentType: string): Promise<void> {
    const provider = this.agentProviderFactory.getProvider(agentType);

    if (!provider.getConfigBasePath) {
      return;
    }

    const raw = provider.getConfigBasePath()?.trim();

    if (!raw) {
      return;
    }

    const expanded = await expandProviderPathTildeInContainer(raw, containerId, (id) =>
      this.dockerService.getContainerHomeDirectory(id),
    );
    const escaped = this.escapeForShell(expanded);

    await this.dockerService.sendCommandToContainer(containerId, `sh -c "mkdir -p -- ${escaped}"`, undefined, true);
    await this.dockerService.sendCommandToContainer(
      containerId,
      `sh -c "chown -R ${AgentsService.CONTAINER_RUNTIME_USER}:${AgentsService.CONTAINER_RUNTIME_GROUP} -- ${escaped}"`,
      undefined,
      true,
      { user: '0' },
    );
  }

  /**
   * Configure SSH credentials inside the container and return key metadata for the API response.
   */
  private async configureSshAccess(
    containerId: string,
    repositoryUrl: string,
    providedPrivateKey?: string,
  ): Promise<{ publicKey: string; privateKey?: string }> {
    return this.gitCredentials.configureSshAccess(containerId, repositoryUrl, providedPrivateKey);
  }

  /**
   * Create .netrc file in the container for git authentication.
   * @param containerId - The ID of the container
   * @param repositoryUrl - The URL of the repository to create the .netrc file for
   * @throws Error if git credentials are not configured
   */
  private async createNetrcFile(containerId: string, repositoryUrl: string): Promise<void> {
    await this.gitCredentials.writeNetrcFile(containerId, repositoryUrl, {
      username: process.env.GIT_USERNAME,
      token: process.env.GIT_TOKEN || process.env.GIT_PASSWORD,
    });
  }

  /**
   * Build Git-related container environment variables for agent/VNC containers.
   */
  private buildGitContainerEnv(
    setupMode: GitRepositorySetupMode,
    repositoryUrl?: string,
  ): Record<string, string | undefined> {
    if (setupMode === GitRepositorySetupMode.EMPTY) {
      return {
        GIT_REPOSITORY_SETUP_MODE: GitRepositorySetupMode.EMPTY,
      };
    }

    return {
      GIT_REPOSITORY_URL: repositoryUrl,
      GIT_USERNAME: process.env.GIT_USERNAME,
      GIT_TOKEN: process.env.GIT_TOKEN,
      GIT_PASSWORD: process.env.GIT_PASSWORD,
      GIT_PRIVATE_KEY: process.env.GIT_PRIVATE_KEY,
    };
  }

  /**
   * Resolve the repository path used for clone or git init inside the agent container.
   */
  private getRepositoryPath(provider: AgentProvider, basePath: string): string {
    return provider.getRepositoryPath ? basePath + provider.getRepositoryPath() : basePath;
  }

  /**
   * Initialize the agent workspace repository (clone remote or git init locally).
   */
  private async setupAgentRepository(
    containerId: string,
    agentType: string,
    setupMode: GitRepositorySetupMode,
    repositoryUrl: string | undefined,
    provider: AgentProvider,
    basePath: string,
  ): Promise<void> {
    const repositoryPath = this.getRepositoryPath(provider, basePath);

    if (setupMode === GitRepositorySetupMode.EMPTY) {
      await this.ensureProviderConfigBaseDirectoryExists(containerId, agentType);
      await this.dockerService.sendCommandToContainer(
        containerId,
        ['git', 'init', '--', repositoryPath],
        undefined,
        true,
        { user: AgentsService.CONTAINER_RUNTIME_USER },
      );

      return;
    }

    if (!repositoryUrl) {
      throw new BadRequestException(
        'Git repository URL not configured. Please set GIT_REPOSITORY_URL or provide a gitRepositoryUrl in the createAgentDto.',
      );
    }

    if (this.gitCredentials.isSshRepository(repositoryUrl)) {
      await this.configureSshAccess(containerId, repositoryUrl, process.env.GIT_PRIVATE_KEY);
    } else {
      await this.createNetrcFile(containerId, repositoryUrl);
    }

    await this.ensureProviderConfigBaseDirectoryExists(containerId, agentType);

    await this.dockerService.sendCommandToContainer(
      containerId,
      ['git', 'clone', '--', repositoryUrl, repositoryPath],
      undefined,
      true,
      { user: AgentsService.CONTAINER_RUNTIME_USER },
    );
  }

  /**
   * Create a new agent with auto-generated password.
   * @param createAgentDto - Data transfer object for creating an agent
   * @returns The created agent response DTO with generated password
   * @throws BadRequestException if agent name already exists
   */
  async create(createAgentDto: CreateAgentDto): Promise<CreateAgentResponseDto> {
    // Check if agent with the same name already exists
    const existingAgent = await this.agentsRepository.findByName(createAgentDto.name);

    if (existingAgent) {
      throw new BadRequestException(`Agent with name '${createAgentDto.name}' already exists`);
    }

    const progress = this.environmentProgress?.start({
      agentName: createAgentDto.name,
      operation: 'create',
      steps: CREATE_ENVIRONMENT_PROGRESS_STEPS,
    });

    try {
      const created = await this.createProvisioned(createAgentDto, progress);

      progress?.complete();

      return created;
    } catch (error) {
      progress?.fail(error);

      throw error;
    }
  }

  private async createProvisioned(
    createAgentDto: CreateAgentDto,
    progress?: EnvironmentProgressTracker,
  ): Promise<CreateAgentResponseDto> {
    // Validate the requested isolation level before any container or guard is provisioned.
    const isolation = await this.resolveCreationIsolation(createAgentDto);
    // Generate a random password
    const generatedPassword = this.generateRandomPassword();
    // Hash the password
    const hashedPassword = await this.passwordService.hashPassword(generatedPassword);
    // Define a folder name for the agent
    const agentVolumePath = `/opt/agents/${uuidv4()}`;
    // Assigned before any container exists so worker and egress guard are named after the agent
    // (`agenstra-worker-<agentId>`, `agenstra-egress-<agentId>`) from the start.
    const agentId = uuidv4();
    const gitRepositorySetupMode = resolveGitRepositorySetupMode(
      createAgentDto.gitRepositorySetupMode,
      process.env.GIT_REPOSITORY_SETUP_MODE,
    );

    if (gitRepositorySetupMode === GitRepositorySetupMode.EMPTY && createAgentDto.gitRepositoryUrl?.trim()) {
      throw new BadRequestException('Git repository URL must not be set when git repository setup mode is empty');
    }

    const repositoryUrl =
      gitRepositorySetupMode === GitRepositorySetupMode.CLONE
        ? createAgentDto.gitRepositoryUrl || process.env.GIT_REPOSITORY_URL
        : undefined;

    if (gitRepositorySetupMode === GitRepositorySetupMode.CLONE && !repositoryUrl) {
      throw new BadRequestException(
        'Git repository URL not configured. Please set GIT_REPOSITORY_URL or provide a gitRepositoryUrl in the createAgentDto.',
      );
    }

    // Determine agent type (default to 'opencode')
    const agentType = createAgentDto.agentType || 'opencode';
    // Get the provider for this agent type to retrieve the Docker image
    const provider = this.agentProviderFactory.getProvider(agentType);
    const dockerImage = provider.getDockerImage();
    const basePath = provider.getBasePath?.() || '/app';
    const opencodeServerPassword = this.generateRandomPassword();
    const opencodeServerUsername = process.env.OPENCODE_SERVER_USERNAME || OPENCODE_SERVER_USERNAME_DEFAULT;

    // Ensure the Docker image exists
    progress?.advance('pullingImage');
    await this.dockerService.ensureImageExists(dockerImage, (fraction) => progress?.reportStepProgress(fraction));

    progress?.advance('creatingContainer');
    const agentDockerNetwork = process.env.AGENT_DOCKER_NETWORK?.trim();

    if (agentDockerNetwork) {
      await this.dockerService.ensureNetworkExists(agentDockerNetwork);
    }

    // Egress filtering required by the layered agent configuration: provision the guard and apply its
    // policy before the agent container exists (fail closed — the agent never runs unfiltered).
    const egressPolicy = createAgentDto.egressPolicy
      ? normalizeEffectiveEgressPolicy(createAgentDto.egressPolicy)
      : null;
    let egressGuard: { guardId: string; revision: string } | undefined;

    if (egressPolicy && egressPolicyRequiresGuard(egressPolicy)) {
      if (!this.agentEgress?.isEnabled()) {
        throw new BadRequestException(
          'The agent configuration requires egress filtering, but egress guard sidecars are disabled on this agent manager',
        );
      }

      egressGuard = await this.agentEgress.provisionGuardForNewAgent(agentId, egressPolicy, null);
    }

    const egressProxyEnv = egressGuard
      ? Object.fromEntries(
          Object.entries(this.agentEgress?.buildProxyEnv(egressPolicy, true, {}) ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};

    // Create a docker container
    let containerId: string;

    try {
      containerId = await this.dockerService.createContainer({
        name: agentWorkerContainerName(agentId),
        labels: { [AGENT_ID_LABEL]: agentId, [AGENT_WORKER_LABEL]: '1' },
        image: dockerImage,
        env: {
          AGENT_NAME: createAgentDto.name,
          OPENCODE_SERVER_PASSWORD: opencodeServerPassword,
          OPENCODE_SERVER_USERNAME: opencodeServerUsername,
          OPENCODE_SERVER_HOSTNAME: '0.0.0.0',
          OPENCODE_SERVER_PORT: String(OPENCODE_SERVER_PORT),
          ...this.buildGitContainerEnv(gitRepositorySetupMode, repositoryUrl),
          ...(provider.getEnvironmentVariables ? provider.getEnvironmentVariables() : {}),
          ...egressProxyEnv,
        },
        volumes: [
          {
            hostPath: agentVolumePath,
            containerPath: basePath,
            readOnly: false,
          },
          {
            hostPath: AgentsService.WORKSPACE_CONTEXT_HOST_PATH,
            containerPath: AgentsService.WORKSPACE_CONTEXT_CONTAINER_PATH,
            readOnly: true,
          },
        ],
        ...(isolation.runtime ? { runtime: isolation.runtime } : {}),
        ...(egressGuard
          ? {
              // The guard owns the network namespace (agent network attachment / published ports).
              sharedNetworkContainerId: egressGuard.guardId,
              capDrop: [...EGRESS_GUARDED_AGENT_CAP_DROP],
            }
          : agentDockerNetwork
            ? {
                // Reach OpenCode/VNC via container IP on the agent network — do not publish ports on the host.
                network: agentDockerNetwork,
              }
            : {
                // Local/dev without AGENT_DOCKER_NETWORK: bind OpenCode + websockify to loopback only.
                ports: [
                  {
                    containerPort: OPENCODE_SERVER_PORT,
                    hostIp: '127.0.0.1',
                  },
                  {
                    containerPort: VNC_WEBSOCKIFY_PORT,
                    hostIp: '127.0.0.1',
                  },
                ],
              }),
      });
    } catch (error) {
      if (egressGuard) {
        await this.agentEgress?.removeGuardContainer(egressGuard.guardId);
      }

      // Never retry on a weaker runtime: report the failure and let the user decide.
      this.isolationCapabilities?.recordRuntimeFailure(isolation.level);

      if (isolation.level === 'sandboxed' && !(error instanceof HttpException)) {
        const message = (error as { message?: string })?.message || 'unknown error';

        throw new BadRequestException(
          `The sandboxed (gVisor) container could not be started: ${message}. The environment was not created; ` +
            'retry or explicitly choose the standard isolation level.',
        );
      }

      throw error;
    }

    let persistedAgentId: string | undefined;
    let workerRuntimeFailed = false;

    try {
      progress?.advance('preparingRepository');
      await this.setupAgentRepository(
        containerId,
        agentType,
        gitRepositorySetupMode,
        repositoryUrl,
        provider,
        basePath,
      );

      // Create the agent entity
      progress?.advance('persisting');
      const agent = await this.agentsRepository.create({
        id: agentId,
        name: createAgentDto.name,
        description: createAgentDto.description,
        hashedPassword,
        containerId: containerId,
        volumePath: agentVolumePath,
        agentType: createAgentDto.agentType || 'opencode',
        containerType: createAgentDto.containerType || ContainerType.GENERIC,
        opencodeServerPassword,
        gitRepositoryUrl:
          gitRepositorySetupMode === GitRepositorySetupMode.CLONE ? createAgentDto.gitRepositoryUrl : undefined,
        gitRepositorySetupMode:
          gitRepositorySetupMode === GitRepositorySetupMode.EMPTY
            ? GitRepositorySetupMode.EMPTY
            : createAgentDto.gitRepositorySetupMode,
        environmentVariableBaseline: serializeAgentEnvironmentBaseline({}),
        isolationLevel: isolation.level,
        isolationSelection: isolation.selection,
        ...(egressPolicy
          ? {
              egressPolicy,
              egressStatus: egressGuard ? ('active' as const) : ('inactive' as const),
              ...(egressGuard
                ? {
                    egressGuardContainerId: egressGuard.guardId,
                    egressPolicyRevision: egressGuard.revision,
                    egressAppliedAt: new Date(),
                  }
                : {}),
            }
          : {}),
      });

      persistedAgentId = agent.id;
      progress?.setAgentId(agent.id);
      progress?.advance('waitingForHealthy');

      try {
        await this.openCodeClientFactory.waitForHealthy(agent.id, containerId, {
          password: opencodeServerPassword,
        });
      } catch (error) {
        // Only a worker that never becomes healthy counts as a runtime failure (not e.g. Git or DB errors).
        workerRuntimeFailed = true;
        throw error;
      }

      progress?.advance('finalizing');
      this.isolationCapabilities?.recordRuntimeSuccess(isolation.level);

      // Full three-layer OpenCode config + secrets are applied by the controller
      // via durable sync targets after create/start/restart (not agent-only defaults).

      await this.agentChatSessionsService.ensurePrimarySession(agent.id);

      void this.workspaceInotifySupervisor?.onWorkspaceReady(agent.id, basePath).catch((error: unknown) => {
        this.logger.warn(`Failed to start workspace watcher for agent ${agent.id}: ${(error as Error).message}`);
      });

      // Create deployment configuration if provided
      if (createAgentDto.deploymentConfiguration && this.deploymentsService) {
        try {
          await this.deploymentsService.upsertConfiguration(agent.id, {
            providerType: createAgentDto.deploymentConfiguration.providerType,
            repositoryId: createAgentDto.deploymentConfiguration.repositoryId,
            defaultBranch: createAgentDto.deploymentConfiguration.defaultBranch,
            workflowId: createAgentDto.deploymentConfiguration.workflowId,
            providerToken: createAgentDto.deploymentConfiguration.providerToken,
            providerBaseUrl: createAgentDto.deploymentConfiguration.providerBaseUrl,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to create deployment configuration for agent ${agent.id}: ${(error as Error).message}`,
          );
          // Don't fail agent creation if deployment config fails
        }
      }

      return {
        ...(await this.mapToResponseDto(agent)),
        password: generatedPassword,
      };
    } catch (error) {
      // Clean up the container if any step after creation fails
      try {
        await this.dockerService.deleteContainer(containerId);
      } catch (cleanupError) {
        // Log cleanup error but don't mask the original error
        // The original error is more important for debugging
        const err = cleanupError as { message?: string; stack?: string };

        this.logger.error(
          `Failed to clean up container ${containerId} after agent creation failure: ${err.message}`,
          err.stack,
        );
      }

      if (egressGuard) {
        await this.agentEgress?.removeGuardContainer(egressGuard.guardId);
      }

      // Drop the persisted row too, otherwise a broken environment without a container remains listed
      if (persistedAgentId) {
        try {
          await this.agentsRepository.delete(persistedAgentId);
        } catch (cleanupError) {
          const err = cleanupError as { message?: string; stack?: string };

          this.logger.error(
            `Failed to remove agent ${persistedAgentId} after agent creation failure: ${err.message}`,
            err.stack,
          );
        }
      }

      if (error instanceof HttpException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };
      const message = err.message || 'Unknown agent creation error';

      this.logger.error(`Agent creation failed after container start: ${message}`, err.stack);

      if (isolation.level === 'sandboxed' && workerRuntimeFailed) {
        // e.g. the worker never became healthy on gVisor: count it as a runtime failure (re-probe after
        // repeated failures) and never retry on a weaker runtime.
        this.isolationCapabilities?.recordRuntimeFailure(isolation.level);
        throw new BadRequestException(
          `The sandboxed (gVisor) container could not be started: ${message}. The environment was not created; ` +
            'retry or explicitly choose the standard isolation level.',
        );
      }

      // Surface the real cause through the controller proxy (avoids opaque Nest 500).
      throw new BadRequestException(message);
    }
  }

  /**
   * Find all agents with pagination.
   * @param limit - Maximum number of agents to return
   * @param offset - Number of agents to skip
   * @returns Array of agent response DTOs
   */
  async findAll(limit = 10, offset = 0): Promise<AgentResponseDto[]> {
    const agents = await this.agentsRepository.findAll(limit, offset);
    const chatsByAgent = await this.agentChatSessionsService.getSummariesByAgentIds(agents.map((agent) => agent.id));

    return Promise.all(agents.map((agent) => this.mapToResponseDto(agent, chatsByAgent.get(agent.id))));
  }

  /**
   * Find an agent by ID.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async findOne(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    return await this.mapToResponseDto(agent);
  }

  /**
   * Update an existing agent.
   * Password cannot be updated after creation.
   * @param id - The UUID of the agent to update
   * @param updateAgentDto - Data transfer object for updating an agent
   * @returns The updated agent response DTO
   * @throws NotFoundException if agent is not found
   * @throws BadRequestException if new name conflicts with existing agent
   */
  async update(id: string, updateAgentDto: UpdateAgentDto): Promise<AgentResponseDto> {
    // If name is being updated, check for conflicts
    if (updateAgentDto.name) {
      const existingAgent = await this.agentsRepository.findByName(updateAgentDto.name);

      if (existingAgent && existingAgent.id !== id) {
        throw new BadRequestException(`Agent with name '${updateAgentDto.name}' already exists`);
      }
    }

    // Prepare update data (password cannot be updated)
    const updateData: Partial<AgentEntity> = {
      name: updateAgentDto.name,
      description: updateAgentDto.description,
      ...(updateAgentDto.agentType !== undefined && { agentType: updateAgentDto.agentType }),
      ...(updateAgentDto.containerType !== undefined && { containerType: updateAgentDto.containerType }),
    };

    // Remove undefined fields
    Object.keys(updateData).forEach(
      (key) => updateData[key as keyof AgentEntity] === undefined && delete updateData[key as keyof AgentEntity],
    );

    const agent = await this.agentsRepository.update(id, updateData);

    // Update deployment configuration if provided
    if (updateAgentDto.deploymentConfiguration && this.deploymentsService) {
      try {
        await this.deploymentsService.upsertConfiguration(id, {
          providerType: updateAgentDto.deploymentConfiguration.providerType,
          repositoryId: updateAgentDto.deploymentConfiguration.repositoryId,
          defaultBranch: updateAgentDto.deploymentConfiguration.defaultBranch,
          workflowId: updateAgentDto.deploymentConfiguration.workflowId,
          providerToken: updateAgentDto.deploymentConfiguration.providerToken,
          providerBaseUrl: updateAgentDto.deploymentConfiguration.providerBaseUrl,
        });
      } catch (error) {
        this.logger.warn(`Failed to update deployment configuration for agent ${id}: ${(error as Error).message}`);
        // Don't fail agent update if deployment config fails
      }
    }

    return await this.mapToResponseDto(agent);
  }

  /**
   * Delete an agent by ID.
   * @param id - The UUID of the agent to delete
   * @throws NotFoundException if agent is not found
   */
  async remove(id: string): Promise<void> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    await this.workspaceInotifySupervisor?.stopWatcher(id).catch(() => undefined);

    if (agent.containerId) {
      try {
        await this.dockerService.deleteContainer(agent.containerId);
      } catch (error) {
        this.logger.error(`Failed to delete container ${agent.containerId}: ${error}`);
      }
    }

    await this.agentEgress?.afterAgentRemove(agent);
    await this.agentsRepository.delete(id);
  }

  /**
   * Start the agent Docker container.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async start(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    if (agent.containerId) {
      try {
        // The egress guard owns the namespace: it must run before the agent can join it.
        await this.agentEgress?.beforeAgentStart(agent);
        await this.dockerService.startContainer(agent.containerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.error(
          `Failed to start agent container ${agent.containerId} for agent ${agent.name}: ${err.message}`,
          err.stack,
        );
        throw error;
      }
    }

    if (agent.containerId) {
      try {
        await this.openCodeClientFactory.waitForHealthy(agent.id, agent.containerId);
      } catch (error: unknown) {
        const err = error as { message?: string };

        this.logger.warn(`OpenCode health check failed after start for agent ${agent.id}: ${err.message}`);
      }
    }

    return await this.mapToResponseDto(agent);
  }

  /**
   * Stop the agent Docker container.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async stop(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    if (agent.containerId) {
      try {
        await this.dockerService.stopContainer(agent.containerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.error(
          `Failed to stop agent container ${agent.containerId} for agent ${agent.name}: ${err.message}`,
          err.stack,
        );
        throw error;
      }
    }

    await this.agentEgress?.afterAgentStop(agent);

    return await this.mapToResponseDto(agent);
  }

  /**
   * Restart the agent Docker container.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async restart(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    if (agent.containerId) {
      try {
        // Fresh guard namespace first; the agent restart then joins it.
        await this.agentEgress?.beforeAgentRestart(agent);
        await this.dockerService.restartContainer(agent.containerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.error(
          `Failed to restart agent container ${agent.containerId} for agent ${agent.name}: ${err.message}`,
          err.stack,
        );
        throw error;
      }
    }

    if (agent.containerId) {
      try {
        await this.openCodeClientFactory.waitForHealthy(agent.id, agent.containerId);
      } catch (error: unknown) {
        const err = error as { message?: string };

        this.logger.warn(`OpenCode health check failed after restart for agent ${agent.id}: ${err.message}`);
      }
    }

    return await this.mapToResponseDto(agent);
  }

  /**
   * Verify agent credentials.
   * @param id - The UUID of the agent
   * @param password - The plain text password to verify
   * @returns True if credentials are valid, false otherwise
   */
  async verifyCredentials(id: string, password: string): Promise<boolean> {
    const agent = await this.agentsRepository.findById(id);

    if (!agent) {
      return false;
    }

    return await this.passwordService.verifyPassword(password, agent.hashedPassword);
  }

  /**
   * Map the environment's container isolation for API responses.
   */
  private mapAgentIsolation(agent: AgentEntity): NonNullable<AgentResponseDto['isolation']> {
    const level = effectiveIsolationLevel(agent.isolationLevel);

    return {
      level,
      runtime:
        level === 'sandboxed'
          ? // Behind a guard or on the agent network the kernel network stack variant is used (DockerService).
            agent.egressGuardContainerId || process.env.AGENT_DOCKER_NETWORK?.trim()
            ? resolveSandboxedSharedNetnsIsolationRuntime()
            : runtimeForIsolationLevel(level)
          : (this.isolationCapabilities?.getCapabilities().levels.standard.runtime ?? runtimeForIsolationLevel(level)),
      selection: agent.isolationSelection ?? null,
    };
  }

  /**
   * Map agent Git metadata for API responses.
   */
  private mapAgentGit(agent: AgentEntity): AgentResponseDto['git'] | undefined {
    if (agent.gitRepositorySetupMode === GitRepositorySetupMode.EMPTY) {
      return { setupMode: GitRepositorySetupMode.EMPTY };
    }

    if (agent.gitRepositoryUrl) {
      return {
        repositoryUrl: agent.gitRepositoryUrl,
        setupMode: GitRepositorySetupMode.CLONE,
      };
    }

    return undefined;
  }

  /**
   * Map agent entity to response DTO.
   * Excludes sensitive information like password hash.
   * @param agent - The agent entity to map
   * @returns The agent response DTO
   */
  private async mapToResponseDto(
    agent: AgentEntity,
    preloadedSessions?: import('../entities/agent-chat-session.entity').AgentChatSessionEntity[],
  ): Promise<AgentResponseDto> {
    let capabilities: AgentResponseDto['capabilities'];

    try {
      const provider = this.agentProviderFactory.getProvider(agent.agentType || 'opencode');
      const caps = provider.getCapabilities();

      capabilities = {
        transport: caps.transport,
        supportsChat: caps.supportsChat,
        supportsStreaming: caps.supportsStreaming,
        supportsToolEvents: caps.supportsToolEvents,
        supportsQuestions: caps.supportsQuestions,
      };
    } catch {
      capabilities = undefined;
    }

    let sessions = preloadedSessions;

    if (!sessions?.some((session) => session.kind === 'primary')) {
      await this.agentChatSessionsService.ensurePrimarySession(agent.id);
      const byAgent = await this.agentChatSessionsService.getSummariesByAgentIds([agent.id]);

      sessions = byAgent.get(agent.id) ?? [];
    }

    const primary = sessions.find((session) => session.kind === 'primary') ?? sessions[0];
    const chats = sessions.map((session) => this.agentChatSessionsService.mapToSummaryDto(session));

    if (!primary?.id) {
      throw new Error(`Primary chat session missing for agent ${agent.id}`);
    }

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      agentType: agent.agentType,
      containerType: agent.containerType,
      capabilities,
      git: this.mapAgentGit(agent),
      chats,
      primaryChatId: primary.id,
      ...(this.agentEgress ? { egress: await this.agentEgress.describe(agent) } : {}),
      isolation: this.mapAgentIsolation(agent),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  /**
   * Restart all Docker containers associated with agents.
   * This ensures volume mounts are set correctly based on the current context.
   * Called automatically on service startup after the module has been initialized.
   */
  async restartAllContainers(): Promise<void> {
    try {
      this.logger.log('🔄 Starting container restart process...');

      // Get all agents that have containers
      const agents = await this.agentsRepository.findAllWithContainers();

      if (agents.length === 0) {
        this.logger.log('ℹ️  No agents with containers found, skipping container restart');

        return;
      }

      this.logger.log(`Found ${agents.length} agent(s) with containers to restart`);

      // Track containers we've already restarted to avoid duplicates
      const restartedContainers = new Set<string>();

      // Restart all agent containers
      for (const agent of agents) {
        // Restart agent container if it exists
        if (agent.containerId && !restartedContainers.has(agent.containerId)) {
          try {
            this.logger.log(`Restarting agent container ${agent.containerId} for agent ${agent.name}`);
            await this.agentEgress?.beforeAgentRestart(agent);
            await this.dockerService.restartContainer(agent.containerId);
            restartedContainers.add(agent.containerId);
            this.logger.log(`✅ Successfully restarted agent container ${agent.containerId}`);
          } catch (error: unknown) {
            const err = error as { message?: string; stack?: string };

            this.logger.error(
              `Failed to restart agent container ${agent.containerId} for agent ${agent.name}: ${err.message}`,
              err.stack,
            );
            // Continue with other containers even if one fails
          }
        }
      }

      this.logger.log(`✅ Container restart process completed. Restarted ${restartedContainers.size} container(s)`);
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error during container restart process: ${err.message}`, err.stack);
      // Don't throw - we don't want to prevent service startup if container restart fails
    }
  }

  /**
   * List models for an agent via the OpenCode HTTP API (preferred), with CLI fallback.
   * @param id - The UUID of the agent
   * @returns The list of models
   */
  async listModels(id: string): Promise<AgentProviderModels> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);
    const provider = this.agentProviderFactory.getProvider(agent.agentType);

    if (!agent.containerId) {
      return {};
    }

    if (agent.agentType === 'opencode') {
      try {
        return await this.listOpenCodeModelsViaHttp(agent.id, agent.containerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(
          `OpenCode HTTP model list failed for agent ${agent.name}, falling back to CLI: ${err.message}`,
          err.stack,
        );
      }
    }

    if (!provider.getModelsListCommand || !provider.toModelsList) {
      throw new BadRequestException('Provider does not support listing models');
    }

    try {
      const result = await this.dockerService.sendCommandToContainer(
        agent.containerId,
        provider.getModelsListCommand(),
      );

      return provider.toModelsList(result) || {};
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Failed to list models for agent ${agent.name}: ${err.message}`, err.stack);
    }

    return {};
  }

  /**
   * Flatten OpenCode provider/model catalogs into `providerId/modelId` keys (CLI parity).
   */
  private async listOpenCodeModelsViaHttp(agentId: string, containerId: string): Promise<AgentProviderModels> {
    const client = await this.openCodeClientFactory.getClient(agentId, containerId);
    const models: AgentProviderModels = {};

    const fromConfig = client.config?.providers ? await client.config.providers() : null;
    const configProviders = fromConfig?.data?.providers;

    if (configProviders?.length) {
      for (const provider of configProviders) {
        for (const [modelKey, model] of Object.entries(provider.models ?? {})) {
          const modelId = model.id || modelKey;
          const key = `${provider.id}/${modelId}`;

          models[key] = model.name?.trim() || key;
        }
      }

      if (Object.keys(models).length > 0) {
        return models;
      }
    }

    const fromProvider = client.provider?.list ? await client.provider.list() : null;
    const providerRows = fromProvider?.data?.connected?.length ? fromProvider.data.connected : fromProvider?.data?.all;

    if (providerRows?.length) {
      for (const provider of providerRows) {
        for (const [modelKey, model] of Object.entries(provider.models ?? {})) {
          const modelId = model.id || modelKey;
          const key = `${provider.id}/${modelId}`;

          models[key] = model.name?.trim() || key;
        }
      }
    }

    return models;
  }

  /**
   * Lifecycle hook called after the application has been fully bootstrapped.
   * This fires after all modules are initialized, migrations have run, and the HTTP server is ready.
   * Restarts all Docker containers to ensure volume mounts are set correctly.
   */
  /**
   * Remove leftover SSH/VNC sidecar containers from previous releases.
   * Matches by image name so cleanup still works after DB columns are dropped.
   */
  private async removeLegacySidecarContainers(): Promise<void> {
    try {
      const removed = await this.dockerService.removeContainersByImageNameSubstring([
        'agenstra-manager-vnc',
        'agenstra-manager-ssh',
      ]);

      if (removed > 0) {
        this.logger.log(`Removed ${removed} legacy SSH/VNC sidecar container(s)`);
      }
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.warn(`Failed to remove legacy SSH/VNC sidecar containers: ${err.message}`, err.stack);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('🚀 Application fully bootstrapped, cleaning up legacy sidecars and restarting containers...');
    await this.removeLegacySidecarContainers();
    await this.normalizeContainerNames();
    await this.restartAllContainers();
  }

  /**
   * Rename containers of existing environments to the naming pattern (`agenstra-worker-<agentId>`,
   * `agenstra-egress-<agentId>`). Renaming does not interrupt running containers; names held by
   * another container are left alone (logged).
   */
  async normalizeContainerNames(): Promise<void> {
    let agents: AgentEntity[];

    try {
      agents = await this.agentsRepository.findAllWithContainers();
    } catch (error) {
      this.logger.warn(`Skipping container name normalization: ${(error as Error).message}`);

      return;
    }

    for (const agent of agents) {
      const targets: Array<[string | null | undefined, string]> = [
        [agent.containerId, agentWorkerContainerName(agent.id)],
        [agent.egressGuardContainerId, egressGuardContainerName(agent.id)],
      ];

      for (const [containerId, name] of targets) {
        if (!containerId) {
          continue;
        }

        try {
          const result = await this.dockerService.renameContainerIfNeeded(containerId, name);

          if (result === 'renamed') {
            this.logger.log(`Renamed container ${containerId.slice(0, 12)} of agent ${agent.id} to ${name}`);
          } else if (result === 'conflict') {
            this.logger.warn(`Cannot rename container ${containerId.slice(0, 12)} to ${name}: name already in use`);
          }
        } catch (error) {
          this.logger.warn(`Failed to rename container ${containerId.slice(0, 12)}: ${(error as Error).message}`);
        }
      }
    }
  }
}
