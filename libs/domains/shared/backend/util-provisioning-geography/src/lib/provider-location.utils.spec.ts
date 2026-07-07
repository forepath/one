import {
  buildProviderLocationCatalog,
  resolveHetznerLocationNameFromMetadata,
  resolveProviderLocationLabel,
} from './provider-location.utils';

describe('provider location utils', () => {
  describe('resolveProviderLocationLabel', () => {
    it('should prefer catalog entry over static map', () => {
      expect(resolveProviderLocationLabel('hetzner', 'fsn1', [{ id: 'fsn1', name: 'Falkenstein (API)' }])).toBe(
        'Falkenstein (API)',
      );
    });

    it('should use static map when catalog misses slug', () => {
      expect(resolveProviderLocationLabel('hetzner', 'nbg1', [])).toBe('Nuremberg');
    });

    it('should return slug when provider has no map entry', () => {
      expect(resolveProviderLocationLabel('unknown-provider', 'xyz1')).toBe('xyz1');
    });

    it('should resolve DigitalOcean region from static map', () => {
      expect(resolveProviderLocationLabel('digital-ocean', 'fra1')).toBe('Frankfurt 1');
    });
  });

  describe('buildProviderLocationCatalog', () => {
    it('should merge API locations with static fallbacks', () => {
      const catalog = buildProviderLocationCatalog('hetzner', [{ id: 'fsn1', name: 'Falkenstein' }]);

      expect(catalog.find((item) => item.id === 'fsn1')?.name).toBe('Falkenstein');
      expect(catalog.find((item) => item.id === 'nbg1')?.name).toBe('Nuremberg');
    });

    it('should return static catalog when API result is null', () => {
      const catalog = buildProviderLocationCatalog('digital-ocean', null);

      expect(catalog.find((item) => item.id === 'fra1')?.name).toBe('Frankfurt 1');
      expect(catalog.length).toBeGreaterThan(0);
    });
  });

  describe('resolveHetznerLocationNameFromMetadata', () => {
    it('should prefer city from API metadata', () => {
      expect(resolveHetznerLocationNameFromMetadata('fsn1', 'Falkenstein')).toBe('Falkenstein');
    });

    it('should fall back to static map when city is missing', () => {
      expect(resolveHetznerLocationNameFromMetadata('hel1', undefined)).toBe('Helsinki');
    });
  });
});
