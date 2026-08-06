import type { BillingProviderModule } from './provider-module-registry.service';

/** Built-in stubs: no cloud metrics in this release; return empty samples. */
export function createBuiltinProviderModules(): BillingProviderModule[] {
  return [
    {
      id: 'hetzner',
      async collectMeters() {
        return [];
      },
    },
    {
      id: 'digital-ocean',
      async collectMeters() {
        return [];
      },
    },
  ];
}
