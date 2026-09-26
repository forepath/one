import {
  AgentModelsResponseDto,
  AgentResponseDto,
  ChatSessionResponseDto,
  CreateAgentDto,
  CreateAgentResponseDto,
  CreateChatSessionDto,
  CreateEnvironmentVariableDto,
  CreateFileDto,
  EnvironmentVariableResponseDto,
  FileNodeDto,
  MoveFileDto,
  parseAgentFileManagerContext,
  type AgentFileManagerContext,
  UpdateAgentDto,
  UpdateChatSessionDto,
  UpdateEnvironmentVariableDto,
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
  RequireScopes,
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
  Head,
  Headers,
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
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { ClientResponseDto } from '../dto/client-response.dto';
import { CreateClientResponseDto } from '../dto/create-client-response.dto';
import { CreateClientDto } from '../dto/create-client.dto';
import { ProvisionServerDto } from '../dto/provision-server.dto';
import { ProvisionedServerResponseDto } from '../dto/provisioned-server-response.dto';
import { UpdateClientDto } from '../dto/update-client.dto';
import { ProvisioningProviderFactory } from '../providers/provisioning-provider.factory';
import { ClientsRepository } from '../repositories/clients.repository';
import { ChatSessionMessageResponse, ClientAgentChatsProxyService } from '../services/client-agent-chats-proxy.service';
import { ClientAgentEnvironmentVariablesProxyService } from '../services/client-agent-environment-variables-proxy.service';
import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';
import { ClientAgentProxyService } from '../services/client-agent-proxy.service';
import { WorkspaceSearchIndexService } from '../search/workspace-search-index.service';
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
    private readonly clientAgentChatsProxyService: ClientAgentChatsProxyService,
    private readonly provisioningService: ProvisioningService,
    private readonly provisioningProviderFactory: ProvisioningProviderFactory,
    private readonly clientUsersService: ClientUsersService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly workspaceSearchIndex: WorkspaceSearchIndexService,
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
  @RequireScopes('clients:read')
  async getClients(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Req() req?: RequestWithUser,
  ): Promise<ClientResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientsService.findAll(
      limit ?? 10,
      offset ?? 0,
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
      { amr: userInfo.amr, search },
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
  @RequireScopes('clients:write')
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
  @RequireScopes('agents:read')
  async getClientAgents(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
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
      { amr: userInfo.amr },
    );

    if (!access.hasAccess) {
      throw new ForbiddenException('You do not have access to this client');
    }

    return await this.clientAgentProxyService.getClientAgents(id, limit ?? 10, offset ?? 0, search);
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
  @RequireScopes('agents:read')
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
      { amr: userInfo.amr },
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
  @RequireScopes('agents:read')
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
      { amr: userInfo.amr },
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
  @RequireScopes('agents:write')
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
  @RequireScopes('agents:write')
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
  @RequireScopes('agents:write')
  async deleteClientAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    await this.clientAgentProxyService.deleteClientAgent(id, agentId, userInfo.userId);
    await this.workspaceSearchIndex.purgeAgent(id, agentId);
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
  @RequireScopes('agents:lifecycle')
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
  @RequireScopes('agents:lifecycle')
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
  @RequireScopes('agents:lifecycle')
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
  @RequireScopes('clients:read')
  async getClient(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<ClientResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientsService.findOne(id, userInfo.userId, userInfo.userRole, userInfo.isApiKeyAuth, {
      amr: userInfo.amr,
    });
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
  @RequireScopes('clients:write')
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
      { amr: userInfo.amr },
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
  @RequireScopes('clients:write')
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
   * Probe file metadata via HEAD (type, content-type, size) without transferring the body.
   */
  @Head(':id/agents/:agentId/files/*path')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('agents:files')
  async headFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('context') contextRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const context = await this.authorizeFileProxyRequest(id, contextRaw, req);
    let normalizedPath: string;

    if (typeof path === 'string') {
      normalizedPath = path;
    } else if (Array.isArray(path)) {
      normalizedPath = path.join('/');
    } else if (path && typeof path === 'object') {
      normalizedPath = '.';
    } else {
      normalizedPath = '.';
    }

    const result = await this.clientAgentFileSystemProxyService.probeFile(id, agentId, normalizedPath, context);

    if (result.acceptRanges) {
      res.setHeader('Accept-Ranges', result.acceptRanges);
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    res.setHeader('X-File-Type', result.fileType);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.size));
  }

  /**
   * Read file content from agent container via client proxy as a binary stream.
   * Supports Range requests (206) and optional download disposition from the manager.
   */
  @Get(':id/agents/:agentId/files/*path')
  @RequireScopes('agents:files')
  async readFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Res({ passthrough: true }) res: Response,
    @Headers('range') rangeHeader?: string,
    @Query('context') contextRaw?: string,
    @Query('download') download?: string,
    @Req() req?: RequestWithUser,
  ): Promise<StreamableFile> {
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

    const result = await this.clientAgentFileSystemProxyService.readFile(id, agentId, normalizedPath, context, {
      range: rangeHeader,
      download: download === 'true',
    });

    if (result.acceptRanges) {
      res.setHeader('Accept-Ranges', result.acceptRanges);
    }

    res.setHeader('X-File-Type', result.fileType);
    res.setHeader('Content-Type', result.contentType);

    if (result.contentDisposition) {
      res.setHeader('Content-Disposition', result.contentDisposition);
    }

    if (result.contentRange) {
      res.setHeader('Content-Range', result.contentRange);
    }

    res.setHeader('Content-Length', String(result.buffer.length));

    if (result.status === HttpStatus.PARTIAL_CONTENT) {
      res.status(HttpStatus.PARTIAL_CONTENT);
    } else if (result.status === HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    }

    return new StreamableFile(result.buffer);
  }

  /**
   * Write file content to agent container via client proxy from a raw body Buffer.
   * Optional Content-Range + X-Upload-Id enable chunked uploads on the manager.
   */
  @Put(':id/agents/:agentId/files/*path')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('agents:files')
  async writeFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('path') path: string | string[] | Record<string, unknown> | undefined,
    @Req() req: RequestWithUser,
    @Query('context') contextRaw?: string,
    @Headers('content-range') contentRangeHeader?: string,
    @Headers('x-upload-id') uploadId?: string,
    @Headers('x-file-type') fileType?: string,
    @Headers('content-type') contentType?: string,
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

    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Expected raw binary body');
    }

    await this.clientAgentFileSystemProxyService.writeFile(id, agentId, normalizedPath, req.body, context, {
      contentRange: contentRangeHeader,
      uploadId,
      fileType,
      contentType: contentType?.split(';')[0]?.trim(),
    });
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
  @RequireScopes('agents:files')
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
  @RequireScopes('agents:files')
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
  @RequireScopes('agents:files')
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
  @RequireScopes('agents:files')
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
  @RequireScopes('clients:read')
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
  @RequireScopes('clients:read')
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
  @RequireScopes('clients:read')
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
  @RequireScopes('clients:write')
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
  @RequireScopes('clients:read')
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
  @RequireScopes('clients:write')
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
  @RequireScopes('agents:environment')
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
  @RequireScopes('agents:environment')
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
  @RequireScopes('agents:environment')
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
  @RequireScopes('agents:environment')
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
  @RequireScopes('agents:environment')
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
  @RequireScopes('agents:environment')
  async deleteAllClientAgentEnvironmentVariables(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ deletedCount: number }> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentEnvironmentVariablesProxyService.deleteAllEnvironmentVariables(id, agentId);
  }

  /**
   * List chat sessions for an agent with pagination (proxied).
   * Only accessible if the user has access to the client.
   */
  @Get(':id/agents/:agentId/chats')
  @RequireScopes('agents:chats')
  async listClientAgentChatSessions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<ChatSessionResponseDto[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentChatsProxyService.list(id, agentId, limit ?? 50, offset ?? 0);
  }

  /**
   * Get count of chat sessions for an agent (proxied).
   * Only accessible if the user has access to the client.
   */
  @Get(':id/agents/:agentId/chats/count')
  @RequireScopes('agents:chats')
  async countClientAgentChatSessions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ count: number }> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentChatsProxyService.count(id, agentId);
  }

  /**
   * Create a new chat session for an agent (proxied).
   * Only accessible if the user has access to the client.
   */
  @Post(':id/agents/:agentId/chats')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes('agents:chats')
  async createClientAgentChatSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() createDto: CreateChatSessionDto,
    @Req() req?: RequestWithUser,
  ): Promise<ChatSessionResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentChatsProxyService.create(id, agentId, createDto);
  }

  /**
   * Get a chat session by ID (proxied).
   * Only accessible if the user has access to the client.
   */
  @Get(':id/agents/:agentId/chats/:chatId')
  @RequireScopes('agents:chats')
  async getClientAgentChatSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Req() req?: RequestWithUser,
  ): Promise<ChatSessionResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentChatsProxyService.get(id, agentId, chatId);
  }

  /**
   * Update a chat session title (proxied).
   * Only accessible if the user has access to the client.
   */
  @Put(':id/agents/:agentId/chats/:chatId')
  @RequireScopes('agents:chats')
  async updateClientAgentChatSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Body() updateDto: UpdateChatSessionDto,
    @Req() req?: RequestWithUser,
  ): Promise<ChatSessionResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentChatsProxyService.update(id, agentId, chatId, updateDto);
  }

  /**
   * Delete a chat session by ID (proxied).
   * Only accessible if the user has access to the client.
   */
  @Delete(':id/agents/:agentId/chats/:chatId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('agents:chats')
  async deleteClientAgentChatSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);
    await this.clientAgentChatsProxyService.delete(id, agentId, chatId);
  }

  /**
   * List messages for a chat session (proxied).
   * Only accessible if the user has access to the client.
   */
  @Get(':id/agents/:agentId/chats/:chatId/messages')
  @RequireScopes('agents:chats')
  async listClientAgentChatSessionMessages(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<ChatSessionMessageResponse[]> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientAgentChatsProxyService.listMessages(id, agentId, chatId, limit ?? 50, offset ?? 0);
  }

  /**
   * Get all users associated with a client.
   * Only accessible if the user has access to the client.
   * @param id - The UUID of the client
   * @param req - The request object
   * @returns Array of client-user relationships
   */
  @Get(':id/users')
  @RequireScopes('clients:read')
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
      { amr: userInfo.amr },
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
  @RequireScopes('clients:write')
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
      { amr: userInfo.amr },
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
      { amr: userInfo.amr },
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
  @RequireScopes('clients:write')
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
      { amr: userInfo.amr },
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
      { amr: userInfo.amr },
    );
  }
}
