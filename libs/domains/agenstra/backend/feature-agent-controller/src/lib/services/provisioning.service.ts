import { randomBytes } from 'crypto';

import { GitRepositorySetupMode } from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, UserRole } from '@forepath/identity/backend';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProvisionServerDto } from '../dto/provision-server.dto';
import { ProvisionedServerResponseDto } from '../dto/provisioned-server-response.dto';
import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ProvisioningProviderFactory } from '../providers/provisioning-provider.factory';
import { ProvisioningReferencesRepository } from '../repositories/provisioning-references.repository';

import { ClientsService } from './clients.service';
import { StatisticsService } from './statistics.service';

/**
 * Service for orchestrating server provisioning through cloud providers.
 * Handles provider selection, server provisioning, client creation, and reference storage.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);
  private readonly API_KEY_LENGTH = 32;

  constructor(
    private readonly provisioningProviderFactory: ProvisioningProviderFactory,
    @Inject(forwardRef(() => ClientsService))
    private readonly clientsService: ClientsService,
    private readonly provisioningReferencesRepository: ProvisioningReferencesRepository,
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
   * Generate user data script with authentication, GIT, and other configuration.
   * @param authenticationType - The authentication type (API_KEY or KEYCLOAK)
   * @param apiKey - The API key (for API_KEY authentication)
   * @param keycloakConfig - Keycloak configuration (for KEYCLOAK authentication)
   * @param gitConfig - Git repository configuration
   * @param cursorApiKey - Cursor API key for agent configuration
   * @param agentDefaultImage - Default image for cursor agents
   * @param autoEnrichEnabledGlobal - When set, written as AUTO_ENRICH_ENABLED_GLOBAL for agent-manager (`true`|`false`)
   * @param autoEnrichVectorMaxCosineDistance - When set, written as AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE (0–2)
   * @returns User data script string
   */
  private generateAuthUserData(
    authenticationType: AuthenticationType,
    apiKey?: string,
    keycloakConfig?: { clientId: string; clientSecret: string; realm?: string; authServerUrl?: string },
    gitConfig?: {
      setupMode?: GitRepositorySetupMode;
      repositoryUrl?: string;
      username?: string;
      token?: string;
      password?: string;
      privateKey?: string;
    },
    cursorApiKey?: string,
    agentDefaultImage?: string,
    autoEnrichEnabledGlobal?: string,
    autoEnrichVectorMaxCosineDistance?: number,
  ): string {
    // Build authentication environment variables
    const authEnvVars: string[] = [];

    if (authenticationType === AuthenticationType.API_KEY) {
      if (!apiKey) {
        throw new BadRequestException('API key is required for API_KEY authentication type');
      }

      authEnvVars.push(`STATIC_API_KEY: ${apiKey}`);
    } else if (authenticationType === AuthenticationType.KEYCLOAK) {
      if (!keycloakConfig?.clientId || !keycloakConfig?.clientSecret) {
        throw new BadRequestException('Keycloak client ID and secret are required for KEYCLOAK authentication type');
      }

      const authServerUrl = keycloakConfig.authServerUrl || process.env.KEYCLOAK_AUTH_SERVER_URL || '';
      const realm = keycloakConfig.realm || process.env.KEYCLOAK_REALM || '';

      authEnvVars.push(`KEYCLOAK_AUTH_SERVER_URL: ${authServerUrl}`);
      authEnvVars.push(`KEYCLOAK_REALM: ${realm}`);
      authEnvVars.push(`KEYCLOAK_CLIENT_ID: ${keycloakConfig.clientId}`);
      authEnvVars.push(`KEYCLOAK_CLIENT_SECRET: ${keycloakConfig.clientSecret}`);
    }

    // Build GIT environment variables
    const gitEnvVars: string[] = [];

    if (gitConfig?.setupMode === GitRepositorySetupMode.EMPTY) {
      gitEnvVars.push(`GIT_REPOSITORY_SETUP_MODE: ${GitRepositorySetupMode.EMPTY}`);
    } else if (gitConfig) {
      if (gitConfig.repositoryUrl) {
        gitEnvVars.push(`GIT_REPOSITORY_URL: ${gitConfig.repositoryUrl}`);
      }

      if (gitConfig.username) {
        gitEnvVars.push(`GIT_USERNAME: ${gitConfig.username}`);
      }

      if (gitConfig.token) {
        gitEnvVars.push(`GIT_TOKEN: ${gitConfig.token}`);
      }

      if (gitConfig.password) {
        gitEnvVars.push(`GIT_PASSWORD: ${gitConfig.password}`);
      }

      if (gitConfig.privateKey) {
        gitEnvVars.push(`GIT_PRIVATE_KEY: ${gitConfig.privateKey}`);
      }
    }

    // Build cursor agent environment variables (only add if provided)
    const cursorEnvVars: string[] = [];

    if (cursorApiKey) {
      cursorEnvVars.push(`CURSOR_API_KEY: ${cursorApiKey}`);
    }

    if (agentDefaultImage) {
      cursorEnvVars.push(`AGENT_DEFAULT_IMAGE: ${agentDefaultImage}`);
    }

    if (autoEnrichEnabledGlobal === 'true' || autoEnrichEnabledGlobal === 'false') {
      cursorEnvVars.push(`AUTO_ENRICH_ENABLED_GLOBAL: ${autoEnrichEnabledGlobal}`);
    }

    if (
      autoEnrichVectorMaxCosineDistance !== undefined &&
      Number.isFinite(autoEnrichVectorMaxCosineDistance) &&
      autoEnrichVectorMaxCosineDistance >= 0 &&
      autoEnrichVectorMaxCosineDistance <= 2
    ) {
      cursorEnvVars.push(`AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE: ${autoEnrichVectorMaxCosineDistance}`);
    }

    // Combine all environment variables (dynamic variables take precedence)
    const allEnvVars = [...authEnvVars, ...gitEnvVars, ...cursorEnvVars];

    return `
# Configure agent-manager with authentication, GIT, and cursor agent configuration
# Update docker-compose.yml with environment variables

# Generate self-signed SSL certificate for nginx (if not already generated)
if [ ! -f /opt/agent-manager/ssl/nginx-selfsigned.crt ]; then
    log "Generating self-signed SSL certificate..."
    mkdir -p /opt/agent-manager/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
        -keyout /opt/agent-manager/ssl/nginx-selfsigned.key \\
        -out /opt/agent-manager/ssl/nginx-selfsigned.crt \\
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" \\
        -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" 2>/dev/null || {
        log "WARNING: Failed to generate SSL certificate, nginx will not work properly"
    }
    chmod 600 /opt/agent-manager/ssl/nginx-selfsigned.key
    chmod 644 /opt/agent-manager/ssl/nginx-selfsigned.crt
fi

# Create nginx configuration (if not already created)
if [ ! -f /opt/agent-manager/nginx.conf ]; then
    log "Creating nginx configuration..."
    cat > /opt/agent-manager/nginx.conf << 'NGINX_CONF_EOF'
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server backend-agent-manager:3000;
    }

    upstream websocket {
        server backend-agent-manager:8080;
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }

    # HTTPS server for API (port 3000)
    server {
        listen 3000 ssl http2;
        server_name _;

        ssl_certificate /etc/nginx/ssl/nginx-selfsigned.crt;
        ssl_certificate_key /etc/nginx/ssl/nginx-selfsigned.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        # API proxy
        location /api/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\\n";
            add_header Content-Type text/plain;
        }
    }

    # HTTPS server for Socket.IO WebSocket (port 8443)
    server {
        listen 8443 ssl http2;
        server_name _;

        ssl_certificate /etc/nginx/ssl/nginx-selfsigned.crt;
        ssl_certificate_key /etc/nginx/ssl/nginx-selfsigned.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location ~* \\.io {
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header Host $http_host;
          proxy_set_header X-NginX-Proxy false;

          proxy_pass http://websocket;
          proxy_redirect off;

          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
        }
    }
}
NGINX_CONF_EOF
fi

cat > /opt/agent-manager/docker-compose.yml << 'DOCKER_COMPOSE_EOF'
services:
  postgres:
    image: postgres:16-alpine
    container_name: agent-manager-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - agent-manager-network

  backend-agent-manager:
    image: ghcr.io/forepath/agenstra-manager-api:latest
    pull_policy: always
    container_name: agent-manager-api
    environment:
      # Backend API configuration
      HOST: 0.0.0.0
      PORT: 3000
      WEBSOCKET_PORT: 8080
      NODE_ENV: production
      # Database configuration
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USERNAME: postgres
      DB_PASSWORD: postgres
      DB_DATABASE: postgres
${
  allEnvVars.length > 0
    ? `      # Dynamic configuration (authentication, GIT, cursor agent)
${allEnvVars.map((line) => `      ${line}`).join('\n')}`
    : ''
}
    expose:
      - "3000"
      - "8080"
    volumes:
      # Mount Docker socket for Docker-in-Docker functionality
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - agent-manager-network
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: agent-manager-nginx
    ports:
      - "3000:3000"
      - "8443:8443"
    volumes:
      - /opt/agent-manager/ssl:/etc/nginx/ssl:ro
      - /opt/agent-manager/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - backend-agent-manager
    networks:
      - agent-manager-network
    restart: unless-stopped

volumes:
  postgres_data:

networks:
  agent-manager-network:
    driver: bridge
DOCKER_COMPOSE_EOF
`;
  }

  /**
   * Provision a new server and create a client.
   * @param provisionServerDto - Provisioning options
   * @param userId - The UUID of the user creating the client (optional, for api-key mode)
   * @param userRole - Global user role when authenticated interactively
   * @param isApiKeyAuth - True when the request used API key authentication
   * @returns Provisioned server response with client information
   */
  async provisionServer(
    provisionServerDto: ProvisionServerDto,
    userId?: string,
    userRole?: UserRole,
    isApiKeyAuth = false,
  ): Promise<ProvisionedServerResponseDto> {
    // Get the provider
    if (!this.provisioningProviderFactory.hasProvider(provisionServerDto.providerType)) {
      throw new BadRequestException(
        `Provider type '${provisionServerDto.providerType}' is not available. Available types: ${this.provisioningProviderFactory.getRegisteredTypes().join(', ')}`,
      );
    }

    const provider = this.provisioningProviderFactory.getProvider(provisionServerDto.providerType);
    // Generate API key if needed
    let apiKey: string | undefined;

    if (provisionServerDto.authenticationType === AuthenticationType.API_KEY) {
      apiKey = provisionServerDto.apiKey || this.generateRandomApiKey();
    }

    // Generate user data with authentication, GIT, and cursor agent configuration
    const authUserData = this.generateAuthUserData(
      provisionServerDto.authenticationType,
      apiKey,
      provisionServerDto.authenticationType === AuthenticationType.KEYCLOAK
        ? {
            clientId: provisionServerDto.keycloakClientId || '',
            clientSecret: provisionServerDto.keycloakClientSecret || '',
            realm: provisionServerDto.keycloakRealm,
            authServerUrl: provisionServerDto.keycloakAuthServerUrl,
          }
        : undefined,
      provisionServerDto.gitRepositorySetupMode === GitRepositorySetupMode.EMPTY
        ? { setupMode: GitRepositorySetupMode.EMPTY }
        : provisionServerDto.gitRepositoryUrl ||
            provisionServerDto.gitUsername ||
            provisionServerDto.gitToken ||
            provisionServerDto.gitPassword ||
            provisionServerDto.gitPrivateKey
          ? {
              setupMode: GitRepositorySetupMode.CLONE,
              repositoryUrl: provisionServerDto.gitRepositoryUrl,
              username: provisionServerDto.gitUsername,
              token: provisionServerDto.gitToken,
              password: provisionServerDto.gitPassword,
              privateKey: provisionServerDto.gitPrivateKey,
            }
          : undefined,
      provisionServerDto.cursorApiKey,
      provisionServerDto.agentDefaultImage,
      provisionServerDto.autoEnrichEnabledGlobal,
      provisionServerDto.autoEnrichVectorMaxCosineDistance,
    );
    // Encode user data as base64 for passing to provider
    const encodedUserData = Buffer.from(authUserData).toString('base64');

    // Provision the server
    this.logger.log(`Provisioning server via ${provisionServerDto.providerType} provider...`);
    const provisionedServer = await provider.provisionServer({
      serverType: provisionServerDto.serverType,
      name: provisionServerDto.name,
      description: provisionServerDto.description,
      location: provisionServerDto.location,
      userData: encodedUserData,
    });

    this.logger.log(`Server provisioned: ${provisionedServer.serverId} at ${provisionedServer.endpoint}`);

    // Create client in database
    const client = await this.clientsService.create(
      {
        name: provisionServerDto.name,
        description: provisionServerDto.description || `Provisioned via ${provisionServerDto.providerType}`,
        endpoint: provisionedServer.endpoint,
        authenticationType: provisionServerDto.authenticationType,
        apiKey,
        keycloakClientId: provisionServerDto.keycloakClientId,
        keycloakClientSecret: provisionServerDto.keycloakClientSecret,
        keycloakRealm: provisionServerDto.keycloakRealm,
        agentWsPort: provisionServerDto.agentWsPort || 8443,
      },
      userId,
      userRole,
      isApiKeyAuth,
    );
    // Create provisioning reference
    const reference = await this.provisioningReferencesRepository.create({
      clientId: client.id,
      providerType: provisionServerDto.providerType,
      serverId: provisionedServer.serverId,
      serverName: provisionedServer.name,
      publicIp: provisionedServer.publicIp,
      privateIp: provisionedServer.privateIp,
      providerMetadata: JSON.stringify(provisionedServer.metadata || {}),
    });

    this.statisticsService
      .recordEntityCreated(
        StatisticsEntityType.PROVISIONING_REFERENCE,
        reference.id,
        {
          clientId: client.id,
          providerType: provisionServerDto.providerType,
          serverId: provisionedServer.serverId,
          serverName: provisionedServer.name,
          publicIp: provisionedServer.publicIp,
          privateIp: provisionedServer.privateIp,
          providerMetadata: JSON.stringify(provisionedServer.metadata || {}),
        },
        userId,
      )
      .catch(() => undefined);

    this.logger.log(`Created provisioning reference ${reference.id} for client ${client.id}`);

    return {
      ...client,
      isAutoProvisioned: true,
      providerType: provisionServerDto.providerType,
      serverId: provisionedServer.serverId,
      serverName: provisionedServer.name,
      publicIp: provisionedServer.publicIp,
      privateIp: provisionedServer.privateIp,
      serverStatus: provisionedServer.status,
    };
  }

  /**
   * Delete a provisioned server and its associated client.
   * @param clientId - The UUID of the client
   * @param userId - The UUID of the user performing the delete (optional)
   */
  async deleteProvisionedServer(clientId: string, userId?: string): Promise<void> {
    // Find provisioning reference
    const reference = await this.provisioningReferencesRepository.findByClientId(clientId);

    if (!reference) {
      throw new BadRequestException(`No provisioning reference found for client ${clientId}`);
    }

    this.statisticsService
      .recordEntityDeleted(StatisticsEntityType.PROVISIONING_REFERENCE, reference.id, userId)
      .catch(() => undefined);

    // Get the provider
    if (!this.provisioningProviderFactory.hasProvider(reference.providerType)) {
      this.logger.warn(
        `Provider type '${reference.providerType}' is not available. Skipping server deletion, but will delete client and reference.`,
      );
    } else {
      // Delete server from provider
      const provider = this.provisioningProviderFactory.getProvider(reference.providerType);

      try {
        await provider.deleteServer(reference.serverId);
        this.logger.log(`Deleted server ${reference.serverId} from ${reference.providerType}`);
      } catch (error) {
        this.logger.error(`Failed to delete server from provider: ${(error as Error).message}`);
        // Continue with client deletion even if server deletion fails
      }
    }

    // Delete client (this will cascade delete the provisioning reference)
    // Pass undefined for userId/userRole and true for isApiKeyAuth to bypass permission checks
    // since provisioning deletion is a special administrative operation
    await this.clientsService.remove(clientId, undefined, undefined, true);
  }

  /**
   * Get server information for a provisioned client.
   * @param clientId - The UUID of the client
   * @returns Server information
   */
  async getServerInfo(clientId: string): Promise<{
    serverId: string;
    serverName?: string;
    publicIp?: string;
    privateIp?: string;
    serverStatus?: string;
    providerType: string;
  }> {
    const reference = await this.provisioningReferencesRepository.findByClientId(clientId);

    if (!reference) {
      throw new NotFoundException(`No provisioning reference found for client ${clientId}`);
    }

    // Get the provider
    if (!this.provisioningProviderFactory.hasProvider(reference.providerType)) {
      // Return stored information if provider is not available
      return {
        serverId: reference.serverId,
        serverName: reference.serverName,
        publicIp: reference.publicIp || undefined,
        privateIp: reference.privateIp || undefined,
        providerType: reference.providerType,
      };
    }

    // Get fresh information from provider
    const provider = this.provisioningProviderFactory.getProvider(reference.providerType);
    const serverInfo = await provider.getServerInfo(reference.serverId);

    // Update reference with fresh information
    await this.provisioningReferencesRepository.update(reference.id, {
      publicIp: serverInfo.publicIp,
      privateIp: serverInfo.privateIp,
      serverName: serverInfo.name,
    });

    return {
      serverId: serverInfo.serverId,
      serverName: serverInfo.name,
      publicIp: serverInfo.publicIp,
      privateIp: serverInfo.privateIp,
      serverStatus: serverInfo.status,
      providerType: reference.providerType,
    };
  }
}
