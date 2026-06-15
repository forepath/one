import { randomBytes } from 'crypto';

import {
  assertWorkspaceManagementAccessForUser,
  AuthenticationType,
  canManageWorkspaceConfiguration,
  checkClientAccess,
  ClientEntity,
  ClientUsersRepository,
  KeycloakTokenService,
  UserRole,
} from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable } from '@nestjs/common';

import { ClientResponseDto } from '../dto/client-response.dto';
import { CreateClientResponseDto } from '../dto/create-client-response.dto';
import { CreateClientDto } from '../dto/create-client.dto';
import { UpdateClientDto } from '../dto/update-client.dto';
import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { ProvisioningReferencesRepository } from '../repositories/provisioning-references.repository';

import { ClientAgentProxyService } from './client-agent-proxy.service';
import { StatisticsService } from './statistics.service';

/**
 * Service for client business logic operations.
 * Orchestrates repository operations, API key generation, and Keycloak token management.
 */
@Injectable()
export class ClientsService {
  private readonly API_KEY_LENGTH = 32;

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly keycloakTokenService: KeycloakTokenService,
    @Inject(forwardRef(() => ClientAgentProxyService))
    private readonly clientAgentProxyService: ClientAgentProxyService,
    private readonly provisioningReferencesRepository: ProvisioningReferencesRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly statisticsService: StatisticsService,
  ) {}

  /**
   * Generate a secure random API key.
   * Uses alphanumeric characters to ensure compatibility.
   * @returns A random API key string of API_KEY_LENGTH characters
   */
  private generateRandomApiKey(): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomBytesBuffer = randomBytes(this.API_KEY_LENGTH);
    let apiKey = '';

    for (let i = 0; i < this.API_KEY_LENGTH; i++) {
      apiKey += charset[randomBytesBuffer[i] % charset.length];
    }

    return apiKey;
  }

  /**
   * Check if api-key mode is active (role checks should be disabled).
   * @returns True if api-key mode is active
   */
  private isApiKeyMode(): boolean {
    const authMethod = process.env.AUTHENTICATION_METHOD?.toLowerCase().trim();

    return authMethod === 'api-key' || (authMethod === undefined && !!process.env.STATIC_API_KEY);
  }

  /**
   * Create a new client with API key (provided or auto-generated if needed).
   * @param createClientDto - Data transfer object for creating a client
   * @param userId - The UUID of the user creating the client (optional, for api-key mode)
   * @returns The created client response DTO with API key (if applicable)
   * @throws BadRequestException if client name already exists
   */
  async create(
    createClientDto: CreateClientDto,
    userId?: string,
    userRole?: UserRole,
    isApiKeyAuth = false,
  ): Promise<CreateClientResponseDto> {
    // Check if client with the same name already exists
    const existingClient = await this.clientsRepository.findByName(createClientDto.name);

    if (existingClient) {
      throw new BadRequestException(`Client with name '${createClientDto.name}' already exists`);
    }

    // Validate Keycloak credentials if authentication type is KEYCLOAK
    if (createClientDto.authenticationType === AuthenticationType.KEYCLOAK) {
      if (!createClientDto.keycloakClientId || !createClientDto.keycloakClientSecret) {
        throw new BadRequestException(
          'Keycloak client ID and client secret are required for KEYCLOAK authentication type',
        );
      }
    }

    // Use provided API key or generate one for API_KEY authentication type
    let apiKey: string | undefined;

    if (createClientDto.authenticationType === AuthenticationType.API_KEY) {
      apiKey = createClientDto.apiKey || this.generateRandomApiKey();
    }

    // Create the client entity
    const client = await this.clientsRepository.create({
      name: createClientDto.name,
      description: createClientDto.description,
      endpoint: createClientDto.endpoint,
      authenticationType: createClientDto.authenticationType,
      apiKey,
      keycloakClientId: createClientDto.keycloakClientId,
      keycloakClientSecret: createClientDto.keycloakClientSecret,
      keycloakRealm: createClientDto.keycloakRealm,
      agentWsPort: createClientDto.agentWsPort,
      userId: userId ?? null,
    });
    const response = await this.mapToResponseDto(client, { userId, userRole, isApiKeyAuth });

    this.statisticsService
      .recordEntityCreated(StatisticsEntityType.CLIENT, client.id, {}, userId ?? undefined)
      .catch(() => undefined);

    return {
      ...response,
      apiKey,
    };
  }

  /**
   * Find all clients with pagination, filtered by user permissions.
   * @param limit - Maximum number of clients to return
   * @param offset - Number of clients to skip
   * @param userId - The UUID of the user (optional, for api-key mode)
   * @param userRole - The role of the user (optional, for api-key mode)
   * @param isApiKeyAuth - Whether the request is authenticated via API key
   * @returns Array of client response DTOs that the user has access to
   */
  async findAll(
    limit = 10,
    offset = 0,
    userId?: string,
    userRole?: UserRole,
    isApiKeyAuth = false,
  ): Promise<ClientResponseDto[]> {
    // In api-key mode, return all clients
    if (isApiKeyAuth || this.isApiKeyMode()) {
      const clients = await this.clientsRepository.findAll(limit, offset);
      const viewer = { userId, userRole, isApiKeyAuth: true };

      return Promise.all(
        clients.map(async (client) => {
          const dto = await this.mapToResponseDto(client, viewer);

          try {
            dto.config = await this.clientAgentProxyService.getClientConfig(client.id);
          } catch (error) {
            // Config is optional, continue without it
          }

          return dto;
        }),
      );
    }

    // For non-api-key mode, filter by permissions
    if (!userId || !userRole) {
      return [];
    }

    // Global admin: return all clients
    if (userRole === UserRole.ADMIN) {
      const clients = await this.clientsRepository.findAll(limit, offset);
      const viewer = { userId, userRole, isApiKeyAuth: false };

      return Promise.all(
        clients.map(async (client) => {
          const dto = await this.mapToResponseDto(client, viewer);

          try {
            dto.config = await this.clientAgentProxyService.getClientConfig(client.id);
          } catch (error) {
            // Config is optional, continue without it
          }

          return dto;
        }),
      );
    }

    // Get all clients the user has access to
    // 1. Clients created by the user
    // 2. Clients where user is in client_users table
    const userClients = await this.clientUsersRepository.findByUserId(userId);
    const clientIds = new Set<string>();

    userClients.forEach((cu) => clientIds.add(cu.clientId));

    // Also get clients created by the user
    const allClients = await this.clientsRepository.findAll(1000, 0); // Get all for filtering
    const accessibleClients = allClients.filter((client) => client.userId === userId || clientIds.has(client.id));
    // Apply pagination
    const paginatedClients = accessibleClients.slice(offset, offset + limit);
    const viewer = { userId, userRole, isApiKeyAuth: false };

    return Promise.all(
      paginatedClients.map(async (client) => {
        const dto = await this.mapToResponseDto(client, viewer);

        try {
          dto.config = await this.clientAgentProxyService.getClientConfig(client.id);
        } catch (error) {
          // Config is optional, continue without it
        }

        return dto;
      }),
    );
  }

  /**
   * Find a client by ID, checking user permissions.
   * @param id - The UUID of the client
   * @param userId - The UUID of the user (optional, for api-key mode)
   * @param userRole - The role of the user (optional, for api-key mode)
   * @param isApiKeyAuth - Whether the request is authenticated via API key
   * @returns The client response DTO
   * @throws NotFoundException if client is not found
   * @throws ForbiddenException if user does not have access to the client
   */
  async findOne(id: string, userId?: string, userRole?: UserRole, isApiKeyAuth = false): Promise<ClientResponseDto> {
    const client = await this.clientsRepository.findByIdOrThrow(id);

    // Check access permissions
    if (!isApiKeyAuth && !this.isApiKeyMode() && userId && userRole) {
      const access = await checkClientAccess(
        this.clientsRepository,
        this.clientUsersRepository,
        id,
        userId,
        userRole,
        isApiKeyAuth,
      );

      if (!access.hasAccess) {
        throw new ForbiddenException('You do not have access to this client');
      }
    }

    const dto = await this.mapToResponseDto(client, { userId, userRole, isApiKeyAuth });

    // Fetch config from agent-manager, but don't fail if request fails
    try {
      dto.config = await this.clientAgentProxyService.getClientConfig(id);
    } catch (error) {
      // Config is optional, continue without it
    }

    return dto;
  }

  /**
   * Update an existing client, checking user permissions.
   * API key can be updated but will never be included in responses.
   * @param id - The UUID of the client to update
   * @param updateClientDto - Data transfer object for updating a client
   * @param userId - The UUID of the user (optional, for api-key mode)
   * @param userRole - The role of the user (optional, for api-key mode)
   * @param isApiKeyAuth - Whether the request is authenticated via API key
   * @returns The updated client response DTO
   * @throws NotFoundException if client is not found
   * @throws BadRequestException if new name conflicts with existing client
   * @throws ForbiddenException if user does not have access to the client
   */
  async update(
    id: string,
    updateClientDto: UpdateClientDto,
    userId?: string,
    userRole?: UserRole,
    isApiKeyAuth = false,
  ): Promise<ClientResponseDto> {
    // Check access permissions (workspace managers only)
    if (!isApiKeyAuth && !this.isApiKeyMode() && userId && userRole) {
      await assertWorkspaceManagementAccessForUser(
        this.clientsRepository,
        this.clientUsersRepository,
        id,
        userId,
        userRole,
        isApiKeyAuth,
      );
    }

    // If name is being updated, check for conflicts
    if (updateClientDto.name) {
      const existingClient = await this.clientsRepository.findByName(updateClientDto.name);

      if (existingClient && existingClient.id !== id) {
        throw new BadRequestException(`Client with name '${updateClientDto.name}' already exists`);
      }
    }

    // If authentication type is being changed to KEYCLOAK, validate credentials
    if (updateClientDto.authenticationType === AuthenticationType.KEYCLOAK) {
      const existingClient = await this.clientsRepository.findById(id);
      const isChangingToKeycloak = existingClient?.authenticationType !== AuthenticationType.KEYCLOAK;

      // If changing to KEYCLOAK type, credentials are required
      if (isChangingToKeycloak) {
        if (!updateClientDto.keycloakClientId || !updateClientDto.keycloakClientSecret) {
          throw new BadRequestException(
            'Keycloak client ID and client secret are required when changing authentication type to KEYCLOAK',
          );
        }
      } else {
        // If already KEYCLOAK and credentials are being updated, both must be provided
        if (
          (updateClientDto.keycloakClientId !== undefined || updateClientDto.keycloakClientSecret !== undefined) &&
          (!updateClientDto.keycloakClientId || !updateClientDto.keycloakClientSecret)
        ) {
          throw new BadRequestException(
            'Keycloak client ID and client secret must both be provided when updating credentials',
          );
        }
      }
    }

    // Prepare update data (including API key and Keycloak credentials if provided)
    const updateData: Partial<ClientEntity> = {
      name: updateClientDto.name,
      description: updateClientDto.description,
      endpoint: updateClientDto.endpoint,
      authenticationType: updateClientDto.authenticationType,
      apiKey: updateClientDto.apiKey,
      keycloakClientId: updateClientDto.keycloakClientId,
      keycloakClientSecret: updateClientDto.keycloakClientSecret,
      keycloakRealm: updateClientDto.keycloakRealm,
      agentWsPort: updateClientDto.agentWsPort,
    };

    // If Keycloak credentials are being updated, clear the token cache
    if (updateClientDto.keycloakClientId || updateClientDto.keycloakClientSecret || updateClientDto.keycloakRealm) {
      const existingClient = await this.clientsRepository.findById(id);

      if (existingClient) {
        const authServerUrl = process.env.KEYCLOAK_AUTH_SERVER_URL || '';
        const realm = updateClientDto.keycloakRealm || existingClient.keycloakRealm || process.env.KEYCLOAK_REALM || '';
        const clientId = updateClientDto.keycloakClientId || existingClient.keycloakClientId || '';

        if (authServerUrl && realm && clientId) {
          this.keycloakTokenService.clearCache(authServerUrl, realm, clientId);
        }
      }
    }

    // Remove undefined fields
    Object.keys(updateData).forEach(
      (key) => updateData[key as keyof ClientEntity] === undefined && delete updateData[key as keyof ClientEntity],
    );

    const updatedClient = await this.clientsRepository.update(id, updateData);

    this.statisticsService
      .recordEntityUpdated(StatisticsEntityType.CLIENT, id, {}, userId ?? undefined)
      .catch(() => undefined);
    const dto = await this.mapToResponseDto(updatedClient, { userId, userRole, isApiKeyAuth });

    // Fetch config from agent-manager, but don't fail if request fails
    try {
      dto.config = await this.clientAgentProxyService.getClientConfig(id);
    } catch (error) {
      // Config is optional, continue without it
    }

    return dto;
  }

  /**
   * Delete a client by ID, checking user permissions.
   * @param id - The UUID of the client to delete
   * @param userId - The UUID of the user (optional, for api-key mode)
   * @param userRole - The role of the user (optional, for api-key mode)
   * @param isApiKeyAuth - Whether the request is authenticated via API key
   * @throws NotFoundException if client is not found
   * @throws ForbiddenException if user does not have access to the client
   */
  async remove(id: string, userId?: string, userRole?: UserRole, isApiKeyAuth = false): Promise<void> {
    const client = await this.clientsRepository.findByIdOrThrow(id);

    // Check access permissions (workspace managers only)
    if (!isApiKeyAuth && !this.isApiKeyMode() && userId && userRole) {
      await assertWorkspaceManagementAccessForUser(
        this.clientsRepository,
        this.clientUsersRepository,
        id,
        userId,
        userRole,
        isApiKeyAuth,
      );
    }

    // Clear token cache if it's a Keycloak client
    if (client.authenticationType === AuthenticationType.KEYCLOAK && client.keycloakClientId && client.keycloakRealm) {
      const authServerUrl = process.env.KEYCLOAK_AUTH_SERVER_URL || '';

      if (authServerUrl) {
        this.keycloakTokenService.clearCache(authServerUrl, client.keycloakRealm, client.keycloakClientId);
      }
    }

    this.statisticsService
      .recordEntityDeleted(StatisticsEntityType.CLIENT, id, userId ?? undefined)
      .catch(() => undefined);
    await this.clientsRepository.delete(id);
  }

  /**
   * Get client IDs the user has access to (for statistics filtering).
   * API key and admin: all clients. Regular user: clients they created + clients in client_users.
   * @param userId - The UUID of the user (optional)
   * @param userRole - The role of the user (optional)
   * @param isApiKeyAuth - Whether the request is authenticated via API key
   * @returns Array of client UUIDs
   */
  async getAccessibleClientIds(userId?: string, userRole?: UserRole, isApiKeyAuth = false): Promise<string[]> {
    if (isApiKeyAuth || this.isApiKeyMode()) {
      return await this.clientsRepository.findAllIds();
    }

    if (userRole === UserRole.ADMIN) {
      return await this.clientsRepository.findAllIds();
    }

    if (!userId || !userRole) {
      return [];
    }

    const clientIds = new Set<string>();
    const userClients = await this.clientUsersRepository.findByUserId(userId);

    userClients.forEach((cu) => clientIds.add(cu.clientId));
    const creatorIds = await this.clientsRepository.findIdsByCreatorId(userId);

    creatorIds.forEach((id) => clientIds.add(id));

    return Array.from(clientIds);
  }

  /**
   * Get a JWT access token for a client using Keycloak client credentials flow.
   * @param clientId - The UUID of the client
   * @returns JWT access token
   * @throws BadRequestException if client is not configured for Keycloak authentication
   * @throws NotFoundException if client is not found
   */
  async getAccessToken(clientId: string): Promise<string> {
    const client = await this.clientsRepository.findByIdOrThrow(clientId);

    if (client.authenticationType !== AuthenticationType.KEYCLOAK) {
      throw new BadRequestException('Client is not configured for Keycloak authentication');
    }

    if (!client.keycloakClientId || !client.keycloakClientSecret) {
      throw new BadRequestException('Keycloak client credentials are not configured for this client');
    }

    const authServerUrl = process.env.KEYCLOAK_AUTH_SERVER_URL;

    if (!authServerUrl) {
      throw new BadRequestException('KEYCLOAK_AUTH_SERVER_URL environment variable is not set');
    }

    const realm = client.keycloakRealm || process.env.KEYCLOAK_REALM;

    if (!realm) {
      throw new BadRequestException('Keycloak realm is not configured for this client and KEYCLOAK_REALM is not set');
    }

    return await this.keycloakTokenService.getAccessToken(
      authServerUrl,
      realm,
      client.keycloakClientId,
      client.keycloakClientSecret,
    );
  }

  /**
   * Map client entity to response DTO.
   * Excludes sensitive information like API key.
   * @param client - The client entity to map
   * @param viewer - Current viewer; used to compute {@link ClientResponseDto.canManageWorkspaceConfiguration}
   * @returns The client response DTO
   */
  private async mapToResponseDto(
    client: ClientEntity,
    viewer: { userId?: string; userRole?: UserRole; isApiKeyAuth: boolean } = {
      userId: undefined,
      userRole: undefined,
      isApiKeyAuth: false,
    },
  ): Promise<ClientResponseDto> {
    // Check if client was auto-provisioned by checking for provisioning reference
    const provisioningReference = await this.provisioningReferencesRepository.findByClientId(client.id);
    const isAutoProvisioned = provisioningReference !== null;
    const canManageWorkspaceConfiguration = await this.computeCanManageWorkspaceConfiguration(client.id, viewer);

    return {
      id: client.id,
      name: client.name,
      description: client.description,
      endpoint: client.endpoint,
      authenticationType: client.authenticationType,
      isAutoProvisioned,
      canManageWorkspaceConfiguration,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  private async computeCanManageWorkspaceConfiguration(
    clientId: string,
    viewer: { userId?: string; userRole?: UserRole; isApiKeyAuth: boolean },
  ): Promise<boolean> {
    if (viewer.isApiKeyAuth || this.isApiKeyMode()) {
      return true;
    }

    if (!viewer.userId || !viewer.userRole) {
      return false;
    }

    const access = await checkClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      clientId,
      viewer.userId,
      viewer.userRole,
      false,
    );

    return canManageWorkspaceConfiguration(
      { userId: viewer.userId, userRole: viewer.userRole, isApiKeyAuth: false },
      access,
    );
  }
}
