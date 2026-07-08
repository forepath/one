import {
  billingOptimisticOnlineStatus,
  formatBillingProviderLocationLabel,
  getBillingServerLocationLabel,
  isBillingServerOff,
  isBillingServerOnline,
  isBillingServerStartable,
  isBillingServerStatusTransitional,
  providerLocationCatalogFromList,
  resolveServerInfoProvider,
} from './server-info-provider.utils';

describe('server-info-provider.utils', () => {
  describe('resolveServerInfoProvider', () => {
    it('should resolve digital-ocean variants', () => {
      expect(resolveServerInfoProvider({ provider: 'digital-ocean' })).toBe('digital-ocean');
      expect(resolveServerInfoProvider({ provider: 'digitalocean' })).toBe('digital-ocean');
    });

    it('should resolve hetzner', () => {
      expect(resolveServerInfoProvider({ provider: 'hetzner' })).toBe('hetzner');
    });
  });

  describe('isBillingServerOnline', () => {
    it('should treat Hetzner running as online', () => {
      expect(isBillingServerOnline({ status: 'running', metadata: { provider: 'hetzner' } })).toBe(true);
    });

    it('should treat DigitalOcean active as online', () => {
      expect(isBillingServerOnline({ status: 'active', metadata: { provider: 'digital-ocean' } })).toBe(true);
    });
  });

  describe('isBillingServerOff', () => {
    it('should treat DigitalOcean archive as off', () => {
      expect(isBillingServerOff({ status: 'archive', metadata: { provider: 'digital-ocean' } })).toBe(true);
    });
  });

  describe('getBillingServerLocationLabel', () => {
    it('should prefer locationName for Hetzner', () => {
      expect(
        getBillingServerLocationLabel({ provider: 'hetzner', location: 'fsn1', locationName: 'Falkenstein' }),
      ).toBe('Falkenstein');
    });

    it('should fall back to location slug for Hetzner', () => {
      expect(getBillingServerLocationLabel({ provider: 'hetzner', location: 'fsn1' })).toBe('fsn1');
    });

    it('should prefer regionName for DigitalOcean without slug suffix', () => {
      expect(
        getBillingServerLocationLabel({
          provider: 'digital-ocean',
          regionName: 'Frankfurt 1',
          region: 'fra1',
        }),
      ).toBe('Frankfurt 1');
    });
  });

  describe('formatBillingProviderLocationLabel', () => {
    it('should format slug using catalog', () => {
      const catalog = providerLocationCatalogFromList([{ id: 'nbg1', name: 'Nuremberg' }]);

      expect(formatBillingProviderLocationLabel('nbg1', catalog)).toBe('Nuremberg');
    });
  });

  describe('billingOptimisticOnlineStatus', () => {
    it('should return active for digital-ocean', () => {
      expect(billingOptimisticOnlineStatus({ provider: 'digital-ocean' })).toBe('active');
    });

    it('should return running for hetzner', () => {
      expect(billingOptimisticOnlineStatus({ provider: 'hetzner' })).toBe('running');
    });
  });

  describe('isBillingServerStatusTransitional', () => {
    it('should be true when neither online nor off', () => {
      expect(isBillingServerStatusTransitional({ status: 'starting', metadata: { provider: 'hetzner' } })).toBe(true);
    });
  });

  describe('isBillingServerStartable', () => {
    it('should be true when status is off', () => {
      expect(isBillingServerStartable({ status: 'off', metadata: { provider: 'hetzner' } })).toBe(true);
    });
  });
});
