import type { ServerInfoResponse } from '../types/billing.types';

import {
  billingOptimisticOnlineStatus,
  getBillingServerLocationLabel,
  isBillingServerOff,
  isBillingServerOnline,
  isBillingServerStartable,
  isBillingServerStatusTransitional,
  resolveServerInfoProvider,
} from './server-info-provider.utils';

function info(partial: Partial<ServerInfoResponse> & Pick<ServerInfoResponse, 'status'>): ServerInfoResponse {
  return {
    name: 's',
    publicIp: '1.1.1.1',
    ...partial,
  };
}

describe('server-info-provider.utils', () => {
  describe('resolveServerInfoProvider', () => {
    it('should resolve digital-ocean and hetzner', () => {
      expect(resolveServerInfoProvider({ provider: 'digital-ocean' })).toBe('digital-ocean');
      expect(resolveServerInfoProvider({ provider: 'digitalocean' })).toBe('digital-ocean');
      expect(resolveServerInfoProvider({ provider: 'hetzner' })).toBe('hetzner');
      expect(resolveServerInfoProvider({})).toBeUndefined();
    });
  });

  describe('isBillingServerOnline', () => {
    it('should treat Hetzner running as online', () => {
      expect(isBillingServerOnline(info({ status: 'running', metadata: { provider: 'hetzner' } }))).toBe(true);
      expect(isBillingServerOnline(info({ status: 'active', metadata: { provider: 'hetzner' } }))).toBe(false);
    });

    it('should treat DigitalOcean active as online', () => {
      expect(isBillingServerOnline(info({ status: 'active', metadata: { provider: 'digital-ocean' } }))).toBe(true);
      expect(isBillingServerOnline(info({ status: 'running', metadata: { provider: 'digital-ocean' } }))).toBe(false);
      expect(isBillingServerOnline(info({ status: 'new', metadata: { provider: 'digital-ocean' } }))).toBe(false);
    });

    it('should accept running or active when provider is unknown', () => {
      expect(isBillingServerOnline(info({ status: 'running' }))).toBe(true);
      expect(isBillingServerOnline(info({ status: 'active' }))).toBe(true);
    });
  });

  describe('isBillingServerOff', () => {
    it('should treat Hetzner off as off', () => {
      expect(isBillingServerOff(info({ status: 'off', metadata: { provider: 'hetzner' } }))).toBe(true);
      expect(isBillingServerOff(info({ status: 'archive', metadata: { provider: 'hetzner' } }))).toBe(false);
    });

    it('should treat DigitalOcean off and archive as off-like', () => {
      expect(isBillingServerOff(info({ status: 'off', metadata: { provider: 'digital-ocean' } }))).toBe(true);
      expect(isBillingServerOff(info({ status: 'archive', metadata: { provider: 'digital-ocean' } }))).toBe(true);
    });
  });

  describe('isBillingServerStartable', () => {
    it('should only allow start when status is off', () => {
      expect(isBillingServerStartable(info({ status: 'off', metadata: { provider: 'digital-ocean' } }))).toBe(true);
      expect(isBillingServerStartable(info({ status: 'archive', metadata: { provider: 'digital-ocean' } }))).toBe(
        false,
      );
    });
  });

  describe('isBillingServerStatusTransitional', () => {
    it('should be true when neither online nor off for the provider', () => {
      expect(isBillingServerStatusTransitional(info({ status: 'new', metadata: { provider: 'digital-ocean' } }))).toBe(
        true,
      );
      expect(isBillingServerStatusTransitional(info({ status: 'starting', metadata: { provider: 'hetzner' } }))).toBe(
        true,
      );
    });

    it('should be false when online or off', () => {
      expect(
        isBillingServerStatusTransitional(info({ status: 'active', metadata: { provider: 'digital-ocean' } })),
      ).toBe(false);
      expect(isBillingServerStatusTransitional(info({ status: 'off', metadata: { provider: 'hetzner' } }))).toBe(false);
    });
  });

  describe('getBillingServerLocationLabel', () => {
    it('should prefer datacenter or location for Hetzner', () => {
      expect(getBillingServerLocationLabel({ provider: 'hetzner', datacenter: 'nbg1' })).toBe('nbg1');
      expect(getBillingServerLocationLabel({ provider: 'hetzner', location: 'Nuremberg' })).toBe('Nuremberg');
    });

    it('should format DigitalOcean region', () => {
      expect(
        getBillingServerLocationLabel({
          provider: 'digital-ocean',
          regionName: 'Frankfurt 1',
          region: 'fra1',
        }),
      ).toBe('Frankfurt 1 (fra1)');
    });
  });

  describe('billingOptimisticOnlineStatus', () => {
    it('should return active for DigitalOcean and running otherwise', () => {
      expect(billingOptimisticOnlineStatus({ provider: 'digital-ocean' })).toBe('active');
      expect(billingOptimisticOnlineStatus({ provider: 'hetzner' })).toBe('running');
      expect(billingOptimisticOnlineStatus(undefined)).toBe('running');
    });
  });
});
