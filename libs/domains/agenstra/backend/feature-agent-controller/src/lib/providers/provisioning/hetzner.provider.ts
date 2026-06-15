import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import {
  ProvisionedServer,
  ProvisioningProvider,
  ProvisionServerOptions,
  ServerInfo,
  ServerType,
} from '../provisioning-provider.interface';

/**
 * Hetzner Cloud provider implementation.
 * Handles server provisioning, configuration, and deletion via Hetzner Cloud API.
 */
@Injectable()
export class HetznerProvider implements ProvisioningProvider {
  private readonly logger = new Logger(HetznerProvider.name);
  private static readonly TYPE = 'hetzner';
  private static readonly API_BASE_URL = 'https://api.hetzner.cloud/v1';
  private readonly apiToken: string;

  constructor() {
    this.apiToken = process.env.HETZNER_API_TOKEN || '';

    if (!this.apiToken) {
      this.logger.warn('HETZNER_API_TOKEN environment variable is not set. Hetzner provider will not function.');
    }
  }

  /**
   * Get the unique type identifier for this provider.
   * @returns 'hetzner'
   */
  getType(): string {
    return HetznerProvider.TYPE;
  }

  /**
   * Get the human-readable display name for this provider.
   * @returns 'Hetzner Cloud'
   */
  getDisplayName(): string {
    return 'Hetzner Cloud';
  }

