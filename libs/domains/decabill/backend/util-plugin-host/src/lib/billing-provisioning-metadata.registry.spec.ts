import { BillingProvisioningMetadataRegistry } from './billing-provisioning-metadata.registry';

describe('BillingProvisioningMetadataRegistry', () => {
  it('aggregates manifest metadata including configSchema', () => {
    const registry = new BillingProvisioningMetadataRegistry();

    registry.registerFromManifest({
      id: 'hetzner',
      kind: 'billing-provisioning-provider',
      name: 'Hetzner Cloud',
      description: 'Hetzner provisioning',
      version: '0.0.0',
      configSchema: { required: ['location'] },
    });

    expect(registry.getProviders()).toEqual([
      {
        id: 'hetzner',
        displayName: 'Hetzner Cloud',
        configSchema: { required: ['location'] },
      },
    ]);
    expect(registry.hasProvider('hetzner')).toBe(true);
  });
});
