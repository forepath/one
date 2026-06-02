import { randomBytes } from 'crypto';

import { PasswordService } from '@forepath/identity/backend';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as sshpk from 'sshpk';
import { v4 as uuidv4 } from 'uuid';

import { GitRepositorySetupMode, resolveGitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import { AgentResponseDto } from '../dto/agent-response.dto';
import { CreateAgentResponseDto } from '../dto/create-agent-response.dto';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';
import { AgentEntity, ContainerType } from '../entities/agent.entity';
import { AcpSessionService } from '../providers/acp/acp-session.service';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentProvider } from '../providers/agent-provider.interface';
import { AgentProviderModels } from '../providers/agent-provider.interface';
import { AgentsRepository } from '../repositories/agents.repository';
import { expandProviderPathTildeInContainer } from '../utils/provider-container-path.utils';

import { DeploymentsService } from './deployments.service';
import { DockerService } from './docker.service';

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
    private readonly acpSessionService: AcpSessionService,
    @Inject(forwardRef(() => DeploymentsService))
    private readonly deploymentsService?: DeploymentsService,
  ) {}

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
   * Extract the domain from a git repository URL.
   * @param url - The git repository URL (e.g., https://github.com/user/repo.git)
   * @returns The domain (e.g., github.com)
   */
  private extractGitDomain(url: string): string {
    try {
      const urlObj = new URL(url);

      return urlObj.hostname;
    } catch {
      // Fallback: try to extract domain from common git URL patterns
      const match = url.match(/@([^/:]+)|:\/\/([^/:]+)/);

      return match ? match[1] || match[2] : 'github.com';
    }
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
      `sh -c "sudo chown -R ${AgentsService.CONTAINER_RUNTIME_USER}:${AgentsService.CONTAINER_RUNTIME_GROUP} -- ${escaped}"`,
      undefined,
      true,
    );
  }

  /**
   * Determine whether the configured git repository uses SSH.
   */
  private isSshRepository(url?: string): boolean {
    if (!url) {
      return false;
    }

    return url.startsWith('git@') || url.startsWith('ssh://');
  }

  /**
   * Resolve SSH host information from repository URL.
   */
  private getSshHostInfo(url: string): { host: string; port?: number } {
    if (url.startsWith('ssh://')) {
      const parsed = new URL(url);

      return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : undefined };
    }

    const scpLikeMatch = url.match(/^[^@]+@([^:]+):/);

    if (scpLikeMatch?.[1]) {
      return { host: scpLikeMatch[1] };
    }

    return { host: this.extractGitDomain(url) };
  }

  /**
   * Get the SSH key filename based on key type.
   * Maps key algorithm to standard SSH key filenames.
   */
  private getSshKeyFilename(keyType: string): string {
    const typeMap: Record<string, string> = {
      rsa: 'id_rsa',
      ed25519: 'id_ed25519',
      ecdsa: 'id_ecdsa',
      dsa: 'id_dsa',
    };
    const normalizedType = keyType.toLowerCase();

    return typeMap[normalizedType] || 'id_rsa'; // Default to RSA if unknown
  }

  /**
   * Prepare SSH key pair information.
   * Returns the private key contents to place inside the container, the public key to share, and the key filename.
   */
  private prepareSshKeyPair(providedPrivateKey?: string): {
    privateKey: string;
    publicKey: string;
    keyFilename: string;
    generated: boolean;
  } {
    let key: sshpk.PrivateKey;
    const generated = false;

    if (providedPrivateKey?.trim()) {
      try {
        key = sshpk.parsePrivateKey(providedPrivateKey.trim(), 'auto');
      } catch (error) {
        this.logger.debug(`Invalid SSH private key provided: ${(error as Error).message}`);
        throw new BadRequestException(
          'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
        );
      }
    } else {
      throw new BadRequestException(
        'Invalid SSH private key. Ensure it is in PEM or OpenSSH format without a passphrase.',
      );
    }

    const privateKey = key.toString('openssh').trimEnd() + '\n';
    const publicKey = key.toPublic().toString('ssh');
    const keyType = key.type || 'rsa';
    const keyFilename = this.getSshKeyFilename(keyType);

    return { privateKey, publicKey, keyFilename, generated };
  }

  /**
   * Helper to write multi-line content into the agent container via base64 encoding.
   */
  private async writeFileToContainer(containerId: string, filePath: string, contents: string): Promise<void> {
    const base64Content = Buffer.from(contents, 'utf-8').toString('base64');
    const escapedBase64 = this.escapeForShell(base64Content);

    await this.dockerService.sendCommandToContainer(containerId, `echo ${escapedBase64} | base64 -d > ${filePath}`);
  }

  /**
   * Configure SSH credentials inside the container and return key metadata for the API response.
   */
  private async configureSshAccess(
    containerId: string,
    repositoryUrl: string,
    providedPrivateKey?: string,
  ): Promise<{ publicKey: string; privateKey?: string }> {
    const keyPair = this.prepareSshKeyPair(providedPrivateKey);
    const { host, port } = this.getSshHostInfo(repositoryUrl);
    const home = await this.dockerService.getContainerHomeDirectory(containerId);
    const sshDir = `${home}/.ssh`;
    const keyPath = `${sshDir}/${keyPair.keyFilename}`;
    const escapedSshDir = this.escapeForShell(sshDir);
    const escapedKeyPath = this.escapeForShell(keyPath);
    const escapedKnownHosts = this.escapeForShell(`${sshDir}/known_hosts`);

    await this.dockerService.sendCommandToContainer(containerId, `mkdir -p ${escapedSshDir}`);
    await this.dockerService.sendCommandToContainer(containerId, `chmod 700 ${escapedSshDir}`);
    await this.writeFileToContainer(containerId, keyPath, keyPair.privateKey);
    await this.dockerService.sendCommandToContainer(containerId, `chmod 600 ${escapedKeyPath}`);

    const sshKeyscanCommand = ['ssh-keyscan', port ? `-p ${port}` : '', host, `>> ${escapedKnownHosts}`, '|| true']
      .filter(Boolean)
      .join(' ');

    await this.dockerService.sendCommandToContainer(containerId, sshKeyscanCommand);
    await this.dockerService.sendCommandToContainer(containerId, `chmod 600 ${escapedKnownHosts} || true`);

    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.generated ? keyPair.privateKey : undefined,
    };
  }

  /**
   * Create .netrc file in the container for git authentication.
   * @param containerId - The ID of the container
   * @param repositoryUrl - The URL of the repository to create the .netrc file for
   * @throws Error if git credentials are not configured
   */
  private async createNetrcFile(containerId: string, repositoryUrl: string): Promise<void> {
    const gitUsername = process.env.GIT_USERNAME;
    const gitToken = process.env.GIT_TOKEN || process.env.GIT_PASSWORD;

    if (!gitUsername || !gitToken || !repositoryUrl) {
      throw new BadRequestException(
        'Git credentials not configured. Please set GIT_USERNAME, GIT_TOKEN (or GIT_PASSWORD), and provide a repositoryUrl in the createNetrcFile.',
      );
    }

    const gitDomain = this.extractGitDomain(repositoryUrl);
    // Construct the entire .netrc file content
    const netrcContent = `machine ${gitDomain}
  login ${gitUsername}
  password ${gitToken}
`;
    // Encode content to base64
    const base64Content = Buffer.from(netrcContent, 'utf-8').toString('base64');
    const home = await this.dockerService.getContainerHomeDirectory(containerId);
    const netrcPath = `${home}/.netrc`;
    const escapedPath = this.escapeForShell(netrcPath);

    // Write file using base64 decode with stdin input (same approach as agent-file-system.service)
    // Use sh -c to run the command in a shell so redirection works
    // The base64 content is sent to stdin, which base64 -d reads and decodes
    await this.dockerService.sendCommandToContainer(containerId, `sh -c "base64 -d > ${escapedPath}"`, base64Content);

    // Set proper permissions
    await this.dockerService.sendCommandToContainer(containerId, `chmod 600 ${escapedPath}`);
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
    const escapedRepositoryPath = this.escapeForShell(repositoryPath);

    if (setupMode === GitRepositorySetupMode.EMPTY) {
      await this.ensureProviderConfigBaseDirectoryExists(containerId, agentType);
      await this.dockerService.sendCommandToContainer(containerId, `sh -c "git init -- ${escapedRepositoryPath}"`);

      return;
    }

    if (!repositoryUrl) {
      throw new BadRequestException(
        'Git repository URL not configured. Please set GIT_REPOSITORY_URL or provide a gitRepositoryUrl in the createAgentDto.',
      );
    }

    if (this.isSshRepository(repositoryUrl)) {
      await this.configureSshAccess(containerId, repositoryUrl, process.env.GIT_PRIVATE_KEY);
    } else {
      await this.createNetrcFile(containerId, repositoryUrl);
    }

    await this.ensureProviderConfigBaseDirectoryExists(containerId, agentType);

    const escapedUrl = this.escapeForShell(repositoryUrl);

    await this.dockerService.sendCommandToContainer(
      containerId,
      `sh -c "git clone ${escapedUrl} ${escapedRepositoryPath}"`,
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

    // Generate a random password
    const generatedPassword = this.generateRandomPassword();
    // Hash the password
    const hashedPassword = await this.passwordService.hashPassword(generatedPassword);
    // Define a folder name for the agent
    const agentVolumePath = `/opt/agents/${uuidv4()}`;
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

    // Determine agent type (default to 'cursor' for backward compatibility)
    const agentType = createAgentDto.agentType || 'cursor';
    // Get the provider for this agent type to retrieve the Docker image
    const provider = this.agentProviderFactory.getProvider(agentType);
    const dockerImage = provider.getDockerImage();
    const virtualWorkspaceDockerImage = provider.getVirtualWorkspaceDockerImage();
    const sshConnectionDockerImage = provider.getSshConnectionDockerImage();
    const basePath = provider.getBasePath?.() || '/app';

    // Ensure the Docker image exists
    await this.dockerService.ensureImageExists(dockerImage);

    // Create a docker container
    const containerId = await this.dockerService.createContainer({
      image: dockerImage,
      env: {
        AGENT_NAME: createAgentDto.name,
        CURSOR_API_KEY: process.env.CURSOR_API_KEY,
        ...this.buildGitContainerEnv(gitRepositorySetupMode, repositoryUrl),
        ...(provider.getEnvironmentVariables ? provider.getEnvironmentVariables() : {}),
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
    });

    try {
      await this.setupAgentRepository(
        containerId,
        agentType,
        gitRepositorySetupMode,
        repositoryUrl,
        provider,
        basePath,
      );

      // Create SSH connection container
      let sshConnection:
        | {
            containerId: string;
            hostPort: number;
            password: string;
          }
        | undefined;

      if (createAgentDto.createSshConnection && sshConnectionDockerImage) {
        const sshConnectionHostPort = await this.generateRandomSSHPort();
        const sshConnectionPassword = this.generateRandomPassword();

        await this.dockerService.ensureImageExists(sshConnectionDockerImage);

        const sshConnectionContainerId = await this.dockerService.createContainer({
          image: sshConnectionDockerImage,
          env: {
            AGENT_NAME: createAgentDto.name,
            SSH_PASSWORD: sshConnectionPassword,
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
          ports: [
            {
              containerPort: 22,
              hostPort: sshConnectionHostPort,
            },
          ],
        });

        sshConnection = {
          containerId: sshConnectionContainerId,
          hostPort: sshConnectionHostPort,
          password: sshConnectionPassword,
        };
      }

      // Create VNC container
      let virtualWorkspace:
        | {
            containerId: string;
            hostPort: number;
            password: string;
          }
        | undefined;

      if (createAgentDto.createVirtualWorkspace && virtualWorkspaceDockerImage) {
        const virtualWorkspaceHostPort = await this.generateRandomVNCPort();
        const virtualWorkspacePassword = this.generateRandomPassword();

        await this.dockerService.ensureImageExists(virtualWorkspaceDockerImage);

        const virtualWorkspaceContainerId = await this.dockerService.createContainer({
          image: virtualWorkspaceDockerImage,
          env: {
            AGENT_NAME: createAgentDto.name,
            CURSOR_API_KEY: process.env.CURSOR_API_KEY,
            ...this.buildGitContainerEnv(gitRepositorySetupMode, repositoryUrl),
            VNC_PASSWORD: virtualWorkspacePassword,
          },
          volumes: [
            {
              hostPath: agentVolumePath,
              containerPath: '/home/agenstra/environment',
              readOnly: false,
            },
            {
              hostPath: AgentsService.WORKSPACE_CONTEXT_HOST_PATH,
              containerPath: AgentsService.WORKSPACE_CONTEXT_CONTAINER_PATH,
              readOnly: true,
            },
          ],
          ports: [
            {
              containerPort: 6080,
              hostPort: virtualWorkspaceHostPort,
            },
          ],
        });

        virtualWorkspace = {
          containerId: virtualWorkspaceContainerId,
          hostPort: virtualWorkspaceHostPort,
          password: virtualWorkspacePassword,
        };
      }

      try {
        let networkId: string | undefined;

        if (createAgentDto.createVirtualWorkspace && virtualWorkspace) {
          networkId = await this.dockerService.createNetwork({
            name: uuidv4(),
            containerIds: [
              containerId,
              ...(virtualWorkspace ? [virtualWorkspace.containerId] : []),
              ...(sshConnection ? [sshConnection.containerId] : []),
            ],
          });
        }

        // Create the agent entity
        const agent = await this.agentsRepository.create({
          name: createAgentDto.name,
          description: createAgentDto.description,
          hashedPassword,
          containerId: containerId,
          volumePath: agentVolumePath,
          agentType: createAgentDto.agentType || 'cursor',
          containerType: createAgentDto.containerType || ContainerType.GENERIC,
          ...(createAgentDto.createVirtualWorkspace &&
            virtualWorkspace && {
              vncContainerId: virtualWorkspace.containerId,
              vncHostPort: virtualWorkspace.hostPort,
              vncNetworkId: networkId,
              vncPassword: virtualWorkspace.password,
            }),
          ...(createAgentDto.createSshConnection &&
            sshConnection && {
              sshContainerId: sshConnection.containerId,
              sshHostPort: sshConnection.hostPort,
              sshPassword: sshConnection.password,
            }),
          gitRepositoryUrl:
            gitRepositorySetupMode === GitRepositorySetupMode.CLONE ? createAgentDto.gitRepositoryUrl : undefined,
          gitRepositorySetupMode:
            gitRepositorySetupMode === GitRepositorySetupMode.EMPTY
              ? GitRepositorySetupMode.EMPTY
              : createAgentDto.gitRepositorySetupMode,
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
          ...this.mapToResponseDto(agent),
          password: generatedPassword,
        };
      } catch (error) {
        // Clean up the container if any step after creation fails
        try {
          if (createAgentDto.createVirtualWorkspace && virtualWorkspace) {
            await this.dockerService.deleteContainer(virtualWorkspace.containerId);
          }

          if (createAgentDto.createSshConnection && sshConnection) {
            await this.dockerService.deleteContainer(sshConnection.containerId);
          }
        } catch (cleanupError) {
          // Log cleanup error but don't mask the original error
          // The original error is more important for debugging
          const err = cleanupError as { message?: string; stack?: string };

          this.logger.error(
            `Failed to clean up container ${containerId} after agent creation failure: ${err.message}`,
            err.stack,
          );
        }

        // Re-throw the original error
        throw error;
      }
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

      // Re-throw the original error
      throw error;
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

    return agents.map((agent) => this.mapToResponseDto(agent));
  }

  /**
   * Find an agent by ID.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async findOne(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    return this.mapToResponseDto(agent);
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

    return this.mapToResponseDto(agent);
  }

  /**
   * Delete an agent by ID.
   * @param id - The UUID of the agent to delete
   * @throws NotFoundException if agent is not found
   */
  async remove(id: string): Promise<void> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    if (agent.containerId) {
      try {
        await this.dockerService.deleteContainer(agent.containerId);
      } catch (error) {
        this.logger.error(`Failed to delete container ${agent.containerId}: ${error}`);
      }
    }

    if (agent.sshContainerId) {
      try {
        await this.dockerService.deleteContainer(agent.sshContainerId);
      } catch (error) {
        this.logger.error(`Failed to delete container ${agent.sshContainerId}: ${error}`);
      }
    }

    if (agent.vncContainerId) {
      try {
        await this.dockerService.deleteContainer(agent.vncContainerId);
      } catch (error) {
        this.logger.error(`Failed to delete container ${agent.vncContainerId}: ${error}`);
      }
    }

    if (agent.vncNetworkId) {
      try {
        await this.dockerService.deleteNetwork(agent.vncNetworkId);
      } catch (error) {
        this.logger.error(`Failed to delete network ${agent.vncNetworkId}: ${error}`);
      }
    }

    await this.agentsRepository.delete(id);
  }

  /**
   * Start all Docker containers for an agent (main, VNC, SSH).
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async start(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    if (agent.containerId) {
      try {
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

    if (agent.vncContainerId) {
      try {
        await this.dockerService.startContainer(agent.vncContainerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(
          `Failed to start VNC container ${agent.vncContainerId} for agent ${agent.name}: ${err.message}`,
        );
      }
    }

    if (agent.sshContainerId) {
      try {
        await this.dockerService.startContainer(agent.sshContainerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(
          `Failed to start SSH container ${agent.sshContainerId} for agent ${agent.name}: ${err.message}`,
        );
      }
    }

    return this.mapToResponseDto(agent);
  }

  /**
   * Stop all Docker containers for an agent (main, VNC, SSH).
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async stop(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    await this.acpSessionService.closeSessionsForAgent(id);

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

    if (agent.vncContainerId) {
      try {
        await this.dockerService.stopContainer(agent.vncContainerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(
          `Failed to stop VNC container ${agent.vncContainerId} for agent ${agent.name}: ${err.message}`,
        );
      }
    }

    if (agent.sshContainerId) {
      try {
        await this.dockerService.stopContainer(agent.sshContainerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(
          `Failed to stop SSH container ${agent.sshContainerId} for agent ${agent.name}: ${err.message}`,
        );
      }
    }

    return this.mapToResponseDto(agent);
  }

  /**
   * Restart all Docker containers for an agent (main, VNC, SSH).
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   * @throws NotFoundException if agent is not found
   */
  async restart(id: string): Promise<AgentResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);

    if (agent.containerId) {
      try {
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

    if (agent.vncContainerId) {
      try {
        await this.dockerService.restartContainer(agent.vncContainerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(
          `Failed to restart VNC container ${agent.vncContainerId} for agent ${agent.name}: ${err.message}`,
        );
      }
    }

    if (agent.sshContainerId) {
      try {
        await this.dockerService.restartContainer(agent.sshContainerId);
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(
          `Failed to restart SSH container ${agent.sshContainerId} for agent ${agent.name}: ${err.message}`,
        );
      }
    }

    return this.mapToResponseDto(agent);
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
  private mapToResponseDto(agent: AgentEntity): AgentResponseDto {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      agentType: agent.agentType,
      containerType: agent.containerType,
      vnc: agent.vncHostPort
        ? {
            port: agent.vncHostPort,
            password: agent.vncPassword,
          }
        : undefined,
      ssh: agent.sshHostPort
        ? {
            port: agent.sshHostPort,
            password: agent.sshPassword,
          }
        : undefined,
      git: this.mapAgentGit(agent),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  /**
   * Generate a random public port from a range of ports.
   * @param range - The range of ports to generate a random port from
   * @returns A random public port
   */
  private async generateRandomVNCPort(): Promise<number> {
    const range = process.env.VNC_SERVER_PUBLIC_PORTS || '49152-57343';
    const [start, end] = range.split('-').map(Number);
    const prosedPort = Math.floor(Math.random() * (end - start + 1)) + start;

    if (await this.agentsRepository.findPortInUse(prosedPort)) {
      return await this.generateRandomVNCPort();
    }

    return prosedPort;
  }

  /**
   * Generate a random public port from a range of ports.
   * @param range - The range of ports to generate a random port from
   * @returns A random public port
   */
  private async generateRandomSSHPort(): Promise<number> {
    const range = process.env.SSH_SERVER_PUBLIC_PORTS || '57344-65535';
    const [start, end] = range.split('-').map(Number);
    const prosedPort = Math.floor(Math.random() * (end - start + 1)) + start;

    if (await this.agentsRepository.findPortInUse(prosedPort)) {
      return await this.generateRandomSSHPort();
    }

    return prosedPort;
  }

  /**
   * Restart all Docker containers associated with agents (agent containers and VNC containers).
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

      // Restart all agent containers and VNC containers
      for (const agent of agents) {
        // Restart agent container if it exists
        if (agent.containerId && !restartedContainers.has(agent.containerId)) {
          try {
            this.logger.log(`Restarting agent container ${agent.containerId} for agent ${agent.name}`);
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

        // Restart VNC container if it exists
        if (agent.vncContainerId && !restartedContainers.has(agent.vncContainerId)) {
          try {
            this.logger.log(`Restarting VNC container ${agent.vncContainerId} for agent ${agent.name}`);
            await this.dockerService.restartContainer(agent.vncContainerId);
            restartedContainers.add(agent.vncContainerId);
            this.logger.log(`✅ Successfully restarted VNC container ${agent.vncContainerId}`);
          } catch (error: unknown) {
            const err = error as { message?: string; stack?: string };

            this.logger.error(
              `Failed to restart VNC container ${agent.vncContainerId} for agent ${agent.name}: ${err.message}`,
              err.stack,
            );
            // Continue with other containers even if one fails
          }
        }

        // Restart SSH container if it exists
        if (agent.sshContainerId && !restartedContainers.has(agent.sshContainerId)) {
          try {
            this.logger.log(`Restarting SSH container ${agent.sshContainerId} for agent ${agent.name}`);
            await this.dockerService.restartContainer(agent.sshContainerId);
            restartedContainers.add(agent.sshContainerId);
            this.logger.log(`✅ Successfully restarted SSH container ${agent.sshContainerId}`);
          } catch (error: unknown) {
            const err = error as { message?: string; stack?: string };

            this.logger.error(
              `Failed to restart SSH container ${agent.sshContainerId} for agent ${agent.name}: ${err.message}`,
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
   * List models for an agent.
   * @param id - The UUID of the agent
   * @returns The list of models
   */
  async listModels(id: string): Promise<AgentProviderModels> {
    const agent = await this.agentsRepository.findByIdOrThrow(id);
    const provider = this.agentProviderFactory.getProvider(agent.agentType);

    if (!provider.getModelsListCommand || !provider.toModelsList) {
      throw new BadRequestException('Provider does not support listing models');
    }

    if (agent.containerId) {
      try {
        const result = await this.dockerService.sendCommandToContainer(
          agent.containerId,
          provider.getModelsListCommand(),
        );

        return provider.toModelsList(result) || {};
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string };

        this.logger.error(`Failed to list models for agent ${agent.name}: ${err.message}`, err.stack);
        // Don't throw - we don't want to prevent the user from listing models if the container is not running
      }
    }

    return {};
  }

  /**
   * Lifecycle hook called after the application has been fully bootstrapped.
   * This fires after all modules are initialized, migrations have run, and the HTTP server is ready.
   * Restarts all Docker containers to ensure volume mounts are set correctly.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('🚀 Application fully bootstrapped, restarting containers...');
    await this.restartAllContainers();
  }
}
