import { Injectable, Logger } from '@nestjs/common';

import { ServerInfo } from '../utils/provisioning.utils';

import { DigitaloceanProvisioningService } from './digitalocean-provisioning.service';
import { HetznerProvisioningService } from './hetzner-provisioning.service';

const DIGITALOCEAN_PUBLIC_IP_POLL_INTERVAL_MS = 2000;
const DIGITALOCEAN_PUBLIC_IP_MAX_ATTEMPTS = 30;

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly hetznerProvisioningService: HetznerProvisioningService,
    private readonly digitaloceanProvisioningService: DigitaloceanProvisioningService,
  ) {}

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolves a public IPv4 for Cloudflare DNS after provision.
   * DigitalOcean often omits public v4 on the first droplet GET; poll until it appears or timeout.
   */
  async ensurePublicIpForDns(
    provider: string,
    serverId: string,
    initial: ServerInfo | null | undefined,
  ): Promise<string | undefined> {
    let info = initial ?? (await this.getServerInfo(provider, serverId));

    if (info?.publicIp) {
      return info.publicIp;
    }

    if (provider !== 'digital-ocean') {
      return undefined;
    }

    for (let attempt = 1; attempt < DIGITALOCEAN_PUBLIC_IP_MAX_ATTEMPTS; attempt++) {
      await this.delay(DIGITALOCEAN_PUBLIC_IP_POLL_INTERVAL_MS);
      info = await this.getServerInfo(provider, serverId);

      if (info?.publicIp) {
        return info.publicIp;
      }
    }

    this.logger.warn(
      `Timed out waiting for public IPv4 on DigitalOcean droplet ${serverId} after approximately ${
        DIGITALOCEAN_PUBLIC_IP_MAX_ATTEMPTS * DIGITALOCEAN_PUBLIC_IP_POLL_INTERVAL_MS
      }ms`,
    );

    return undefined;
  }

  async provision(provider: string, config: { [key: string]: unknown }) {
    if (provider === 'hetzner') {
      return await this.hetznerProvisioningService.provisionServer(config as never);
    }

    if (provider === 'digital-ocean') {
      return await this.digitaloceanProvisioningService.provisionServer(config as never);
    }

    return null;
  }

  async deprovision(provider: string, serverId: string): Promise<void> {
    if (provider === 'hetzner') {
      await this.hetznerProvisioningService.deprovisionServer(serverId);
    }

    if (provider === 'digital-ocean') {
      await this.digitaloceanProvisioningService.deprovisionServer(serverId);
    }
  }

  async getServerInfo(provider: string, serverId: string): Promise<ServerInfo | null> {
    if (provider === 'hetzner') {
      return await this.hetznerProvisioningService.getServerInfo(serverId);
    }

    if (provider === 'digital-ocean') {
      return await this.digitaloceanProvisioningService.getServerInfo(serverId);
    }

    return null;
  }

  async startServer(provider: string, serverId: string): Promise<void> {
    if (provider === 'hetzner') {
      await this.hetznerProvisioningService.startServer(serverId);
    }

    if (provider === 'digital-ocean') {
      await this.digitaloceanProvisioningService.startServer(serverId);
    }
  }

  async stopServer(provider: string, serverId: string): Promise<void> {
    if (provider === 'hetzner') {
      await this.hetznerProvisioningService.stopServer(serverId);
    }

    if (provider === 'digital-ocean') {
      await this.digitaloceanProvisioningService.stopServer(serverId);
    }
  }

  async restartServer(provider: string, serverId: string): Promise<void> {
    if (provider === 'hetzner') {
      await this.hetznerProvisioningService.restartServer(serverId);
    }

    if (provider === 'digital-ocean') {
      await this.digitaloceanProvisioningService.restartServer(serverId);
    }
  }
}
