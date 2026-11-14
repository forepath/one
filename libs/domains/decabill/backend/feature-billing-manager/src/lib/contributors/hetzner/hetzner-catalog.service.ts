import {
  buildProviderLocationCatalog,
  fetchHetznerLocations,
  getOrSetProviderLocationsCatalog,
} from '@forepath/shared/backend/util-provisioning-geography';
import { readRedisConnectionConfig } from '@forepath/shared/backend/util-queue';
import { RedisCacheService } from '@forepath/shared/backend/util-redis-cache';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { ProviderLocationDto } from '../../dto/provider-location.dto';
import { ServerTypeDto } from '../../dto/server-type.dto';
import { resolveProviderApiToken } from '../../utils/provider-env-defaults.utils';

import { HETZNER_PROVIDER_ID } from './hetzner-provider.constants';

const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1';

function parseProviderPrice(value: number | string | null | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
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

@Injectable()
export class HetznerCatalogService {
  private readonly logger = new Logger(HetznerCatalogService.name);

  constructor(private readonly redisCache: RedisCacheService) {}

  async getLocations(providerDefaults?: Record<string, string>): Promise<ProviderLocationDto[]> {
    const apiToken = resolveProviderApiToken(HETZNER_PROVIDER_ID, providerDefaults);

    if (!apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    const keyPrefix = readRedisConnectionConfig().keyPrefix;

    return getOrSetProviderLocationsCatalog(
      this.redisCache,
      { keyPrefix, providerId: HETZNER_PROVIDER_ID, apiToken },
      async () => {
        try {
          const apiLocations = await fetchHetznerLocations(apiToken);

          return buildProviderLocationCatalog(HETZNER_PROVIDER_ID, apiLocations);
        } catch (error) {
          const axiosError = error as AxiosError;

          this.logger.warn(
            `Failed to fetch Hetzner locations from API, using static fallback catalog: ${axiosError.message}`,
          );

          return buildProviderLocationCatalog(HETZNER_PROVIDER_ID, null);
        }
      },
    );
  }

  async getServerTypes(providerDefaults?: Record<string, string>): Promise<ServerTypeDto[]> {
    const apiToken = resolveProviderApiToken(HETZNER_PROVIDER_ID, providerDefaults);

    if (!apiToken) {
      throw new BadRequestException('HETZNER_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ server_types: HetznerServerType[] }>(`${HETZNER_API_BASE}/server_types`, {
        headers: { Authorization: `Bearer ${apiToken}` },
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
            priceMonthly: parseProviderPrice(priceFsn1?.price_monthly?.gross),
            priceHourly: parseProviderPrice(priceFsn1?.price_hourly?.gross),
            description: st.description,
          };
        });
    } catch (error) {
      const axiosError = error as AxiosError;

      throw new BadRequestException(`Failed to fetch server types: ${axiosError.message}`);
    }
  }
}
