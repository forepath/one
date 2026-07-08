import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import {
  buildProviderLocationCatalog,
  fetchDigitalOceanRegions,
  fetchHetznerLocations,
  getOrSetProviderLocationsCatalog,
} from '@forepath/shared/backend/util-provisioning-geography';
import { readRedisConnectionConfig } from '@forepath/shared/backend/util-queue';
import { RedisCacheService } from '@forepath/shared/backend/util-redis-cache';

import { ProviderLocationDto } from '../dto/provider-location.dto';
import { resolveProviderApiToken } from '../utils/provider-env-defaults.utils';

/**
 * Fetches geography options (locations/regions) from provisioning providers.
 * Used by the billing console to show human-readable labels for schema enums.
 */
@Injectable()
export class ProviderLocationsService {
  private readonly logger = new Logger(ProviderLocationsService.name);

  constructor(private readonly redisCache: RedisCacheService) {}

  async getLocations(providerId: string, providerDefaults?: Record<string, string>): Promise<ProviderLocationDto[]> {
    if (providerId === 'hetzner') {
      return this.getHetznerLocations(providerDefaults);
    }

    if (providerId === 'digital-ocean') {
      return this.getDigitaloceanLocations(providerDefaults);
    }

    return [];
  }

  private async getHetznerLocations(providerDefaults?: Record<string, string>): Promise<ProviderLocationDto[]> {
    const apiToken = resolveProviderApiToken('hetzner', providerDefaults);

    if (!apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    const keyPrefix = readRedisConnectionConfig().keyPrefix;

    return getOrSetProviderLocationsCatalog(
      this.redisCache,
      { keyPrefix, providerId: 'hetzner', apiToken },
      async () => {
        try {
          const apiLocations = await fetchHetznerLocations(apiToken);

          return buildProviderLocationCatalog('hetzner', apiLocations);
        } catch (error) {
          const axiosError = error as AxiosError;

          this.logger.warn(
            `Failed to fetch Hetzner locations from API, using static fallback catalog: ${axiosError.message}`,
          );

          return buildProviderLocationCatalog('hetzner', null);
        }
      },
    );
  }

  private async getDigitaloceanLocations(providerDefaults?: Record<string, string>): Promise<ProviderLocationDto[]> {
    const apiToken = resolveProviderApiToken('digital-ocean', providerDefaults);

    if (!apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    const keyPrefix = readRedisConnectionConfig().keyPrefix;

    return getOrSetProviderLocationsCatalog(
      this.redisCache,
      { keyPrefix, providerId: 'digital-ocean', apiToken },
      async () => {
        try {
          const apiLocations = await fetchDigitalOceanRegions(apiToken);

          return buildProviderLocationCatalog('digital-ocean', apiLocations);
        } catch (error) {
          const axiosError = error as AxiosError;

          this.logger.warn(
            `Failed to fetch DigitalOcean regions from API, using static fallback catalog: ${axiosError.message}`,
          );

          return buildProviderLocationCatalog('digital-ocean', null);
        }
      },
    );
  }
}
