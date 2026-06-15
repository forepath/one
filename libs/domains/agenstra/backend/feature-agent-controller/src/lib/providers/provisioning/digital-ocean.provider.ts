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
 * DigitalOcean provider implementation.
 * Handles server provisioning, configuration, and deletion via DigitalOcean API.
 */
@Injectable()
export class DigitalOceanProvider implements ProvisioningProvider {
  private readonly logger = new Logger(DigitalOceanProvider.name);
  private static readonly TYPE = 'digital-ocean';
  private static readonly API_BASE_URL = 'https://api.digitalocean.com/v2';
  private readonly apiToken: string;

  constructor() {
    this.apiToken = process.env.DIGITALOCEAN_API_TOKEN || '';

    if (!this.apiToken) {
      this.logger.warn(
        'DIGITALOCEAN_API_TOKEN environment variable is not set. DigitalOcean provider will not function.',
      );
    }
  }

  /**
   * Get the unique type identifier for this provider.
   * @returns 'digital-ocean'
   */
  getType(): string {
    return DigitalOceanProvider.TYPE;
  }

  /**
   * Get the human-readable display name for this provider.
   * @returns 'DigitalOcean'
   */
  getDisplayName(): string {
    return 'DigitalOcean';
  }

  /**
   * Get available server types (sizes) from DigitalOcean.
   * @returns Array of server types with specifications and pricing
   */
  async getServerTypes(): Promise<ServerType[]> {
    if (!this.apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ sizes: DigitalOceanSize[] }>(`${DigitalOceanProvider.API_BASE_URL}/sizes`, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      return response.data.sizes
        .filter((size) => size.available && !size.deprecated)
        .map((size) => ({
          id: size.slug,
          name: size.slug.toUpperCase(),
          cores: size.vcpus,
          memory: size.memory / 1024, // Convert MB to GB
          disk: size.disk,
          priceMonthly: size.price_monthly,
          priceHourly: size.price_hourly,
          description: size.description || size.slug,
        }));
    } catch (error) {
      this.logger.error(`Failed to fetch server types from DigitalOcean: ${(error as AxiosError).message}`);
      throw new BadRequestException(`Failed to fetch server types: ${(error as AxiosError).message}`);
    }
  }

