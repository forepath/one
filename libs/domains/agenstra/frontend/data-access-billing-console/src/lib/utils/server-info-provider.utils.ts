import type { ServerInfoResponse } from '../types/billing.types';

export type BillingServerInfoProvider = 'hetzner' | 'digital-ocean';

/**
 * Resolves provisioning provider from server-info metadata (set by billing-manager).
 */
export function resolveServerInfoProvider(metadata?: Record<string, unknown>): BillingServerInfoProvider | undefined {
  const raw = metadata?.['provider'];

  if (raw === 'digital-ocean' || raw === 'digitalocean') {
    return 'digital-ocean';
  }

  if (raw === 'hetzner') {
    return 'hetzner';
  }

  return undefined;
}

/**
 * Hetzner: online when status is `running`.
 * DigitalOcean: online when status is `active`.
 * Unknown provider: treat either `running` or `active` as online (safe default).
 */
export function isBillingServerOnline(serverInfo: Pick<ServerInfoResponse, 'status' | 'metadata'>): boolean {
  const provider = resolveServerInfoProvider(serverInfo.metadata);

  if (provider === 'digital-ocean') {
    return serverInfo.status === 'active';
  }

  if (provider === 'hetzner') {
    return serverInfo.status === 'running';
  }

  return serverInfo.status === 'running' || serverInfo.status === 'active';
}

/**
 * Hetzner: powered off when `off`.
 * DigitalOcean: `off` or `archive` (not accepting traffic).
 */
export function isBillingServerOff(serverInfo: Pick<ServerInfoResponse, 'status' | 'metadata'>): boolean {
  const provider = resolveServerInfoProvider(serverInfo.metadata);

  if (provider === 'digital-ocean') {
    return serverInfo.status === 'off' || serverInfo.status === 'archive';
  }

  return serverInfo.status === 'off';
}

/**
 * True when the status badge shows the hourglass — neither clearly online nor off (e.g. transitioning).
 */
export function isBillingServerStatusTransitional(
  serverInfo: Pick<ServerInfoResponse, 'status' | 'metadata'>,
): boolean {
  return !isBillingServerOnline(serverInfo) && !isBillingServerOff(serverInfo);
}

/**
 * Whether the UI may offer "start" (power on). Archive droplets are not startable from this flow.
 */
export function isBillingServerStartable(serverInfo: Pick<ServerInfoResponse, 'status' | 'metadata'>): boolean {
  return serverInfo.status === 'off';
}

/**
 * Location/datacenter label for the UI.
 * Hetzner: datacenter or location.
 * DigitalOcean: regionName and region slug.
 */
export function getBillingServerLocationLabel(metadata?: Record<string, unknown>): string | undefined {
  const provider = resolveServerInfoProvider(metadata);

  if (provider === 'digital-ocean') {
    const regionName = metadata?.['regionName'];
    const region = metadata?.['region'];

    if (typeof regionName === 'string' && regionName.trim()) {
      if (typeof region === 'string' && region.trim()) {
        return `${regionName} (${region})`;
      }

      return regionName;
    }

    if (typeof region === 'string' && region.trim()) {
      return region;
    }

    return undefined;
  }

  const datacenter = metadata?.['datacenter'];
  const location = metadata?.['location'];

  if (typeof datacenter === 'string' && datacenter.trim()) {
    return datacenter;
  }

  if (typeof location === 'string' && location.trim()) {
    return location;
  }

  return undefined;
}

/**
 * Optimistic status after a successful start action (reducer).
 */
export function billingOptimisticOnlineStatus(metadata?: Record<string, unknown>): string {
  return resolveServerInfoProvider(metadata) === 'digital-ocean' ? 'active' : 'running';
}
