import { RedisCacheModule } from '@forepath/shared/backend/util-redis-cache';
import { Module, type OnModuleInit } from '@nestjs/common';

import { ProviderModuleRegistryService } from '../../services/provider-module-registry.service';
import { ProviderRegistryService } from '../../services/provider-registry.service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';

import { DigitalOceanCatalogService } from './digital-ocean-catalog.service';
import { DIGITAL_OCEAN_PROVIDER_ID, DIGITAL_OCEAN_PROVIDER_METADATA } from './digital-ocean-provider.constants';
import { DigitaloceanProvisioningService } from './digitalocean-provisioning.service';

export { DIGITAL_OCEAN_PROVIDER_ID };

@Module({
  imports: [RedisCacheModule],
  providers: [DigitaloceanProvisioningService, DigitalOceanCatalogService],
})
export class DigitalOceanContributorModule implements OnModuleInit {
  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly providerModuleRegistry: ProviderModuleRegistryService,
    private readonly provisioningService: DigitaloceanProvisioningService,
    private readonly catalogService: DigitalOceanCatalogService,
  ) {}

  onModuleInit(): void {
    this.providerRegistry.register(DIGITAL_OCEAN_PROVIDER_METADATA);

    this.providerModuleRegistry.register({
      id: DIGITAL_OCEAN_PROVIDER_ID,
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
          resizeDisk: false,
          apiToken: options?.credentials?.apiToken,
          sshPrivateKey: options?.sshPrivateKey,
        }),
      getLocations: (providerDefaults) => this.catalogService.getLocations(providerDefaults),
      getServerTypes: (providerDefaults) => this.catalogService.getServerTypes(providerDefaults),
    });
  }
}

export const DIGITAL_OCEAN_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'provider',
  sourceKey: DIGITAL_OCEAN_PROVIDER_ID,
  nestModule: DigitalOceanContributorModule,
};
