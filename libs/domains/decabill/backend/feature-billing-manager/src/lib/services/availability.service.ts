import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { AvailabilitySnapshotsRepository } from '../repositories/availability-snapshots.repository';

export interface AvailabilityResult {
  isAvailable: boolean;
  reason?: string;
  alternatives?: Record<string, unknown>;
}

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(private readonly snapshotsRepository: AvailabilitySnapshotsRepository) {}

  async checkAvailability(provider: string, region: string, serverType: string): Promise<AvailabilityResult> {
    if (provider !== 'hetzner') {
      await this.snapshotsRepository.create({
        provider,
        region,
        serverType,
        isAvailable: true,
        rawResponse: {},
      });

      return { isAvailable: true };
    }

    const { isAvailable, reason, alternatives, rawResponse } = await this.checkHetznerAvailability(region, serverType);

    await this.snapshotsRepository.create({
      provider,
      region,
      serverType,
      isAvailable,
      rawResponse,
    });

    return { isAvailable, reason, alternatives };
  }

  private async checkHetznerAvailability(region: string, serverType: string) {
    const apiToken = process.env.HETZNER_API_TOKEN;

    if (!apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ server_types: HetznerServerType[] }>(
        'https://api.hetzner.cloud/v1/server_types',
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );
      let limitsData: HetznerLimitsResponse | null = null;

      try {
        const limitsResponse = await axios.get<HetznerLimitsResponse>('https://api.hetzner.cloud/v1/limits', {
          headers: { Authorization: `Bearer ${apiToken}` },
        });

        limitsData = limitsResponse.data;
      } catch (error) {
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 404) {
          this.logger.warn(
            'Hetzner /limits endpoint returned 404. Skipping account limit checks but continuing availability evaluation.',
          );
        } else {
          throw error;
        }
      }

      const serverTypes = response.data.server_types || [];
      const target = serverTypes.find((item) => item.name === serverType);
      const regionPrices = (type: HetznerServerType) => type.prices.some((price) => price.location === region);

      if (!target) {
        return {
          isAvailable: false,
          reason: 'Server type not found',
          alternatives: { availableTypes: serverTypes.filter(regionPrices).map((item) => item.name) },
          rawResponse: { serverTypes: response.data, limits: limitsData },
        };
      }

      if (target.deprecated) {
        return {
          isAvailable: false,
          reason: 'Server type deprecated',
          alternatives: { availableTypes: serverTypes.filter(regionPrices).map((item) => item.name) },
          rawResponse: { serverTypes: response.data, limits: limitsData },
        };
      }

      if (!regionPrices(target)) {
        return {
          isAvailable: false,
          reason: 'Server type not available in region',
          alternatives: { availableTypes: serverTypes.filter(regionPrices).map((item) => item.name) },
          rawResponse: { serverTypes: response.data, limits: limitsData },
        };
      }

      if (limitsData?.limits != null && limitsData.limits.max_servers !== null) {
        const maxServers = limitsData.limits.max_servers;
        const currentServers = limitsData.limits.server_count ?? 0;

        if (maxServers !== undefined && currentServers >= maxServers) {
          return {
            isAvailable: false,
            reason: 'Provider account limit reached',
            alternatives: { availableTypes: serverTypes.filter(regionPrices).map((item) => item.name) },
            rawResponse: { serverTypes: response.data, limits: limitsData },
          };
        }
      }

      return {
        isAvailable: true,
        rawResponse: { serverTypes: response.data, limits: limitsData },
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      throw new BadRequestException(`Failed to check availability: ${axiosError.message}`);
    }
  }
}

interface HetznerServerType {
  id: number;
  name: string;
  deprecated: boolean;
  prices: Array<{ location: string }>;
}

interface HetznerLimitsResponse {
  limits: {
    max_servers: number | null;
    server_count?: number;
  };
}
