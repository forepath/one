import { toApiServiceTypeId } from '../constants/service-type-id.constants';
import type { ServerInfoResponseDto } from '../dto/server-info-response.dto';
import type { SubscriptionItemResponseDto } from '../dto/subscription-item-response.dto';
import type { ProvisioningStatus } from '../entities/subscription-item.entity';

import { normalizeCloudInitService } from './cloud-init/cloud-init-dispatch.utils';
import type { ServerInfo } from './provisioning.utils';

export function mapSubscriptionItemToResponse(item: {
  id: string;
  subscriptionId: string;
  serviceTypeId: string | null;
  serviceType?: { name?: string } | null;
  provisioningStatus: ProvisioningStatus;
  hostname?: string;
  displayName?: string | null;
  configSnapshot?: Record<string, unknown>;
  sshAccessGrantedAt?: Date | null;
  providerReference?: string | null;
}): SubscriptionItemResponseDto {
  const hasServiceType = item.serviceTypeId != null;
  const service = hasServiceType
    ? normalizeCloudInitService(item.configSnapshot?.service as string | undefined)
    : undefined;

  return {
    id: item.id,
    subscriptionId: item.subscriptionId,
    serviceTypeId: toApiServiceTypeId(item.serviceTypeId),
    serviceTypeName: item.serviceType?.name?.trim() || '',
    provisioningStatus: item.provisioningStatus,
    hostname: item.hostname,
    displayName: item.displayName ?? null,
    ...(service ? { service } : {}),
    sshAccessGranted: item.sshAccessGrantedAt != null,
    hasProviderReference: !!item.providerReference?.trim(),
  };
}

export function toServerInfoResponse(info: {
  name: string;
  publicIp: string;
  privateIp?: string;
  status: string;
  metadata?: Record<string, unknown>;
  hostname?: string;
  hostnameFqdn?: string;
}): ServerInfoResponseDto {
  return {
    name: info.name,
    publicIp: info.publicIp,
    privateIp: info.privateIp,
    status: info.status,
    metadata: info.metadata,
    hostname: info.hostname,
    hostnameFqdn: info.hostnameFqdn,
  };
}

export function mapServerInfoSnapshotToResponse(
  snapshot: Record<string, unknown>,
  hostname?: string,
  hostnameFqdn?: string,
): ServerInfoResponseDto | undefined {
  const name = typeof snapshot.name === 'string' ? snapshot.name : undefined;
  const publicIp = typeof snapshot.publicIp === 'string' ? snapshot.publicIp : undefined;

  if (!name || publicIp === undefined) {
    return undefined;
  }

  return {
    name,
    publicIp,
    privateIp: typeof snapshot.privateIp === 'string' ? snapshot.privateIp : undefined,
    status: typeof snapshot.status === 'string' ? snapshot.status : 'unknown',
    metadata:
      snapshot.metadata && typeof snapshot.metadata === 'object'
        ? (snapshot.metadata as Record<string, unknown>)
        : undefined,
    hostname,
    hostnameFqdn,
  };
}

export function mapServerInfoToResponse(info: ServerInfo): ServerInfoResponseDto {
  return toServerInfoResponse(info);
}

function trimConfigGeography(configSnapshot?: Record<string, unknown> | null): string | undefined {
  const location = configSnapshot?.['location'];
  const region = configSnapshot?.['region'];

  if (typeof location === 'string' && location.trim()) {
    return location.trim();
  }

  if (typeof region === 'string' && region.trim()) {
    return region.trim();
  }

  return undefined;
}

export function serverInfoHasGeography(metadata?: Record<string, unknown>): boolean {
  if (!metadata) {
    return false;
  }

  return ['locationName', 'regionName', 'location', 'region'].some((key) => {
    const value = metadata[key];

    return typeof value === 'string' && value.trim() !== '';
  });
}

/**
 * Fills missing provider / geography fields on server-info metadata from the item config snapshot.
 * Cached snapshots and WS payloads sometimes omit location even when the order stored one.
 */
export function enrichServerInfoWithConfigGeography(
  serverInfo: ServerInfoResponseDto | undefined,
  configSnapshot?: Record<string, unknown> | null,
  provider?: string | null,
): ServerInfoResponseDto | undefined {
  if (!serverInfo) {
    return undefined;
  }

  const metadata: Record<string, unknown> = { ...(serverInfo.metadata ?? {}) };
  let changed = false;

  if (provider?.trim() && (typeof metadata['provider'] !== 'string' || !String(metadata['provider']).trim())) {
    metadata['provider'] = provider.trim();
    changed = true;
  }

  const geography = trimConfigGeography(configSnapshot);

  if (geography) {
    if (typeof metadata['location'] !== 'string' || !String(metadata['location']).trim()) {
      metadata['location'] = geography;
      changed = true;
    }

    if (typeof metadata['region'] !== 'string' || !String(metadata['region']).trim()) {
      metadata['region'] = geography;
      changed = true;
    }
  }

  if (!changed) {
    return serverInfo;
  }

  return {
    ...serverInfo,
    metadata,
  };
}
