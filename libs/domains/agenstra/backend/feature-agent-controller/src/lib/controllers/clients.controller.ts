import {
  AgentModelsResponseDto,
  AgentResponseDto,
  CreateAgentDto,
  CreateAgentResponseDto,
  CreateEnvironmentVariableDto,
  CreateFileDto,
  EnvironmentVariableResponseDto,
  FileContentDto,
  FileNodeDto,
  MoveFileDto,
  parseAgentFileManagerContext,
  type AgentFileManagerContext,
  UpdateAgentDto,
  UpdateEnvironmentVariableDto,
  WriteFileDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import {
  AddClientUserDto,
  checkClientAccess,
  ClientUserResponseDto,
  ClientUsersRepository,
  ClientUsersService,
  ensureClientAccess,
  ensureWorkspaceManagementAccess,
  getUserFromRequest,
  type RequestWithUser,
  UserRole,
} from '@forepath/identity/backend';
import {
  BadRequestException,
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
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { ClientResponseDto } from '../dto/client-response.dto';
import { CreateClientResponseDto } from '../dto/create-client-response.dto';
import { CreateClientDto } from '../dto/create-client.dto';
import { ProvisionServerDto } from '../dto/provision-server.dto';
import { ProvisionedServerResponseDto } from '../dto/provisioned-server-response.dto';
import { UpdateClientDto } from '../dto/update-client.dto';
import { ProvisioningProviderFactory } from '../providers/provisioning-provider.factory';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentEnvironmentVariablesProxyService } from '../services/client-agent-environment-variables-proxy.service';
import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';
import { ClientAgentProxyService } from '../services/client-agent-proxy.service';
import { ClientsService } from '../services/clients.service';
import { ProvisioningService } from '../services/provisioning.service';

/**
 * Controller for client management endpoints.
 * Provides CRUD operations for clients and proxied agent operations.
 */
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientAgentProxyService: ClientAgentProxyService,
    private readonly clientAgentFileSystemProxyService: ClientAgentFileSystemProxyService,
    private readonly clientAgentEnvironmentVariablesProxyService: ClientAgentEnvironmentVariablesProxyService,
    private readonly provisioningService: ProvisioningService,
    private readonly provisioningProviderFactory: ProvisioningProviderFactory,
    private readonly clientUsersService: ClientUsersService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  /**
   * Get all clients with pagination.
   * Only returns clients the user has access to.
   * @param limit - Maximum number of clients to return (default: 10)
   * @param offset - Number of clients to skip (default: 0)
   * @param req - The request object
   * @returns Array of client response DTOs
   */
  @Get()
  async getClients(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<ClientResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientsService.findAll(
      limit ?? 10,
      offset ?? 0,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );
  }

  /**
   * Create a new client.
   * An API key will be generated (if API_KEY authentication type) and returned in the response.
   * The user_id will be set to the logged-in user (or null for api-key mode).
   * @param createClientDto - Data transfer object for creating a client
   * @param req - The request object
   * @returns The created client response DTO with generated API key (if applicable)
   */
  @Post()
  async createClient(
    @Body() createClientDto: CreateClientDto,
    @Req() req?: RequestWithUser,
  ): Promise<CreateClientResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientsService.create(createClientDto, userInfo.userId, userInfo.userRole, userInfo.isApiKeyAuth);
  }

  /**
   * Get all agents for a specific client with pagination.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param limit - Maximum number of agents to return (default: 10)
   * @param offset - Number of agents to skip (default: 0)
   * @param req - The request object
   * @returns Array of agent response DTOs
   */
  @Get(':id/agents')
  async getClientAgents(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<AgentResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    const access = await checkClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      id,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );

    if (!access.hasAccess) {
      throw new ForbiddenException('You do not have access to this client');
    }

    return await this.clientAgentProxyService.getClientAgents(id, limit ?? 10, offset ?? 0);
  }

  /**
   * List models available for an agent (proxied to the client's agent-manager).
   * Only accessible if the user has access to the client (same rules as get agent).
   * Registered before GET :id/agents/:agentId so paths ending in `/models` resolve to this handler.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param req - The request object
   * @returns Map of model id to display name
   */
  @Get(':id/agents/:agentId/models')
  async listClientAgentModels(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentModelsResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    const access = await checkClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      id,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );

    if (!access.hasAccess) {
      throw new ForbiddenException('You do not have access to this client');
    }

    return await this.clientAgentProxyService.listClientAgentModels(id, agentId);
  }

  /**
   * Get a single agent for a specific client by agent ID.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param req - The request object
   * @returns The agent response DTO
   */
  @Get(':id/agents/:agentId')
  async getClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    const access = await checkClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      id,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );

    if (!access.hasAccess) {
      throw new ForbiddenException('You do not have access to this client');
    }

    return await this.clientAgentProxyService.getClientAgent(id, agentId);
  }

  /**
   * Update an existing agent for a specific client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent to update
   * @param updateAgentDto - Data transfer object for updating an agent
   * @param req - The request object
   * @returns The updated agent response DTO
   */
  @Post(':id/agents/:agentId')
  async updateClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() updateAgentDto: UpdateAgentDto,
    @Req() req?: RequestWithUser,
  ): Promise<AgentResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientAgentProxyService.updateClientAgent(id, agentId, updateAgentDto, userInfo.userId);
  }

  /**
   * Create a new agent for a specific client.
   * Only accessible if the user has access to the client.
   * A random password will be generated and returned in the response.
   * @param id - The UUID of the client
   * @param createAgentDto - Data transfer object for creating an agent
   * @param req - The request object
   * @returns The created agent response DTO with generated password
   */
  @Post(':id/agents')
  async createClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() createAgentDto: CreateAgentDto,
    @Req() req?: RequestWithUser,
  ): Promise<CreateAgentResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientAgentProxyService.createClientAgent(id, createAgentDto, userInfo.userId);
  }

  /**
   * Delete an agent for a specific client by agent ID.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent to delete
   * @param req - The request object
   */
  @Delete(':id/agents/:agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    await this.clientAgentProxyService.deleteClientAgent(id, agentId, userInfo.userId);
  }

  /**
   * Start all containers for an agent for a specific client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param req - The request object
   * @returns The agent response DTO
   */
  @Post(':id/agents/:agentId/start')
  async startClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentProxyService.startClientAgent(id, agentId);
  }

  /**
   * Stop all containers for an agent for a specific client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param req - The request object
   * @returns The agent response DTO
   */
  @Post(':id/agents/:agentId/stop')
  async stopClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentProxyService.stopClientAgent(id, agentId);
  }

  /**
   * Restart all containers for an agent for a specific client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param req - The request object
   * @returns The agent response DTO
   */
  @Post(':id/agents/:agentId/restart')
  async restartClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentProxyService.restartClientAgent(id, agentId);
  }

  /**
   * Get a single client by ID.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param req - The request object
   * @returns The client response DTO
   */
  @Get(':id')
  async getClient(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<ClientResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientsService.findOne(id, userInfo.userId, userInfo.userRole, userInfo.isApiKeyAuth);
  }

  /**
   * Update an existing client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client to update
   * @param updateClientDto - Data transfer object for updating a client
   * @param req - The request object
   * @returns The updated client response DTO
   */
  @Post(':id')
  async updateClient(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() updateClientDto: UpdateClientDto,
    @Req() req?: RequestWithUser,
  ): Promise<ClientResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientsService.update(
      id,
      updateClientDto,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );
  }

  /**
   * Delete a client by ID.
   * Only accessible if the user has access to the client.
   * If the client has a provisioning reference, the provisioned server will also be deleted.
   * @param id - The UUID of the client to delete
   * @param req - The request object
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteClient(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    // Check if client has provisioning - if so, delete the server from the provider
    try {
      await this.provisioningService.deleteProvisionedServer(id);

      // deleteProvisionedServer already deletes the client, so we're done
      return;
    } catch (error) {
      // If no provisioning reference exists, continue with regular client deletion
      // BadRequestException with "No provisioning reference" means no provisioning - that's fine
      if (
        error instanceof BadRequestException &&
        (error.message.includes('No provisioning reference') || error.message.includes('provisioning reference'))
      ) {
        await this.clientsService.remove(id, userInfo.userId, userInfo.userRole, userInfo.isApiKeyAuth);

        return;
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Authorize proxied file API access. `context=config` requires workspace management rights.
   */
  private async authorizeFileProxyRequest(
    clientId: string,
    contextRaw: string | undefined,
    req?: RequestWithUser,
  ): Promise<AgentFileManagerContext> {
    const context = parseAgentFileManagerContext(contextRaw);

    if (context === 'config') {
      await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    } else {
      await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    }

    return context;
  }

  /**
   * Read file content from agent container via client proxy.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - The file path (wildcard parameter for nested paths)
   * @param req - The request object
   * @returns File content (base64-encoded) and encoding type
   */
  @Get(':id/agents/:agentId/files/*path')
  async readFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Query('context') contextRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<FileContentDto> {
    const context = await this.authorizeFileProxyRequest(id, contextRaw, req);
    // Normalize path: wildcard parameters can be string, array, object, or undefined
    let normalizedPath: string;

    if (typeof path === 'string') {
      normalizedPath = path;
    } else if (Array.isArray(path)) {
      normalizedPath = path.join('/');
    } else if (path && typeof path === 'object') {
      // If it's an object, try to extract a meaningful path or use default
      normalizedPath = '.';
    } else {
      normalizedPath = '.';
    }

    return await this.clientAgentFileSystemProxyService.readFile(id, agentId, normalizedPath, context);
  }

  /**
   * Write file content to agent container via client proxy.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - The file path (wildcard parameter for nested paths)
   * @param writeFileDto - The file content to write (base64-encoded)
   * @param req - The request object
   */
  @Put(':id/agents/:agentId/files/*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async writeFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Body() writeFileDto: WriteFileDto,
    @Query('context') contextRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const context = await this.authorizeFileProxyRequest(id, contextRaw, req);
    // Normalize path: wildcard parameters can be string, array, object, or undefined
    let normalizedPath: string | undefined;

    if (typeof path === 'string') {
      normalizedPath = path;
    } else if (Array.isArray(path)) {
      normalizedPath = path.join('/');
    } else if (path && typeof path === 'object') {
      // If it's an object, we can't determine the path - throw error
      throw new BadRequestException('File path must be a string or array, got object');
    }

    if (!normalizedPath) {
      throw new BadRequestException('File path is required');
    }

    await this.clientAgentFileSystemProxyService.writeFile(id, agentId, normalizedPath, writeFileDto, context);
  }

  /**
   * List directory contents in agent container via client proxy.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - Optional directory path (defaults to '.')
   * @param req - The request object
   * @returns Array of file nodes
   */
  @Get(':id/agents/:agentId/files')
  async listDirectory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('path') path?: string,
    @Query('context') contextRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<FileNodeDto[]> {
    const context = await this.authorizeFileProxyRequest(id, contextRaw, req);

    return await this.clientAgentFileSystemProxyService.listDirectory(id, agentId, path || '.', context);
  }

  /**
   * Create a file or directory in agent container via client proxy.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - The file path (wildcard parameter for nested paths)
   * @param createFileDto - The file/directory creation data
   * @param req - The request object
   */
  @Post(':id/agents/:agentId/files/*path')
  @HttpCode(HttpStatus.CREATED)
  async createFileOrDirectory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Body() createFileDto: CreateFileDto,
    @Query('context') contextRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const context = await this.authorizeFileProxyRequest(id, contextRaw, req);
    // Normalize path: wildcard parameters can be string, array, object, or undefined
    let normalizedPath: string | undefined;

    if (typeof path === 'string') {
      normalizedPath = path;
    } else if (Array.isArray(path)) {
      normalizedPath = path.join('/');
    } else if (path && typeof path === 'object') {
      // If it's an object, we can't determine the path - throw error
      throw new BadRequestException('File path must be a string or array, got object');
    }

    if (!normalizedPath) {
      throw new BadRequestException('File path is required');
    }

    await this.clientAgentFileSystemProxyService.createFileOrDirectory(
      id,
      agentId,
      normalizedPath,
      createFileDto,
      context,
    );
  }

  /**
   * Delete a file or directory from agent container via client proxy.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - The file path (wildcard parameter for nested paths)
   * @param req - The request object
   */
  @Delete(':id/agents/:agentId/files/*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFileOrDirectory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Query('context') contextRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const context = await this.authorizeFileProxyRequest(id, contextRaw, req);
    // Normalize path: wildcard parameters can be string, array, object, or undefined
    let normalizedPath: string | undefined;

    if (typeof path === 'string') {
      normalizedPath = path;
    } else if (Array.isArray(path)) {
      normalizedPath = path.join('/');
    } else if (path && typeof path === 'object') {
      // If it's an object, we can't determine the path - throw error
      throw new BadRequestException('File path must be a string or array, got object');
    }

    if (!normalizedPath) {
      throw new BadRequestException('File path is required');
    }

    await this.clientAgentFileSystemProxyService.deleteFileOrDirectory(id, agentId, normalizedPath, context);
  }

  /**
   * Move a file or directory in agent container via client proxy.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - The source file path (wildcard parameter for nested paths)
   * @param moveFileDto - The move operation data (destination path)
   * @param req - The request object
   */
  @Patch(':id/agents/:agentId/files/*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  async moveFileOrDirectory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Body() moveFileDto: MoveFileDto,
    @Query('context') contextRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const context = await this.authorizeFileProxyRequest(id, contextRaw, req);
    // Normalize path: wildcard parameters can be string, array, object, or undefined
    let normalizedPath: string | undefined;

    if (typeof path === 'string') {
      normalizedPath = path;
    } else if (Array.isArray(path)) {
      normalizedPath = path.join('/');
    } else if (path && typeof path === 'object') {
      // If it's an object, we can't determine the path - throw error
      throw new BadRequestException('File path must be a string or array, got object');
    }

    if (!normalizedPath) {
      throw new BadRequestException('File path is required');
    }

    if (!moveFileDto.destination) {
      throw new BadRequestException('Destination path is required');
    }

    await this.clientAgentFileSystemProxyService.moveFileOrDirectory(id, agentId, normalizedPath, moveFileDto, context);
  }

  /**
   * Get all available provisioning providers.
   * @returns Array of provider information
   */
  @Get('provisioning/providers')
  async getProvisioningProviders(): Promise<Array<{ type: string; displayName: string }>> {
    return this.provisioningProviderFactory.getAllProviders().map((provider) => ({
      type: provider.getType(),
      displayName: provider.getDisplayName(),
    }));
  }

  /**
   * Get available server types for a provisioning provider.
   * @param providerType - The provider type (e.g., 'hetzner')
   * @returns Array of server types with specifications and pricing
   */
  @Get('provisioning/providers/:providerType/server-types')
  async getServerTypes(@Param('providerType') providerType: string) {
    if (!this.provisioningProviderFactory.hasProvider(providerType)) {
      throw new BadRequestException(
        `Provider type '${providerType}' is not available. Available types: ${this.provisioningProviderFactory.getRegisteredTypes().join(', ')}`,
      );
    }

    const provider = this.provisioningProviderFactory.getProvider(providerType);

    return await provider.getServerTypes();
  }

  /**
   * Get available geography options for a provisioning provider.
   * @param providerType - The provider type (e.g., 'hetzner')
   * @returns Array of locations/regions with human-readable labels
   */
  @Get('provisioning/providers/:providerType/locations')
  async getLocations(@Param('providerType') providerType: string) {
    if (!this.provisioningProviderFactory.hasProvider(providerType)) {
      throw new BadRequestException(
        `Provider type '${providerType}' is not available. Available types: ${this.provisioningProviderFactory.getRegisteredTypes().join(', ')}`,
      );
    }

    const provider = this.provisioningProviderFactory.getProvider(providerType);

    return await provider.getLocations();
  }

  /**
   * Provision a new server and create a client.
   * The user_id will be set to the logged-in user (or null for api-key mode).
   * @param provisionServerDto - Provisioning options
   * @param req - The request object
   * @returns Provisioned server response with client information
   */
  @Post('provisioning/provision')
  async provisionServer(
    @Body() provisionServerDto: ProvisionServerDto,
    @Req() req?: RequestWithUser,
  ): Promise<ProvisionedServerResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.provisioningService.provisionServer(
      provisionServerDto,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );
  }

  /**
   * Get server information for a provisioned client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param req - The request object
   * @returns Server information
   */
  @Get(':id/provisioning/info')
  async getServerInfo(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req?: RequestWithUser) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.provisioningService.getServerInfo(id);
  }

  /**
   * Delete a provisioned server and its associated client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param req - The request object
   */
  @Delete(':id/provisioning')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProvisionedServer(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    await this.provisioningService.deleteProvisionedServer(id, userInfo.userId);
  }

  /**
   * Get all environment variables for an agent with pagination (proxied).
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param limit - Maximum number of environment variables to return (default: 50)
   * @param offset - Number of environment variables to skip (default: 0)
   * @param req - The request object
   * @returns Array of environment variable response DTOs
   */
  @Get(':id/agents/:agentId/environment')
  async getClientAgentEnvironmentVariables(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<EnvironmentVariableResponseDto[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentEnvironmentVariablesProxyService.getEnvironmentVariables(
      id,
      agentId,
      limit ?? 50,
      offset ?? 0,
    );
  }

  /**
   * Get count of environment variables for an agent (proxied).
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param req - The request object
   * @returns Count of environment variables
   */
  @Get(':id/agents/:agentId/environment/count')
  async countClientAgentEnvironmentVariables(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ count: number }> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentEnvironmentVariablesProxyService.countEnvironmentVariables(id, agentId);
  }

  /**
   * Create a new environment variable for an agent (proxied).
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param createDto - Data transfer object for creating an environment variable
   * @param req - The request object
   * @returns The created environment variable response DTO
   */
  @Post(':id/agents/:agentId/environment')
  @HttpCode(HttpStatus.CREATED)
  async createClientAgentEnvironmentVariable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() createDto: CreateEnvironmentVariableDto,
    @Req() req?: RequestWithUser,
  ): Promise<EnvironmentVariableResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentEnvironmentVariablesProxyService.createEnvironmentVariable(id, agentId, createDto);
  }

  /**
   * Update an existing environment variable (proxied).
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param envVarId - The UUID of the environment variable to update
   * @param updateDto - Data transfer object for updating an environment variable
   * @param req - The request object
   * @returns The updated environment variable response DTO
   */
  @Put(':id/agents/:agentId/environment/:envVarId')
  async updateClientAgentEnvironmentVariable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('envVarId', new ParseUUIDPipe({ version: '4' })) envVarId: string,
    @Body() updateDto: UpdateEnvironmentVariableDto,
    @Req() req?: RequestWithUser,
  ): Promise<EnvironmentVariableResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentEnvironmentVariablesProxyService.updateEnvironmentVariable(
      id,
      agentId,
      envVarId,
      updateDto,
    );
  }

  /**
   * Delete an environment variable by ID (proxied).
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param envVarId - The UUID of the environment variable to delete
   * @param req - The request object
   */
  @Delete(':id/agents/:agentId/environment/:envVarId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteClientAgentEnvironmentVariable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('envVarId', new ParseUUIDPipe({ version: '4' })) envVarId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    await this.clientAgentEnvironmentVariablesProxyService.deleteEnvironmentVariable(id, agentId, envVarId);
  }

  /**
   * Delete all environment variables for an agent (proxied).
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param req - The request object
   * @returns Number of environment variables deleted
   */
  @Delete(':id/agents/:agentId/environment')
  @HttpCode(HttpStatus.OK)
  async deleteAllClientAgentEnvironmentVariables(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ deletedCount: number }> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentEnvironmentVariablesProxyService.deleteAllEnvironmentVariables(id, agentId);
  }

  /**
   * Get all users associated with a client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param req - The request object
   * @returns Array of client-user relationships
   */
  @Get(':id/users')
  async getClientUsers(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<ClientUserResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    const access = await checkClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      id,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );

    if (!access.hasAccess) {
      throw new ForbiddenException('You do not have access to this client');
    }

    return await this.clientUsersService.getClientUsers(id);
  }

  /**
   * Add a user to a client by email address.
   * Only accessible if the user has permission to add users to the client.
   * @param id - The UUID of the client
   * @param addClientUserDto - Data transfer object containing email and role
   * @param req - The request object
   * @returns The created client-user relationship
   */
  @Post(':id/users')
  @HttpCode(HttpStatus.CREATED)
  async addClientUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() addClientUserDto: AddClientUserDto,
    @Req() req?: RequestWithUser,
  ): Promise<ClientUserResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    const access = await checkClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      id,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );

    if (!access.hasAccess) {
      throw new ForbiddenException('You do not have access to this client');
    }

    const client = await this.clientsRepository.findByIdOrThrow(id);
    const isClientCreator = client.userId === userInfo.userId;

    return await this.clientUsersService.addUserToClient(
      id,
      addClientUserDto,
      userInfo.userId || '',
      userInfo.userRole || UserRole.USER,
      isClientCreator,
      access.clientUserRole,
    );
  }

  /**
   * Remove a user from a client.
   * Only accessible if the user has permission to remove users from the client.
   * @param id - The UUID of the client
   * @param relationshipId - The UUID of the client-user relationship to remove
   * @param req - The request object
   */
  @Delete(':id/users/:relationshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeClientUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('relationshipId', new ParseUUIDPipe({ version: '4' })) relationshipId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    const access = await checkClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      id,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );

    if (!access.hasAccess) {
      throw new ForbiddenException('You do not have access to this client');
    }

    const client = await this.clientsRepository.findByIdOrThrow(id);
    const isClientCreator = client.userId === userInfo.userId;

    await this.clientUsersService.removeUserFromClient(
      id,
      relationshipId,
      userInfo.userId || '',
      userInfo.userRole || UserRole.USER,
      isClientCreator,
      access.clientUserRole,
    );
  }
}
