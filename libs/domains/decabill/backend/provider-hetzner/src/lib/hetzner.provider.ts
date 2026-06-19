import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import type {
  BillingProvisioningProvider,
  BillingServerType,
  ServerInfo,
} from '@forepath/decabill/backend/util-plugin-host';

const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1';

@Injectable()
export class HetznerProvider implements BillingProvisioningProvider {
  private readonly logger = new Logger(HetznerProvider.name);
  private readonly apiToken: string;

  constructor() {
    this.apiToken = process.env.HETZNER_API_TOKEN || '';

    if (!this.apiToken) {
      this.logger.warn('HETZNER_API_TOKEN environment variable is not set. Hetzner provisioning will not function.');
    }
  }

  getType(): string {
    return 'hetzner';
  }

  getDisplayName(): string {
    return 'Hetzner Cloud';
  }

  async provision(config: Record<string, unknown>): Promise<unknown> {
    return await this.provisionServer(
      config as {
        name: string;
        serverType: string;
        location: string;
        firewallId?: number;
        userData: string;
      },
    );
  }

  async deprovision(serverId: string): Promise<void> {
    await this.deprovisionServer(serverId);
  }

  async getServerTypes(): Promise<BillingServerType[]> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ server_types: HetznerServerType[] }>(`${HETZNER_API_BASE}/server_types`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const serverTypes = response.data.server_types ?? [];

      return serverTypes
        .filter((st) => !st.deprecated)
        .map((st) => {
          const priceFsn1 = st.prices.find((p) => p.location === 'fsn1');

          return {
            id: st.name,
            name: st.description || st.name,
            cores: st.cores,
            memory: st.memory,
            disk: st.disk,
            priceMonthly: priceFsn1?.price_monthly?.gross,
            priceHourly: priceFsn1?.price_hourly?.gross,
            description: st.description,
          };
        });
    } catch (error) {
      const axiosError = error as AxiosError;

      throw new BadRequestException(`Failed to fetch server types: ${axiosError.message}`);
    }
  }

  private async provisionServer(config: {
    name: string;
    serverType: string;
    location: string;
    firewallId?: number;
    userData: string;
  }) {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.post(
        'https://api.hetzner.cloud/v1/servers',
        {
          name: config.name,
          server_type: config.serverType,
          image: 'ubuntu-22.04',
          location: config.location,
          user_data: config.userData,
        },
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        },
      );
      const serverId = response.data?.server?.id as number | undefined;

      if (!serverId) {
        throw new BadRequestException('Failed to provision server');
      }

      if (config.firewallId) {
        await axios.post(
          `https://api.hetzner.cloud/v1/firewalls/${config.firewallId}/actions/attach_to_server`,
          { server: serverId },
          { headers: { Authorization: `Bearer ${this.apiToken}` } },
        );
      }

      return { serverId: serverId.toString() };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to provision Hetzner server: ${axiosError.message}`);
      throw new BadRequestException(`Failed to provision server: ${axiosError.message}`);
    }
  }

  private async deprovisionServer(serverId: string): Promise<void> {
    if (!this.apiToken) {
      this.logger.warn('HETZNER_API_TOKEN not set, skipping deprovisioning');

      return;
    }

    try {
      await axios.delete(`https://api.hetzner.cloud/v1/servers/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      this.logger.log(`Successfully deprovisioned Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to deprovision Hetzner server ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to deprovision server: ${axiosError.message}`);
    }
  }

  /**
   * Fetches current server status and details from the Hetzner Cloud API.
   * @param serverId - The Hetzner server ID (from provider_reference)
   * @returns Provider-agnostic ServerInfo (reusable shape for other providers)
   */
  async getServerInfo(serverId: string): Promise<ServerInfo> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ server: HetznerServerResponse }>(
        `https://api.hetzner.cloud/v1/servers/${serverId}`,
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      const server = response.data?.server;

      if (!server) {
        throw new BadRequestException('Invalid response from Hetzner API');
      }

      const publicIp = server.public_net?.ipv4?.ip ?? '';
      const privateIp = server.private_net?.[0]?.ip;

      return {
        serverId: server.id.toString(),
        name: server.name,
        publicIp,
        privateIp,
        status: server.status,
        metadata: {
          location: server.datacenter?.location?.name,
          datacenter: server.datacenter?.name,
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

  async startServer(serverId: string): Promise<void> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/poweron`,
        {},
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      this.logger.log(`Started Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to start Hetzner server ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to start server: ${axiosError.message}`);
    }
  }

  async stopServer(serverId: string): Promise<void> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/poweroff`,
        {},
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      this.logger.log(`Stopped Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to stop Hetzner server ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to stop server: ${axiosError.message}`);
    }
  }

  async restartServer(serverId: string): Promise<void> {
    if (!this.apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/reboot`,
        {},
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      this.logger.log(`Restarted Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to restart Hetzner server ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to restart server: ${axiosError.message}`);
    }
  }
}

interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  deprecated: boolean;
  prices: Array<{
    location: string;
    price_hourly?: { gross: number };
    price_monthly?: { gross: number };
  }>;
}

/** Hetzner Cloud API server object (GET /servers/:id) */
interface HetznerServerResponse {
  id: number;
  name: string;
  status: string;
  public_net?: {
    ipv4?: { ip: string };
    ipv6?: { ip: string };
  };
  private_net?: Array<{ ip: string; network: number }>;
  datacenter?: {
    name: string;
    location?: { name: string };
  };
}
