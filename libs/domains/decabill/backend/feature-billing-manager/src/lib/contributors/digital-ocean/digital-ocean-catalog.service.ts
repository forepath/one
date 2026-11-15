import {
  buildProviderLocationCatalog,
  fetchDigitalOceanRegions,
  getOrSetProviderLocationsCatalog,
} from '@forepath/shared/backend/util-provisioning-geography';
import { readRedisConnectionConfig } from '@forepath/shared/backend/util-queue';
import { RedisCacheService } from '@forepath/shared/backend/util-redis-cache';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { ProviderLocationDto } from '../../dto/provider-location.dto';
import { ServerTypeDto } from '../../dto/server-type.dto';
import { resolveProviderApiToken } from '../../utils/provider-env-defaults.utils';

import { DIGITAL_OCEAN_PROVIDER_ID } from './digital-ocean-provider.constants';

const DIGITALOCEAN_API_BASE = 'https://api.digitalocean.com/v2';

function parseProviderPrice(value: number | string | null | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

interface DigitalOceanSize {
  slug: string;
  memory: number;
  vcpus: number;
  disk: number;
  price_monthly: number;
  price_hourly: number;
  available: boolean;
  description?: string;
  deprecated?: boolean;
}

@Injectable()
export class DigitalOceanCatalogService {
  private readonly logger = new Logger(DigitalOceanCatalogService.name);

  constructor(private readonly redisCache: RedisCacheService) {}

  async getLocations(providerDefaults?: Record<string, string>): Promise<ProviderLocationDto[]> {
    const apiToken = resolveProviderApiToken(DIGITAL_OCEAN_PROVIDER_ID, providerDefaults);

    if (!apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    const keyPrefix = readRedisConnectionConfig().keyPrefix;

    return getOrSetProviderLocationsCatalog(
      this.redisCache,
      { keyPrefix, providerId: DIGITAL_OCEAN_PROVIDER_ID, apiToken },
      async () => {
        try {
          const apiLocations = await fetchDigitalOceanRegions(apiToken);

          return buildProviderLocationCatalog(DIGITAL_OCEAN_PROVIDER_ID, apiLocations);
        } catch (error) {
          const axiosError = error as AxiosError;

          this.logger.warn(
            `Failed to fetch DigitalOcean regions from API, using static fallback catalog: ${axiosError.message}`,
          );

          return buildProviderLocationCatalog(DIGITAL_OCEAN_PROVIDER_ID, null);
        }
      },
    );
  }

  async getServerTypes(providerDefaults?: Record<string, string>): Promise<ServerTypeDto[]> {
    const apiToken = resolveProviderApiToken(DIGITAL_OCEAN_PROVIDER_ID, providerDefaults);

    if (!apiToken) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ sizes: DigitalOceanSize[] }>(`${DIGITALOCEAN_API_BASE}/sizes`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      const sizes = response.data.sizes ?? [];

      return sizes
        .filter((size) => size.available && !size.deprecated)
        .map((size) => ({
          id: size.slug,
          name: size.slug.toUpperCase(),
          cores: size.vcpus,
          memory: size.memory / 1024,
          disk: size.disk,
          priceMonthly: parseProviderPrice(size.price_monthly),
          priceHourly: parseProviderPrice(size.price_hourly),
          description: size.description || size.slug,
        }));
    } catch (error) {
      const axiosError = error as AxiosError;

      throw new BadRequestException(`Failed to fetch server types: ${axiosError.message}`);
    }
  }
}
