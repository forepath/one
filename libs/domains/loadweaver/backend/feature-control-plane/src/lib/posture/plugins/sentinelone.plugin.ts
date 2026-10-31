import type { PosturePluginFactory, PostureVendorDevice } from '../../remote-access/posture-plugin';
import { httpsOrigin } from '../posture-http';
import { device, ids, optional, required, text } from './plugin-helpers';

interface Agent {
  id?: string;
  uuid?: string;
  computerName?: string;
  serialNumber?: string | null;
  isActive?: boolean;
  isDecommissioned?: boolean;
  infected?: boolean;
  activeThreats?: number;
  networkStatus?: string;
  isUpToDate?: boolean;
  threatRebootRequired?: boolean;
  lastActiveDate?: string;
}

const PAGE_SIZE = 1000;

/** A SentinelOne agent → risk from threats / quarantine / updates, compliance from the agent state. */
export function sentinelOneDevice(a: Agent): PostureVendorDevice | null {
  const externalId = text(a.id, 64);

  if (!externalId) return null;

  const reasons: string[] = [];
  let risk: 'low' | 'medium' | 'high' = 'low';
  const threats = typeof a.activeThreats === 'number' ? a.activeThreats : 0;

  if (a.infected || threats > 0) {
    risk = 'high';
    reasons.push(`SentinelOne: ${threats || 'unresolved'} active threat(s)`);
  }

  if (a.networkStatus === 'disconnected') {
    risk = 'high';
    reasons.push('SentinelOne: the endpoint is network-quarantined');
  }

  if (risk !== 'high' && (a.isUpToDate === false || a.threatRebootRequired === true)) {
    risk = 'medium';
    reasons.push(
      a.threatRebootRequired
        ? 'SentinelOne: a reboot is required to finish mitigation'
        : 'SentinelOne: the agent is outdated',
    );
  }

  const inactive = a.isActive === false || a.isDecommissioned === true;

  if (inactive)
    reasons.push(
      a.isDecommissioned ? 'SentinelOne: the agent is decommissioned' : 'SentinelOne: the agent is inactive',
    );

  return device({
    externalId,
    serial: text(a.serialNumber ?? undefined, 64),
    hostname: text(a.computerName, 253),
    deviceIds: ids(a.id, a.uuid),
    lastSeen: text(a.lastActiveDate, 40),
    status: inactive ? 'non-compliant' : 'compliant',
    risk,
    reasons,
  });
}

/**
 * SentinelOne (EDR): API token of a service user (`Authorization: ApiToken …`, viewer role), agents through
 * `GET /web/api/v2.1/agents` with cursor pagination, optionally limited to sites.
 */
export const sentinelOnePluginFactory: PosturePluginFactory = {
  id: 'sentinelone',
  displayName: 'SentinelOne',
  category: 'edr',
  defaultMatchBy: ['deviceId', 'serial'],
  fields: [
    {
      key: 'consoleUrl',
      label: 'Management console URL',
      required: true,
      description: 'https://<tenant>.sentinelone.net',
    },
    { key: 'apiToken', label: 'API token', required: true, secret: true },
    { key: 'siteIds', label: 'Site IDs (comma-separated)' },
  ],
  allowedHosts(config) {
    required(config, 'apiToken');

    if (
      optional(config, 'siteIds') &&
      !/^[0-9]{1,24}(,[0-9]{1,24})*$/.test(optional(config, 'siteIds').replace(/\s/g, ''))
    )
      throw new Error('siteIds must be comma-separated numbers');

    return [httpsOrigin(config['consoleUrl'], 'consoleUrl').hostname];
  },
  create(config) {
    const origin = httpsOrigin(config['consoleUrl'], 'consoleUrl').origin;
    const headers = { authorization: `ApiToken ${required(config, 'apiToken')}` };
    const sites = optional(config, 'siteIds').replace(/\s/g, '');
    const query = (limit: number, cursor?: string) =>
      `${origin}/web/api/v2.1/agents?limit=${limit}${sites ? `&siteIds=${sites}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

    return {
      id: 'sentinelone',
      category: 'edr',
      async testConnection({ http }) {
        const answer = await http.json<{ pagination?: { totalItems?: number } }>({ url: query(1), headers });

        return `SentinelOne answered; ${answer.pagination?.totalItems ?? 0} agents`;
      },
      async fetchDevices({ http }) {
        const devices: PostureVendorDevice[] = [];
        let cursor: string | undefined;

        do {
          const answer: { data?: Agent[]; pagination?: { nextCursor?: string | null } } = await http.json({
            url: query(PAGE_SIZE, cursor),
            headers,
          });

          for (const a of answer.data ?? []) {
            const normalized = sentinelOneDevice(a);

            if (normalized) devices.push(normalized);
          }

          cursor = answer.pagination?.nextCursor ?? undefined;
        } while (cursor);

        return devices;
      },
    };
  },
};
