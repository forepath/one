import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { ServerInfo } from '../utils/provisioning.utils';

/** DigitalOcean caps user_data at 64KiB (plain text UTF-8). */
const MAX_USER_DATA_BYTES = 64 * 1024;

@Injectable()
export class DigitaloceanProvisioningService {
  private readonly logger = new Logger(DigitaloceanProvisioningService.name);
  private readonly apiToken: string;

  constructor() {
    this.apiToken = process.env.DIGITALOCEAN_API_TOKEN || '';

    if (!this.apiToken) {
      this.logger.warn(
        'DIGITALOCEAN_API_TOKEN environment variable is not set. DigitalOcean provisioning will not function.',
      );
    }
  }

  /**
   * DigitalOcean's API expects plain-text cloud-init user_data.
   * Billing passes the same string as Hetzner; cloud-init builders base64-encode the script for Hetzner's API.
   */
  private resolvePlainTextUserData(userData: string): string {
    const trimmed = userData?.trim() ?? '';

    if (!trimmed) {
      return userData ?? '';
    }

    if (trimmed.startsWith('#!/bin/bash') || trimmed.startsWith('#!/bin/sh') || trimmed.startsWith('#cloud-config')) {
      return userData;
    }

    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');

    if (decoded.startsWith('#!/bin/bash') || decoded.startsWith('#!/bin/sh') || decoded.startsWith('#cloud-config')) {
      return decoded;
    }

    return userData;
  }

  async provisionServer(config: { name: string; serverType: string; location: string; userData: string }) {
    if (!this.apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    const userDataPlain = this.resolvePlainTextUserData(config.userData);
    const userDataBytes = Buffer.byteLength(userDataPlain, 'utf8');

    if (userDataBytes > MAX_USER_DATA_BYTES) {
      throw new BadRequestException(
        `User data size (${userDataBytes} bytes) exceeds DigitalOcean limit of ${MAX_USER_DATA_BYTES} bytes`,
      );
    }

    try {
      const response = await axios.post<{ droplet: DigitalOceanDroplet }>(
        'https://api.digitalocean.com/v2/droplets',
        {
          name: config.name,
          region: config.location,
          size: config.serverType,
          image: 'ubuntu-22-04-x64',
          user_data: userDataPlain,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const serverId = response.data?.droplet?.id;

      if (!serverId) {
        throw new BadRequestException('Failed to provision server');
      }

      return { serverId: serverId.toString() };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to provision DigitalOcean droplet: ${axiosError.message}`);
      throw new BadRequestException(`Failed to provision server: ${axiosError.message}`);
    }
  }

  async deprovisionServer(serverId: string): Promise<void> {
    if (!this.apiToken) {
      this.logger.warn('DIGITALOCEAN_API_TOKEN not set, skipping deprovisioning');

      return;
    }

    try {
      await axios.delete(`https://api.digitalocean.com/v2/droplets/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      this.logger.log(`Successfully deprovisioned DigitalOcean droplet ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to deprovision DigitalOcean droplet ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to deprovision server: ${axiosError.message}`);
    }
  }

  async getServerInfo(serverId: string): Promise<ServerInfo> {
    if (!this.apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ droplet: DigitalOceanDroplet }>(
        `https://api.digitalocean.com/v2/droplets/${serverId}`,
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      const droplet = response.data?.droplet;

      if (!droplet) {
        throw new BadRequestException('Invalid response from DigitalOcean API');
      }

      const publicIp = droplet.networks?.v4?.find((net) => net.type === 'public')?.ip_address ?? '';
      const privateIp = droplet.networks?.v4?.find((net) => net.type === 'private')?.ip_address;

      return {
        serverId: droplet.id.toString(),
        name: droplet.name,
        publicIp,
        privateIp,
        status: droplet.status,
        metadata: {
          region: droplet.region?.slug,
          regionName: droplet.region?.name,
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

  async startServer(serverId: string): Promise<void> {
    await this.executePowerAction(serverId, 'power_on', 'started');
  }

  async stopServer(serverId: string): Promise<void> {
    await this.executePowerAction(serverId, 'power_off', 'stopped');
  }

  async restartServer(serverId: string): Promise<void> {
    await this.executePowerAction(serverId, 'reboot', 'restarted');
  }

  private async executePowerAction(
    serverId: string,
    actionType: 'power_on' | 'power_off' | 'reboot',
    actionLabel: 'started' | 'stopped' | 'restarted',
  ): Promise<void> {
    if (!this.apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.digitalocean.com/v2/droplets/${serverId}/actions`,
        { type: actionType },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`${actionLabel} DigitalOcean droplet ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to ${actionLabel} DigitalOcean droplet ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to ${actionLabel.replace('ed', '')} server: ${axiosError.message}`);
    }
  }
}

interface DigitalOceanDroplet {
  id: number;
  name: string;
  status: string;
  region?: {
    name: string;
    slug: string;
  };
  networks?: {
    v4?: Array<{
      ip_address: string;
      type: 'public' | 'private';
    }>;
  };
}
