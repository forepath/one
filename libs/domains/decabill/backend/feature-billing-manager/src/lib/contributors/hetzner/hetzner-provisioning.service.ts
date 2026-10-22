import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { resolveHetznerLocationNameFromMetadata } from '@forepath/shared/backend/util-provisioning-geography';

import { resolvePlainTextUserData } from '../../utils/cloud-init/user-data.utils';
import { ServerInfo } from '../../utils/provisioning.utils';
import { waitForTcpPort } from '../../utils/wait-for-tcp-port.util';

const HETZNER_STATUS_POLL_INTERVAL_MS = 3000;
/** Hetzner Cloud rejects `user_data` longer than 32 KiB ("Length must be between 0 and 32768"). */
const MAX_USER_DATA_LENGTH = 32 * 1024;
const HETZNER_POWEROFF_TIMEOUT_MS = 5 * 60 * 1000;
const HETZNER_RUNNING_TIMEOUT_MS = 5 * 60 * 1000;
/** Best-effort wait after resize; mid-life addons hard-wait again before SSH. */
const HETZNER_SSH_READY_TIMEOUT_MS = 90 * 1000;
const HETZNER_SSH_PORT = 22;

@Injectable()
export class HetznerProvisioningService {
  private readonly logger = new Logger(HetznerProvisioningService.name);
  private readonly apiToken: string;

  constructor() {
    this.apiToken = process.env.HETZNER_API_TOKEN || '';

    if (!this.apiToken) {
      this.logger.warn('HETZNER_API_TOKEN environment variable is not set. Hetzner provisioning will not function.');
    }
  }

