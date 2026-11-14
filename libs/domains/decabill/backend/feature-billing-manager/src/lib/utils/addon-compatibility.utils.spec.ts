import { isAddonCompatibleWithProvider, partitionAddonsByProviderCompatibility } from './addon-compatibility.utils';

describe('addon-compatibility.utils', () => {
  describe('isAddonCompatibleWithProvider', () => {
    it('treats empty compatibleProviders as all providers', () => {
      expect(isAddonCompatibleWithProvider({ compatibleProviders: [] }, 'hetzner')).toBe(true);
      expect(isAddonCompatibleWithProvider({ compatibleProviders: [] }, 'digital-ocean')).toBe(true);
    });

    it('matches when provider is in the allowlist', () => {
      expect(isAddonCompatibleWithProvider({ compatibleProviders: ['hetzner'] }, 'hetzner')).toBe(true);
    });

    it('rejects when provider is not in the allowlist', () => {
      expect(isAddonCompatibleWithProvider({ compatibleProviders: ['hetzner'] }, 'digital-ocean')).toBe(false);
    });

    it('rejects non-empty allowlist when provider is missing', () => {
      expect(isAddonCompatibleWithProvider({ compatibleProviders: ['hetzner'] }, null)).toBe(false);
      expect(isAddonCompatibleWithProvider({ compatibleProviders: ['hetzner'] }, '')).toBe(false);
    });
  });

  describe('partitionAddonsByProviderCompatibility', () => {
    it('splits addons by provider compatibility', () => {
      const addons = [
        { id: 'a1', compatibleProviders: ['hetzner'] },
        { id: 'a2', compatibleProviders: [] },
        { id: 'a3', compatibleProviders: ['digital-ocean'] },
      ];
      const result = partitionAddonsByProviderCompatibility(addons, 'hetzner');

      expect(result.compatible.map((addon) => addon.id)).toEqual(['a1', 'a2']);
      expect(result.incompatible.map((addon) => addon.id)).toEqual(['a3']);
    });
  });
});
