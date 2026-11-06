import { randomBytes } from 'crypto';

import {
  assertWorkspaceManagementAccessForUser,
  AuthenticationType,
  canManageWorkspaceConfiguration,
  checkClientAccess,
  ClientEntity,
  ClientUsersRepository,
  getAuthenticationMethod,
  OidcClientCredentialsService,
  UserRole,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import { ClientResponseDto } from '../dto/client-response.dto';
import { CreateClientResponseDto } from '../dto/create-client-response.dto';
import { CreateClientDto } from '../dto/create-client.dto';
import { UpdateClientDto } from '../dto/update-client.dto';
import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { createPublicAddressLookup, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { ProvisioningReferencesRepository } from '../repositories/provisioning-references.repository';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { mapClientToSearchDocument } from '../search/agenstra-search-document.mapper';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import { sanitizeListSearch, tryAgenstraSearchIds } from '../search/agenstra-search-list.util';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { ClientIsolationService } from './client-isolation.service';
import { StatisticsService } from './statistics.service';

/**
 * Service for client business logic operations.
 * Orchestrates repository operations, API key generation, and OIDC client credentials token management.
 */
@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);
  private readonly API_KEY_LENGTH = 32;

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly oidcClientCredentialsService: OidcClientCredentialsService,
    @Inject(forwardRef(() => ClientAgentProxyService))
    private readonly clientAgentProxyService: ClientAgentProxyService,
    private readonly provisioningReferencesRepository: ProvisioningReferencesRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly statisticsService: StatisticsService,
    private readonly notificationPublisher: AgenstraNotificationPublisher,
    private readonly searchIndex: AgenstraSearchIndexService,
    @Optional()
    @Inject(forwardRef(() => ClientIsolationService))
    private readonly clientIsolation?: ClientIsolationService,
  ) {}

  /** Attach the workspace host's container isolation summary (never fails the response). */
  private async attachIsolation(dto: ClientResponseDto): Promise<void> {
    if (!this.clientIsolation) {
      return;
    }

    try {
      const isolation = await this.clientIsolation.summaryForClient(dto.id, dto.config);

      if (isolation) {
        dto.isolation = isolation;
      }
    } catch {
      // Isolation is optional, continue without it
    }
  }

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
    // Same resolution as the guards (an empty AUTHENTICATION_METHOD from compose `${VAR:-}` counts as unset).
    return getAuthenticationMethod() === 'api-key';
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

    // Validate OIDC client credentials if authentication type is OIDC
    if (createClientDto.authenticationType === AuthenticationType.OIDC) {
      if (!createClientDto.oidcClientId || !createClientDto.oidcClientSecret) {
        throw new BadRequestException('OIDC client ID and client secret are required for OIDC authentication type');
      }

      await this.assertOidcIssuerUsable(createClientDto.oidcIssuer);
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
      oidcClientId: createClientDto.oidcClientId,
      oidcClientSecret: createClientDto.oidcClientSecret,
      oidcIssuer: createClientDto.oidcIssuer?.trim() || null,
      oidcScope: createClientDto.oidcScope?.trim() || null,
      userId: userId ?? null,
    });
    const response = await this.mapToResponseDto(client, { userId, userRole, isApiKeyAuth });

    this.statisticsService
      .recordEntityCreated(StatisticsEntityType.CLIENT, client.id, {}, userId ?? undefined)
      .catch(() => undefined);
    this.notificationPublisher.publishClient('client.created', client);
    void this.searchIndex.upsertSafe('clients', mapClientToSearchDocument(client));

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
    options?: { amr?: string[]; search?: string },
  ): Promise<ClientResponseDto[]> {
    const sanitized = sanitizeListSearch(options?.search);
    const mapClients = async (clients: ClientEntity[]) => {
      const viewer = { userId, userRole, isApiKeyAuth: isApiKeyAuth || this.isApiKeyMode(), amr: options?.amr };

      return Promise.all(
        clients.map(async (client) => {
          const dto = await this.mapToResponseDto(client, viewer);

          try {
            dto.config = await this.clientAgentProxyService.getClientConfig(client.id);
          } catch (error) {
            // Config is optional, continue without it
          }

          await this.attachIsolation(dto);

          return dto;
        }),
      );
    };

    const loadWithSearch = async (clientIds?: string[]): Promise<ClientEntity[]> => {
      const openSearchIds = await tryAgenstraSearchIds(
        this.searchIndex,
        {
          entityType: 'clients',
          query: sanitized,
          clientIds,
          limit,
          offset,
        },
        this.logger,
      );
      const hydrated =
        openSearchIds == null
          ? null
          : openSearchIds.ids.length === 0
            ? openSearchIds.total > 0
              ? []
              : null
            : await this.clientsRepository.findByIdsOrdered(openSearchIds.ids);

      if (hydrated !== null) {
        return hydrated;
      }

      return await this.clientsRepository.findAllFiltered(limit, offset, { search: sanitized, clientIds });
    };

    // In api-key mode, return all clients
    if (isApiKeyAuth || this.isApiKeyMode()) {
      if (!sanitized) {
        return await mapClients(await this.clientsRepository.findAll(limit, offset));
      }

      return await mapClients(await loadWithSearch(await this.clientsRepository.findAllIds()));
    }

    // For non-api-key mode, filter by permissions
    if (!userId || !userRole) {
      return [];
    }

    // Global console admin: return all clients (PAT must not inherit this via role alone).
    if (userRole === UserRole.ADMIN && !(options?.amr ?? []).includes('pat')) {
      if (!sanitized) {
        return await mapClients(await this.clientsRepository.findAll(limit, offset));
      }

      return await mapClients(await loadWithSearch(await this.clientsRepository.findAllIds()));
    }

    // Get all clients the user has access to
    const userClients = await this.clientUsersRepository.findByUserId(userId);
    const clientIds = new Set<string>();

    userClients.forEach((cu) => clientIds.add(cu.clientId));

    const allClients = await this.clientsRepository.findAll(1000, 0);
    const accessibleClients = allClients.filter((client) => client.userId === userId || clientIds.has(client.id));
    const accessibleIds = accessibleClients.map((client) => client.id);

    if (sanitized) {
      const openSearchIds = await tryAgenstraSearchIds(
        this.searchIndex,
        {
          entityType: 'clients',
          query: sanitized,
          clientIds: accessibleIds,
          limit: 10_000,
          offset: 0,
        },
        this.logger,
      );
      const hydratedItems =
        openSearchIds == null
          ? null
          : openSearchIds.ids.length === 0
            ? openSearchIds.total > 0
              ? []
              : null
            : await this.clientsRepository.findByIdsOrdered(openSearchIds.ids);

      if (hydratedItems !== null) {
        const paginated = hydratedItems.slice(offset, offset + limit);

        return await mapClients(paginated);
      }

      const filtered = accessibleClients.filter((client) =>
        [client.id, client.name, client.description, client.endpoint].some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(sanitized.toLowerCase()),
        ),
      );

      return await mapClients(filtered.slice(offset, offset + limit));
    }

    return await mapClients(accessibleClients.slice(offset, offset + limit));
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
  async findOne(
    id: string,
    userId?: string,
    userRole?: UserRole,
    isApiKeyAuth = false,
    options?: { amr?: string[] },
  ): Promise<ClientResponseDto> {
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
        options,
      );

      if (!access.hasAccess) {
        throw new ForbiddenException('You do not have access to this client');
      }
    }

    const dto = await this.mapToResponseDto(client, { userId, userRole, isApiKeyAuth, amr: options?.amr });

    // Fetch config from agent-manager, but don't fail if request fails
    try {
      dto.config = await this.clientAgentProxyService.getClientConfig(id);
    } catch (error) {
      // Config is optional, continue without it
    }

    await this.attachIsolation(dto);

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
    options?: { amr?: string[] },
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
        options,
      );
    }

    // If name is being updated, check for conflicts
    if (updateClientDto.name) {
      const existingClient = await this.clientsRepository.findByName(updateClientDto.name);

      if (existingClient && existingClient.id !== id) {
        throw new BadRequestException(`Client with name '${updateClientDto.name}' already exists`);
      }
    }

    const clientBeforeUpdate = await this.clientsRepository.findById(id);

    // If authentication type is OIDC (new or kept), validate credentials
    if (
      updateClientDto.authenticationType === AuthenticationType.OIDC ||
      (updateClientDto.authenticationType === undefined &&
        clientBeforeUpdate?.authenticationType === AuthenticationType.OIDC)
    ) {
      const isChangingToOidc = clientBeforeUpdate?.authenticationType !== AuthenticationType.OIDC;

      if (isChangingToOidc) {
        // Changing to OIDC: credentials are required
        if (!updateClientDto.oidcClientId || !updateClientDto.oidcClientSecret) {
          throw new BadRequestException(
            'OIDC client ID and client secret are required when changing authentication type to OIDC',
          );
        }
      } else if (
        (updateClientDto.oidcClientId !== undefined || updateClientDto.oidcClientSecret !== undefined) &&
        (!updateClientDto.oidcClientId || !updateClientDto.oidcClientSecret)
      ) {
        // Already OIDC and credentials are being updated: both must be provided
        throw new BadRequestException(
          'OIDC client ID and client secret must both be provided when updating credentials',
        );
      }

      if (updateClientDto.oidcIssuer !== undefined) {
        await this.assertOidcIssuerUsable(updateClientDto.oidcIssuer);
      }
    }

    // Prepare update data (including API key and OIDC credentials if provided)
    const updateData: Partial<ClientEntity> = {
      name: updateClientDto.name,
      description: updateClientDto.description,
      endpoint: updateClientDto.endpoint,
      authenticationType: updateClientDto.authenticationType,
      apiKey: updateClientDto.apiKey,
      oidcClientId: updateClientDto.oidcClientId,
      oidcClientSecret: updateClientDto.oidcClientSecret,
      oidcIssuer: updateClientDto.oidcIssuer === undefined ? undefined : updateClientDto.oidcIssuer.trim() || null,
      oidcScope: updateClientDto.oidcScope === undefined ? undefined : updateClientDto.oidcScope.trim() || null,
    };

    // If OIDC credentials or provider settings change, drop cached tokens of the old configuration
    if (
      clientBeforeUpdate?.oidcClientId &&
      (updateClientDto.oidcClientId !== undefined ||
        updateClientDto.oidcClientSecret !== undefined ||
        updateClientDto.oidcIssuer !== undefined ||
        updateClientDto.oidcScope !== undefined ||
        updateClientDto.authenticationType !== undefined)
    ) {
      this.clearOidcTokenCache(clientBeforeUpdate);
    }

    // Remove undefined fields
    Object.keys(updateData).forEach(
      (key) => updateData[key as keyof ClientEntity] === undefined && delete updateData[key as keyof ClientEntity],
    );

    const updatedClient = await this.clientsRepository.update(id, updateData);

    this.statisticsService
      .recordEntityUpdated(StatisticsEntityType.CLIENT, id, {}, userId ?? undefined)
      .catch(() => undefined);
    this.notificationPublisher.publishClient('client.updated', updatedClient);
    void this.searchIndex.upsertSafe('clients', mapClientToSearchDocument(updatedClient));
    const dto = await this.mapToResponseDto(updatedClient, { userId, userRole, isApiKeyAuth, amr: options?.amr });

    // Fetch config from agent-manager, but don't fail if request fails
    try {
      dto.config = await this.clientAgentProxyService.getClientConfig(id);
    } catch (error) {
      // Config is optional, continue without it
    }

    await this.attachIsolation(dto);

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

    // Clear token cache if it's an OIDC client
    if (client.authenticationType === AuthenticationType.OIDC && client.oidcClientId) {
      this.clearOidcTokenCache(client);
    }

    this.statisticsService
      .recordEntityDeleted(StatisticsEntityType.CLIENT, id, userId ?? undefined)
      .catch(() => undefined);
    this.notificationPublisher.publishClient('client.deleted', client);
    void this.searchIndex.deleteSafe('clients', id);
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
  async getAccessibleClientIds(
    userId?: string,
    userRole?: UserRole,
    isApiKeyAuth = false,
    options?: { amr?: string[] },
  ): Promise<string[]> {
    if (isApiKeyAuth || this.isApiKeyMode()) {
      return await this.clientsRepository.findAllIds();
    }

    if (userRole === UserRole.ADMIN && !(options?.amr ?? []).includes('pat')) {
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
   * Get an access token for a client using the OAuth 2.0 client credentials grant (any OpenID provider).
   * @param clientId - The UUID of the client
   * @returns Access token for the client's agent-manager (`AUTHENTICATION_METHOD=oidc`)
   * @throws BadRequestException if client is not configured for OIDC authentication
   * @throws NotFoundException if client is not found
   */
  async getAccessToken(clientId: string): Promise<string> {
    const client = await this.clientsRepository.findByIdOrThrow(clientId);

    if (client.authenticationType !== AuthenticationType.OIDC) {
      throw new BadRequestException('Client is not configured for OIDC authentication');
    }

    if (!client.oidcClientId || !client.oidcClientSecret) {
      throw new BadRequestException('OIDC client credentials are not configured for this client');
    }

    const issuer = this.resolveOidcIssuer(client);

    if (!issuer) {
      throw new BadRequestException('OIDC issuer is not configured for this client and OIDC_ISSUER is not set');
    }

    return await this.oidcClientCredentialsService.getAccessToken({
      issuer,
      clientId: client.oidcClientId,
      clientSecret: client.oidcClientSecret,
      scope: client.oidcScope ?? undefined,
      // Per-client issuers are user supplied: same SSRF policy as client endpoints (operator-set OIDC_ISSUER is trusted).
      assertUrlAllowed: this.isTrustedOidcIssuer(issuer)
        ? undefined
        : async (url) => {
            await validateClientEndpointWithDnsOrThrow(url);
          },
      // Pin the connection to a validated public address (no DNS rebinding between check and request).
      lookup: this.isTrustedOidcIssuer(issuer) ? undefined : createPublicAddressLookup(),
    });
  }

  private resolveOidcIssuer(client: Pick<ClientEntity, 'oidcIssuer'>): string | undefined {
    return client.oidcIssuer?.trim() || process.env.OIDC_ISSUER?.trim() || undefined;
  }

  /**
   * Operator-configured issuers are trusted (no client-endpoint SSRF policy): the controller's own `OIDC_ISSUER` and
   * `OIDC_TRUSTED_CLIENT_ISSUERS` (comma-separated, e.g. an internal `http://keycloak:8080/realms/x`). Issuers entered
   * by users for a client are only reachable under the client-endpoint SSRF policy.
   */
  private isTrustedOidcIssuer(issuer: string): boolean {
    const normalize = (value: string) => value.trim().replace(/\/+$/, '');
    const trusted = [process.env.OIDC_ISSUER ?? '', ...(process.env.OIDC_TRUSTED_CLIENT_ISSUERS ?? '').split(',')]
      .map(normalize)
      .filter((value) => value.length > 0);

    return trusted.includes(normalize(issuer));
  }

  /** Rejects per-client issuers that violate the client endpoint SSRF policy; requires some issuer to exist. */
  private async assertOidcIssuerUsable(oidcIssuer: string | undefined): Promise<void> {
    const issuer = oidcIssuer?.trim();

    if (!issuer) {
      if (!process.env.OIDC_ISSUER?.trim()) {
        throw new BadRequestException(
          'OIDC issuer is required because OIDC_ISSUER is not configured on the controller',
        );
      }

      return;
    }

    if (!this.isTrustedOidcIssuer(issuer)) {
      await validateClientEndpointWithDnsOrThrow(issuer);
    }
  }

  private clearOidcTokenCache(client: Pick<ClientEntity, 'oidcIssuer' | 'oidcClientId'>): void {
    const issuer = this.resolveOidcIssuer(client);

    if (issuer && client.oidcClientId) {
      this.oidcClientCredentialsService.clearCache(issuer, client.oidcClientId);
    }
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
    viewer: { userId?: string; userRole?: UserRole; isApiKeyAuth: boolean; amr?: string[] } = {
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
    viewer: { userId?: string; userRole?: UserRole; isApiKeyAuth: boolean; amr?: string[] },
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
      { amr: viewer.amr },
    );

    return canManageWorkspaceConfiguration(
      { userId: viewer.userId, userRole: viewer.userRole, isApiKeyAuth: false, amr: viewer.amr },
      access,
    );
  }
}