  /**
   * Provision a new server instance (droplet) on DigitalOcean.
   * @param options - Provisioning options including server type, name, etc.
   * @returns Provisioned server information including ID, IP address, and endpoint
   */
  async provisionServer(options: ProvisionServerOptions): Promise<ProvisionedServer> {
    if (!this.apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      // Generate user data script for Docker CE installation and agent-manager setup
      const userData = this.generateUserDataScript(options.userData || '');
      // Get SSH key ID if SSH key fingerprint/ID is provided
      let sshKeyIds: number[] | undefined;

      if (options.sshKey) {
        sshKeyIds = await this.getSshKeyIds(options.sshKey);
      }

      // Create droplet
      // Use Unix timestamp (seconds since epoch) for provisioned-at tag
      const provisionedAt = Math.floor(Date.now() / 1000).toString();
      const createResponse = await axios.post<{ droplet: DigitalOceanDroplet }>(
        `${DigitalOceanProvider.API_BASE_URL}/droplets`,
        {
          name: options.name,
          region: options.location || 'fra1',
          size: options.serverType,
          image: options.image || 'ubuntu-22-04-x64',
          ssh_keys: sshKeyIds,
          user_data: userData,
          tags: ['managed-by-agent-controller', `provisioned-at-${provisionedAt}`],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const droplet = createResponse.data.droplet;

      this.logger.log(`Created DigitalOcean droplet ${droplet.id} (${droplet.name})`);

      // Wait for droplet to be running
      await this.waitForServerReady(droplet.id.toString());

      // Get droplet details to get IP address
      const serverInfo = await this.getServerInfo(droplet.id.toString());

      return {
        serverId: droplet.id.toString(),
        name: droplet.name,
        publicIp: serverInfo.publicIp,
        privateIp: serverInfo.privateIp,
        endpoint: `https://${serverInfo.publicIp}:3000`,
        status: serverInfo.status,
        metadata: {
          region: droplet.region.slug,
          regionName: droplet.region.name,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to provision DigitalOcean droplet: ${axiosError.message}`);

      if (axiosError.response?.data) {
        const errorData = axiosError.response.data as { message?: string; id?: string };

        throw new BadRequestException(`Failed to provision server: ${errorData.message || axiosError.message}`);
      }

      throw new BadRequestException(`Failed to provision server: ${axiosError.message}`);
    }
  }

  /**
   * Delete a provisioned server instance (droplet).
   * @param serverId - The DigitalOcean droplet ID
   */
  async deleteServer(serverId: string): Promise<void> {
    if (!this.apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      await axios.delete(`${DigitalOceanProvider.API_BASE_URL}/droplets/${serverId}`, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });
      this.logger.log(`Deleted DigitalOcean droplet ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to delete DigitalOcean droplet ${serverId}: ${axiosError.message}`);

      if (axiosError.response?.status === 404) {
        // Droplet already deleted or doesn't exist - treat as success
        this.logger.warn(`Droplet ${serverId} not found, assuming already deleted`);

        return;
      }

      throw new BadRequestException(`Failed to delete server: ${axiosError.message}`);
    }
  }

  /**
   * Get server status and information.
   * @param serverId - The DigitalOcean droplet ID
   * @returns Server information including status, IP address, etc.
   */
  async getServerInfo(serverId: string): Promise<ServerInfo> {
    if (!this.apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ droplet: DigitalOceanDroplet }>(
        `${DigitalOceanProvider.API_BASE_URL}/droplets/${serverId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        },
      );
      const droplet = response.data.droplet;
      const publicIp = droplet.networks.v4.find((net) => net.type === 'public')?.ip_address || '';
      const privateIp = droplet.networks.v4.find((net) => net.type === 'private')?.ip_address || undefined;

      return {
        serverId: droplet.id.toString(),
        name: droplet.name,
        publicIp,
        privateIp,
        status: droplet.status,
        metadata: {
          region: droplet.region.slug,
          regionName: droplet.region.name,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to get DigitalOcean droplet info ${serverId}: ${axiosError.message}`);

      if (axiosError.response?.status === 404) {
        throw new BadRequestException(`Server ${serverId} not found`);
      }

      throw new BadRequestException(`Failed to get server info: ${axiosError.message}`);
    }
  }

  /**
   * Wait for droplet to be in active state.
   * @param serverId - The DigitalOcean droplet ID
   * @param maxWaitTime - Maximum time to wait in milliseconds (default: 5 minutes)
   */
  private async waitForServerReady(serverId: string, maxWaitTime = 300000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 5000; // Check every 5 seconds

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const info = await this.getServerInfo(serverId);

        if (info.status === 'active') {
          // Additional wait for SSH to be ready
          await new Promise((resolve) => setTimeout(resolve, 10000));

          return;
        }

        this.logger.debug(`Droplet ${serverId} status: ${info.status}, waiting...`);
      } catch (error) {
        this.logger.warn(`Error checking droplet status: ${(error as Error).message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new BadRequestException(`Server ${serverId} did not become ready within ${maxWaitTime}ms`);
  }

  /**
   * Get SSH key IDs from DigitalOcean API.
   * If the provided SSH key is a fingerprint or ID, look it up.
   * @param sshKey - SSH key fingerprint, ID, or public key
   * @returns Array of SSH key IDs
   */
  private async getSshKeyIds(sshKey: string): Promise<number[]> {
    try {
      // First, try to get all SSH keys and match by fingerprint or public key
      const response = await axios.get<{ ssh_keys: DigitalOceanSshKey[] }>(
        `${DigitalOceanProvider.API_BASE_URL}/account/keys`,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        },
      );
      // If it's a numeric ID, use it directly
      const numericId = parseInt(sshKey, 10);

      if (!isNaN(numericId)) {
        const keyExists = response.data.ssh_keys.some((key) => key.id === numericId);

        if (keyExists) {
          return [numericId];
        }
      }

      // Try to match by fingerprint
      const matchedKey = response.data.ssh_keys.find((key) => key.fingerprint === sshKey || key.public_key === sshKey);

      if (matchedKey) {
        return [matchedKey.id];
      }

      // If no match found, log warning and continue without SSH key
      this.logger.warn(`SSH key not found in DigitalOcean account: ${sshKey}`);

      return [];
    } catch (error) {
      this.logger.warn(`Failed to lookup SSH keys: ${(error as AxiosError).message}`);

      return [];
    }
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
   * @returns Plain text user data script (DigitalOcean accepts plain text or base64)
   * @throws BadRequestException if the total user data exceeds 64KiB limit (DigitalOcean requirement)
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

log "Agent-manager provisioning completed successfully at $(date)"
`;
    // Check size limit: DigitalOcean user_data is limited to 64KiB (65,536 bytes)
    // Note: The limit applies to the raw script content
    const scriptSize = Buffer.byteLength(script, 'utf8');
    const MAX_USER_DATA_SIZE = 64 * 1024; // 64KiB

    if (scriptSize > MAX_USER_DATA_SIZE) {
      const sizeKB = (scriptSize / 1024).toFixed(2);
      const maxKB = (MAX_USER_DATA_SIZE / 1024).toFixed(2);

      throw new BadRequestException(
        `User data script size (${sizeKB}KB) exceeds DigitalOcean limit of ${maxKB}KB. Please reduce the configuration size.`,
      );
    }

    // DigitalOcean API accepts plain text user_data (cloud-init compatible)
    return script;
  }
}

/**
 * DigitalOcean API response types
 */
interface DigitalOceanSize {
  slug: string;
  memory: number; // Memory in MB
  vcpus: number;
  disk: number; // Disk in GB
  transfer: number; // Transfer in TB
  price_monthly: number;
  price_hourly: number;
  regions: string[];
  available: boolean;
  description?: string;
  deprecated?: boolean;
}

interface DigitalOceanDroplet {
  id: number;
  name: string;
  memory: number;
  vcpus: number;
  disk: number;
  locked: boolean;
  status: string; // 'new', 'active', 'off', 'archive'
  kernel?: {
    id: number;
    name: string;
    version: string;
  };
  created_at: string;
  features: string[];
  backup_ids: number[];
  snapshot_ids: number[];
  image: {
    id: number;
    name: string;
    distribution: string;
    slug: string;
    public: boolean;
    regions: string[];
    created_at: string;
    min_disk_size: number;
    type: string;
    size_gigabytes: number;
  };
  size: {
    slug: string;
    memory: number;
    vcpus: number;
    disk: number;
    transfer: number;
    price_monthly: number;
    price_hourly: number;
    regions: string[];
    available: boolean;
  };
  size_slug: string;
  networks: {
    v4: Array<{
      ip_address: string;
      netmask: string;
      gateway: string;
      type: string; // 'public' or 'private'
    }>;
    v6: Array<{
      ip_address: string;
      netmask: number;
      gateway: string;
      type: string;
    }>;
  };
  region: {
    name: string;
    slug: string;
    sizes: string[];
    available: boolean;
    features: string[];
  };
  tags: string[];
  volume_ids: number[];
  vpc_uuid?: string;
}

interface DigitalOceanSshKey {
  id: number;
  fingerprint: string;
  public_key: string;
  name: string;
}
