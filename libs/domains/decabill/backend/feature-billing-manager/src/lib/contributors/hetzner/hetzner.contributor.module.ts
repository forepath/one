import { RedisCacheModule } from '@forepath/shared/backend/util-redis-cache';
import { Module, type OnModuleInit } from '@nestjs/common';

import { ProviderModuleRegistryService } from '../../services/provider-module-registry.service';
import { ProviderRegistryService } from '../../services/provider-registry.service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';

import { HetznerAvailabilityService } from './hetzner-availability.service';
import { HetznerCatalogService } from './hetzner-catalog.service';
import { HETZNER_PROVIDER_ID, HETZNER_PROVIDER_METADATA } from './hetzner-provider.constants';
import { HetznerProvisioningService } from './hetzner-provisioning.service';

export { HETZNER_PROVIDER_ID };

@Module({
  imports: [RedisCacheModule],
  providers: [HetznerProvisioningService, HetznerCatalogService, HetznerAvailabilityService],
})
export class HetznerContributorModule implements OnModuleInit {
  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly providerModuleRegistry: ProviderModuleRegistryService,
    private readonly provisioningService: HetznerProvisioningService,
    private readonly catalogService: HetznerCatalogService,
    private readonly availabilityService: HetznerAvailabilityService,
  ) {}

  onModuleInit(): void {
    this.providerRegistry.register(HETZNER_PROVIDER_METADATA);

    this.providerModuleRegistry.register({
      id: HETZNER_PROVIDER_ID,
      collectMeters: async () => [],
      provision: (config, credentials) =>
        this.provisioningService.provisionServer(config as never, credentials?.apiToken),
      deprovision: (serverId, credentials) =>
        this.provisioningService.deprovisionServer(serverId, credentials?.apiToken),
      getServerInfo: (serverId, credentials) => this.provisioningService.getServerInfo(serverId, credentials?.apiToken),
      startServer: (serverId, credentials) => this.provisioningService.startServer(serverId, credentials?.apiToken),
      stopServer: (serverId, credentials) => this.provisioningService.stopServer(serverId, credentials?.apiToken),
      restartServer: (serverId, credentials) => this.provisioningService.restartServer(serverId, credentials?.apiToken),
      changeServerType: (serverId, serverType, options) =>
        this.provisioningService.changeServerType(serverId, serverType, {
          upgradeDisk: false,
          apiToken: options?.credentials?.apiToken,
        }),
      getLocations: (providerDefaults) => this.catalogService.getLocations(providerDefaults),
      getServerTypes: (providerDefaults) => this.catalogService.getServerTypes(providerDefaults),
      checkAvailability: (params) => this.availabilityService.checkAvailability(params),
    });
  }
}

export const HETZNER_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'provider',
  sourceKey: HETZNER_PROVIDER_ID,
  nestModule: HetznerContributorModule,
};