  private resolveApiToken(apiToken?: string): string {
    return apiToken?.trim() || this.apiToken;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatHetznerErrorMessage(axiosError: AxiosError, fallback: string): string {
    const data = axiosError.response?.data as HetznerErrorResponse | undefined;
    const code = data?.error?.code;
    const message = data?.error?.message;

    if (code && message) {
      return `${code}: ${message}`;
    }

    if (message) {
      return message;
    }

    return axiosError.message || fallback;
  }

  private logHetznerApiError(operation: string, serverId: string, error: unknown): void {
    const axiosError = error as AxiosError;
    const httpStatus = axiosError.response?.status;
    const detail = this.formatHetznerErrorMessage(axiosError, axiosError.message);

    this.logger.error(
      `Failed to ${operation} Hetzner server ${serverId}${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${detail}`,
    );
  }

  private async fetchHetznerServerStatus(serverId: string, token: string): Promise<string> {
    const response = await axios.get<{ server: HetznerServerResponse }>(
      `https://api.hetzner.cloud/v1/servers/${serverId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const server = response.data?.server;

    if (!server) {
      throw new BadRequestException('Invalid response from Hetzner API');
    }

    return server.status;
  }

  private async waitForServerStatus(
    serverId: string,
    token: string,
    targetStatus: string,
    options: { timeoutMs: number; operation: string },
  ): Promise<void> {
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.fetchHetznerServerStatus(serverId, token);

      if (status === targetStatus) {
        return;
      }

      await this.delay(HETZNER_STATUS_POLL_INTERVAL_MS);
    }

    const lastStatus = await this.fetchHetznerServerStatus(serverId, token);

    if (lastStatus === targetStatus) {
      return;
    }

    throw new BadRequestException(
      `Timed out waiting for Hetzner server ${serverId} to reach ${targetStatus} (last status: ${lastStatus})`,
    );
  }

  private async waitForServerRunningAfterTypeChange(serverId: string, token: string): Promise<void> {
    const deadline = Date.now() + HETZNER_RUNNING_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = await this.fetchHetznerServerStatus(serverId, token);

      if (status === 'running') {
        this.logger.log(`Hetzner server ${serverId} is running after type change`);

        return;
      }

      await this.delay(HETZNER_STATUS_POLL_INTERVAL_MS);
    }

    const status = await this.fetchHetznerServerStatus(serverId, token);

    if (status === 'running') {
      return;
    }

    if (status === 'off') {
      this.logger.log(`Hetzner server ${serverId} still off after type change; powering on`);
      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/poweron`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      await this.waitForServerStatus(serverId, token, 'running', {
        timeoutMs: HETZNER_RUNNING_TIMEOUT_MS,
        operation: 'start server after type change',
      });

      return;
    }

    throw new BadRequestException(
      `Timed out waiting for Hetzner server ${serverId} to reach running status (last status: ${status})`,
    );
  }

  async provisionServer(
    config: {
      name: string;
      serverType: string;
      location: string;
      firewallId?: number;
      userData: string;
    },
    apiToken?: string,
  ) {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    // Submitted as plain text: the limit applies to the submitted string, and base64 would add a third.
    const userData = resolvePlainTextUserData(config.userData);
    const userDataLength = Buffer.byteLength(userData, 'utf8');

    if (userDataLength > MAX_USER_DATA_LENGTH) {
      throw new BadRequestException(
        `User data size (${userDataLength} bytes) exceeds Hetzner Cloud limit of ${MAX_USER_DATA_LENGTH} bytes`,
      );
    }

    try {
      const response = await axios.post(
        'https://api.hetzner.cloud/v1/servers',
        {
          name: config.name,
          server_type: config.serverType,
          image: 'ubuntu-22.04',
          location: config.location,
          user_data: userData,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
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
          { headers: { Authorization: `Bearer ${token}` } },
        );
      }

      return { serverId: serverId.toString() };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to provision Hetzner server: ${axiosError.message}`);
      throw new BadRequestException(`Failed to provision server: ${axiosError.message}`);
    }
  }

  async deprovisionServer(serverId: string, apiToken?: string): Promise<void> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      this.logger.warn('HETZNER_API_TOKEN not set, skipping deprovisioning');

      return;
    }

    try {
      await axios.delete(`https://api.hetzner.cloud/v1/servers/${serverId}`, {
        headers: { Authorization: `Bearer ${token}` },
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
  async getServerInfo(serverId: string, apiToken?: string): Promise<ServerInfo> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ server: HetznerServerResponse }>(
        `https://api.hetzner.cloud/v1/servers/${serverId}`,
        { headers: { Authorization: `Bearer ${token}` } },
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
        metadata: hetznerServerGeographyMetadata(server),
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

  async startServer(serverId: string, apiToken?: string): Promise<void> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/poweron`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      this.logger.log(`Started Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to start Hetzner server ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to start server: ${axiosError.message}`);
    }
  }

  async stopServer(serverId: string, apiToken?: string): Promise<void> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/poweroff`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      this.logger.log(`Stopped Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to stop Hetzner server ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to stop server: ${axiosError.message}`);
    }
  }

  async restartServer(serverId: string, apiToken?: string): Promise<void> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/reboot`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      this.logger.log(`Restarted Hetzner server ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to restart Hetzner server ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to restart server: ${axiosError.message}`);
    }
  }

  /**
   * In-place server type change via Hetzner Cloud API.
   * @param upgradeDisk - Opt-in only. Mid-life changes keep the existing disk (`false`) so
   *   smaller types remain eligible later; growing the disk permanently blocks downgrades.
   */
  async changeServerType(
    serverId: string,
    serverType: string,
    options?: { upgradeDisk?: boolean; apiToken?: string },
  ): Promise<void> {
    const token = this.resolveApiToken(options?.apiToken);

    if (!token) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const currentStatus = await this.fetchHetznerServerStatus(serverId, token);

      if (currentStatus !== 'off') {
        this.logger.log(`Stopping Hetzner server ${serverId} before type change (status: ${currentStatus})`);
        await axios.post(
          `https://api.hetzner.cloud/v1/servers/${serverId}/actions/poweroff`,
          {},
          { headers: { Authorization: `Bearer ${token}` } },
        );
        await this.waitForServerStatus(serverId, token, 'off', {
          timeoutMs: HETZNER_POWEROFF_TIMEOUT_MS,
          operation: 'stop server for type change',
        });
      }

      const upgradeDisk = options?.upgradeDisk === true;

      await axios.post(
        `https://api.hetzner.cloud/v1/servers/${serverId}/actions/change_type`,
        {
          server_type: serverType,
          upgrade_disk: upgradeDisk,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      this.logger.log(`Changed Hetzner server ${serverId} type to ${serverType} (upgrade_disk=${upgradeDisk})`);

      await this.waitForServerRunningAfterTypeChange(serverId, token);
      await this.waitForSshAfterTypeChange(serverId, token);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logHetznerApiError('change type for', serverId, error);
      const axiosError = error as AxiosError;

      throw new BadRequestException(
        `Failed to change server type: ${this.formatHetznerErrorMessage(axiosError, axiosError.message)}`,
      );
    }
  }

  private async waitForSshAfterTypeChange(serverId: string, token: string): Promise<void> {
    const serverInfo = await this.getServerInfo(serverId, token);
    const publicIp = serverInfo.publicIp?.trim();

    if (!publicIp) {
      this.logger.warn(`Hetzner server ${serverId} has no public IP after type change; skipping SSH wait`);

      return;
    }

    try {
      await waitForTcpPort(publicIp, HETZNER_SSH_PORT, { timeoutMs: HETZNER_SSH_READY_TIMEOUT_MS });
      this.logger.log(`TCP ${publicIp}:${HETZNER_SSH_PORT} is reachable (SSH after type change on ${serverId})`);
    } catch {
      // Resize-only changes must not fail when sshd/firewall is slow; mid-life addons wait again before SSH.
      this.logger.warn(
        `SSH on ${publicIp}:${HETZNER_SSH_PORT} not reachable yet after type change on ${serverId}; continuing`,
      );
    }
  }
}

interface HetznerErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

interface HetznerLocationRef {
  name: string;
  city?: string;
}

/** Hetzner Cloud API server object (GET /servers/:id). Current payloads use top-level `location`. */
interface HetznerServerResponse {
  id: number;
  name: string;
  status: string;
  public_net?: {
    ipv4?: { ip: string };
    ipv6?: { ip: string };
  };
  private_net?: Array<{ ip: string; network: number }>;
  location?: HetznerLocationRef;
  datacenter?: {
    name: string;
    location?: HetznerLocationRef;
  };
}

function hetznerServerGeographyMetadata(server: HetznerServerResponse): Record<string, string> {
  const location = server.location ?? server.datacenter?.location;
  const locationSlug = location?.name?.trim();
  const locationName = resolveHetznerLocationNameFromMetadata(locationSlug, location?.city);
  const datacenter = server.datacenter?.name?.trim();
  const metadata: Record<string, string> = {};

  if (locationSlug) {
    metadata.location = locationSlug;
  }

  if (locationName) {
    metadata.locationName = locationName;
  }

  if (datacenter) {
    metadata.datacenter = datacenter;
  }

  return metadata;
}