  /**
   * Get available server types from Hetzner Cloud.
   * @returns Array of server types with specifications and pricing
   */
  async getServerTypes(): Promise<ServerType[]> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ server_types: HetznerServerType[] }>(
        `${HetznerProvider.API_BASE_URL}/server_types`,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        },
      );

      return response.data.server_types
        .filter((st) => !st.deprecated)
        .map((st) => ({
          id: st.name,
          name: st.description || st.name,
          cores: st.cores,
          memory: st.memory,
          disk: st.disk,
          priceMonthly: st.prices.find((p) => p.location === 'fsn1')?.price_monthly?.gross,
          priceHourly: st.prices.find((p) => p.location === 'fsn1')?.price_hourly?.gross,
          description: st.description,
        }));
    } catch (error) {
      this.logger.error(`Failed to fetch server types from Hetzner: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to fetch server types: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Provision a new server instance on Hetzner Cloud.
   * @param options - Provisioning options including server type, name, etc.
   * @returns Provisioned server information including ID, IP address, and endpoint
   */
  async provisionServer(options: ProvisionServerOptions): Promise<ProvisionedServer> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      // Generate user data script for Docker CE installation and agent-manager setup
      const userData = this.generateUserDataScript(options.userData || '');
      // Create server
      // Use Unix timestamp (seconds since epoch) for provisioned-at label
      const provisionedAt = Math.floor(Date.now() / 1000).toString();
      const createResponse = await axios.post<{ server: HetznerServer; action: HetznerAction }>(
        `${HetznerProvider.API_BASE_URL}/servers`,
        {
          name: options.name,
          server_type: options.serverType,
          image: options.image || 'ubuntu-22.04',
          location: options.location || 'fsn1',
          ssh_keys: options.sshKey ? [options.sshKey] : undefined,
          user_data: userData,
          networks: [],
          labels: {
            'managed-by': 'agent-controller',
            'provisioned-at': provisionedAt,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const server = createResponse.data.server;

      this.logger.log(`Created Hetzner server ${server.id} (${server.name})`);

      // Wait for server to be running
      await this.waitForServerReady(server.id);

      // Get server details to get IP address
      const serverInfo = await this.getServerInfo(server.id.toString());

      return {
        serverId: server.id.toString(),
        name: server.name,
        publicIp: serverInfo.publicIp,
        privateIp: serverInfo.privateIp,
        endpoint: `https://${serverInfo.publicIp}:3000`,
        status: serverInfo.status,
        metadata: {
          location: server.datacenter.location.name,
          datacenter: server.datacenter.name,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to provision Hetzner server: ${axiosError.message}`);

      if (axiosError.response?.data) {
        const errorData = axiosError.response.data as { error?: { message?: string } };

        throw new BadRequestException(`Failed to provision server: ${errorData.error?.message || axiosError.message}`);
      }

      throw new BadRequestException(`Failed to provision server: ${axiosError.message}`);
    }
  }

  /**
   * Delete a provisioned server instance.
   * @param serverId - The Hetzner server ID
   */
  async deleteServer(serverId: string): Promise<void> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      await axios.delete(`${HetznerProvider.API_BASE_URL}/servers/${serverId}`, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });
      this.logger.log(`Deleted Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to delete Hetzner server ${serverId}: ${axiosError.message}`);

      if (axiosError.response?.status === 404) {
        // Server already deleted or doesn't exist - treat as success
        this.logger.warn(`Server ${serverId} not found, assuming already deleted`);

        return;
      }

      throw new BadRequestException(`Failed to delete server: ${axiosError.message}`);
    }
  }

  /**
   * Get server status and information.
   * @param serverId - The Hetzner server ID
   * @returns Server information including status, IP address, etc.
   */
  async getServerInfo(serverId: string): Promise<ServerInfo> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ server: HetznerServer }>(
        `${HetznerProvider.API_BASE_URL}/servers/${serverId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        },
      );
      const server = response.data.server;
      const publicIp = server.public_net.ipv4?.ip || '';
      const privateIp = server.private_net[0]?.ip || undefined;

      return {
        serverId: server.id.toString(),
        name: server.name,
        publicIp,
        privateIp,
        status: server.status,
        metadata: {
          location: server.datacenter.location.name,
          datacenter: server.datacenter.name,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to get Hetzner server info ${serverId}: ${axiosError.message}`);

      if (axiosError.response?.status === 404) {
        throw new BadRequestException(`Server ${serverId} not found`);
      }

      throw new BadRequestException(`Failed to get server info: ${axiosError.message}`);
    }
  }

  /**
   * Wait for server to be in running state.
   * @param serverId - The Hetzner server ID
   * @param maxWaitTime - Maximum time to wait in milliseconds (default: 5 minutes)
   */
  private async waitForServerReady(serverId: number, maxWaitTime = 300000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 5000; // Check every 5 seconds

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const info = await this.getServerInfo(serverId.toString());

        if (info.status === 'running') {
          // Additional wait for SSH to be ready
          await new Promise((resolve) => setTimeout(resolve, 10000));

          return;
        }

        this.logger.debug(`Server ${serverId} status: ${info.status}, waiting...`);
      } catch (error) {
        this.logger.warn(`Error checking server status: ${(error as Error).message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new BadRequestException(`Server ${serverId} did not become ready within ${maxWaitTime}ms`);
  }

  /**
   * Generate cloud-init compatible user-data script for server initialization.
   * Installs Docker CE and starts agent-manager container.
   *
   * The script is cloud-init compatible:
   * - Starts with #!/bin/bash (recognized by cloud-init)
   * - Executed by cloud-init during instance initialization
   * - Includes network connectivity checks
   * - Proper error handling and logging
   *
   * @param additionalUserData - Additional user data to append (base64 encoded or plain text)
   * @returns Base64-encoded user data script (Hetzner Cloud API requirement)
   * @throws BadRequestException if the total user data exceeds 32KiB limit (Hetzner Cloud requirement)
   */
  private generateUserDataScript(additionalUserData: string): string {
    // Decode additional user data if it's base64, otherwise use as-is
    let decodedAdditionalUserData = '';

    if (additionalUserData && additionalUserData.trim()) {
      try {
        decodedAdditionalUserData = Buffer.from(additionalUserData, 'base64').toString('utf-8');
      } catch {
        // If decoding fails, assume it's already plain text
        decodedAdditionalUserData = additionalUserData;
      }
    }

    const hasAdditionalUserData = Boolean(decodedAdditionalUserData && decodedAdditionalUserData.trim());

    if (!hasAdditionalUserData) {
      throw new BadRequestException(
        'Provisioning user data is missing. Please provision servers through the provisioning service to supply configuration.',
      );
    }

    // Cloud-init compatible user-data script
    // Cloud-init recognizes scripts starting with #!/bin/bash or #!/bin/sh
    // The script will be executed by cloud-init during instance initialization
    const script = `#!/bin/bash
set -euo pipefail

# Cloud-init user-data script for agent-manager provisioning
# This script is executed by cloud-init during server initialization

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/agent-manager-provisioning.log
}

log "Starting server provisioning script (cloud-init user-data)"

# Ensure network is ready (cloud-init should have this ready, but we verify)
log "Verifying network connectivity..."
for i in {1..10}; do
    if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
        log "Network is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        log "WARNING: Network connectivity check failed, continuing anyway"
    fi
    sleep 1
done

# Update system
export DEBIAN_FRONTEND=noninteractive
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# Install openssl for SSL certificate generation
log "Installing openssl..."
apt-get install -y openssl

# Install Docker using the convenience script
# Official method: https://docs.docker.com/engine/install/ubuntu/#install-using-the-convenience-script
log "Installing prerequisites for Docker installation..."
apt-get update -qq
apt-get install -y ca-certificates curl

log "Installing Docker using convenience script..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh ./get-docker.sh
rm -f get-docker.sh

# Start and enable Docker service
log "Starting Docker service..."
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready and verify it's working
log "Waiting for Docker to be ready..."
for i in {1..30}; do
    if docker info > /dev/null 2>&1; then
        log "Docker is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        log "ERROR: Docker failed to start after 30 attempts"
        exit 1
    fi
    sleep 2
done

# Verify Docker is working
if ! docker info > /dev/null 2>&1; then
    log "ERROR: Docker is not working properly"
    exit 1
fi

# Pull agent-manager image
log "Pulling agent-manager image..."
docker pull ghcr.io/forepath/agenstra-manager-api:latest || {
    log "WARNING: Failed to pull agent-manager image, will try again later"
}

# Create directory for agent-manager
log "Creating agent-manager directory..."
mkdir -p /opt/agent-manager

# Additional user data if provided (for authentication configuration, etc.)
${
  decodedAdditionalUserData
    ? `log "Applying provisioning service configuration..."
${decodedAdditionalUserData}`
    : ''
}

# Ensure docker-compose.yml exists
if [ ! -f /opt/agent-manager/docker-compose.yml ]; then
    log "ERROR: docker-compose.yml was not created"
    exit 1
fi

# Start agent-manager container
log "Starting agent-manager container..."
cd /opt/agent-manager
docker compose up -d || {
    log "ERROR: Failed to start agent-manager container"
    docker compose logs || true
    exit 1
}

# Wait a moment for container to start
sleep 3

# Wait for postgres to be healthy before checking agent-manager
log "Waiting for postgres to be healthy..."
sleep 5

# Verify containers are running
if docker ps | grep -q agent-manager-postgres && docker ps | grep -q agent-manager-api && docker ps | grep -q agent-manager-nginx; then
    log "SUCCESS: All containers are running"
    docker ps | grep -E "(agent-manager-postgres|agent-manager-api|agent-manager-nginx)"
else
    log "ERROR: One or more containers are not running"
    docker compose ps || true
    docker compose logs || true
    exit 1
fi

log "agent-manager provisioning completed successfully at $(date)"
`;
    // Check size limit: Hetzner Cloud user_data is limited to 32KiB (32,768 bytes)
    // Note: The limit applies to the raw script content, not the base64-encoded version
    const scriptSize = Buffer.byteLength(script, 'utf8');
    const MAX_USER_DATA_SIZE = 32 * 1024; // 32KiB

    if (scriptSize > MAX_USER_DATA_SIZE) {
      const sizeKB = (scriptSize / 1024).toFixed(2);
      const maxKB = (MAX_USER_DATA_SIZE / 1024).toFixed(2);

      throw new BadRequestException(
        `User data script size (${sizeKB}KB) exceeds Hetzner Cloud limit of ${maxKB}KB. Please reduce the configuration size.`,
      );
    }

    // Hetzner Cloud API expects base64-encoded user_data
    return Buffer.from(script).toString('base64');
  }
}

/**
 * Hetzner Cloud API response types
 */
interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  prices: Array<{
    location: string;
    price_hourly?: { gross: number };
    price_monthly?: { gross: number };
  }>;
  storage_type: string;
  cpu_type: string;
  deprecated: boolean;
}

interface HetznerServer {
  id: number;
  name: string;
  status: string;
  public_net: {
    ipv4?: { ip: string };
    ipv6?: { ip: string };
  };
  private_net: Array<{ ip: string; network: number }>;
  datacenter: {
    id: number;
    name: string;
    location: {
      id: number;
      name: string;
      country: string;
      city: string;
      latitude: number;
      longitude: number;
    };
  };
  server_type: {
    id: number;
    name: string;
  };
}

interface HetznerAction {
  id: number;
  command: string;
  status: string;
  progress: number;
  started: string;
  finished?: string;
}
