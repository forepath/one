import { Injectable } from '@nestjs/common';

import type { ForepathExtensionManifest } from '@forepath/shared/backend/util-extension-core';

import type { BillingProvisioningProviderDetail } from './contracts/billing-provisioning-provider.interface';

@Injectable()
export class BillingProvisioningMetadataRegistry {
  private readonly providers = new Map<string, BillingProvisioningProviderDetail>();

  registerFromManifest(manifest: ForepathExtensionManifest): void {
    const configSchema =
      manifest.configSchema && typeof manifest.configSchema === 'object'
        ? (manifest.configSchema as Record<string, unknown>)
        : undefined;

    this.providers.set(manifest.id, {
      id: manifest.id,
      displayName: manifest.name,
      configSchema,
    });
  }

  getProviders(): BillingProvisioningProviderDetail[] {
    return Array.from(this.providers.values());
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }
}
