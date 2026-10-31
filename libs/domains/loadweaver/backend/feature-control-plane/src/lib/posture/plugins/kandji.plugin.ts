import type { PosturePluginFactory, PostureVendorDevice } from '../../remote-access/posture-plugin';
import {
  choice,
  daysSince,
  device,
  ids,
  integer,
  mapConcurrent,
  optional,
  required,
  text,
  users,
} from './plugin-helpers';

interface KandjiDevice {
  device_id?: string;
  device_name?: string;
  serial_number?: string;
  blueprint_id?: string;
  blueprint_name?: string;
  last_check_in?: string;
  mdm_enabled?: boolean | string;
  agent_installed?: boolean | string;
  is_missing?: boolean | string;
  /** Assigned user (an object; an empty string when none is assigned). */
  user?: { email?: string } | string | null;
}

interface KandjiStatus {
  library_items?: { name?: string; status?: string }[];
  parameters?: { name?: string; status?: string }[];
}

const PAGE_SIZE = 300;
const SUBDOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function flag(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') return value.toLowerCase() === 'true';

  return undefined;
}

/** A Kandji device record → posture from MDM enrolment, agent, blueprint and check-in. */
export function kandjiDevice(
  d: KandjiDevice,
  options: { blueprintIds: string[]; maxCheckInDays: number },
  now = Date.now(),
): PostureVendorDevice | null {
  const externalId = text(d.device_id, 64);

  if (!externalId) return null;

  const reasons: string[] = [];

  if (flag(d.mdm_enabled) === false) reasons.push('Kandji: MDM is not enabled');

  if (flag(d.agent_installed) === false) reasons.push('Kandji: the agent is not installed');

  if (flag(d.is_missing) === true) reasons.push('Kandji: the device is marked missing');

  if (options.blueprintIds.length && !options.blueprintIds.includes(String(d.blueprint_id ?? '')))
    reasons.push(`Kandji: blueprint ${d.blueprint_name ?? d.blueprint_id ?? 'none'} is not allowed`);

  const days = daysSince(d.last_check_in, now);

  if (days > options.maxCheckInDays)
    reasons.push(
      Number.isFinite(days) ? `Kandji: no check-in for ${Math.floor(days)} days` : 'Kandji: never checked in',
    );

  return device({
    externalId,
    serial: text(d.serial_number, 64),
    hostname: text(d.device_name, 253),
    deviceIds: ids(d.device_id),
    lastSeen: text(d.last_check_in, 40),
    users: users(typeof d.user === 'object' && d.user ? d.user.email : undefined),
    status: reasons.length ? 'non-compliant' : 'compliant',
    reasons,
  });
}

/** Failing library items / parameters of the blueprint downgrade a device to non-compliant. */
export function applyKandjiStatus(d: PostureVendorDevice, status: KandjiStatus): PostureVendorDevice {
  const failing = [
    ...(status.library_items ?? []).filter((i) => i.status?.toLowerCase() === 'failed').map((i) => i.name),
    ...(status.parameters ?? []).filter((p) => p.status?.toUpperCase() === 'ERROR').map((p) => p.name),
  ].filter((n): n is string => !!n);

  if (failing.length === 0) return d;

  return {
    ...d,
    status: 'non-compliant',
    reasons: [
      ...d.reasons,
      `Kandji: failing blueprint items: ${failing.slice(0, 5).join(', ')}${failing.length > 5 ? ` (+${failing.length - 5})` : ''}`,
    ],
  };
}

/**
 * Kandji (MDM): API token (`Authorization: Bearer`, permissions "Device list" and "Device details"),
 * `GET /api/v1/devices` paged by `limit` / `offset`, then `GET /api/v1/devices/{id}/status` for matched devices
 * (blueprint library items and parameters). US: `<subdomain>.api.kandji.io`, EU: `<subdomain>.api.eu.kandji.io`.
 */
export const kandjiPluginFactory: PosturePluginFactory = {
  id: 'kandji',
  displayName: 'Kandji',
  category: 'mdm',
  defaultMatchBy: ['serial', 'deviceId'],
  supportsUserMatch: true,
  fields: [
    { key: 'subdomain', label: 'Subdomain', required: true },
    { key: 'region', label: 'Region', options: ['us', 'eu'], default: 'us' },
    { key: 'apiToken', label: 'API token', required: true, secret: true },
    { key: 'blueprintIds', label: 'Allowed blueprint IDs (comma-separated)' },
    { key: 'maxCheckInDays', label: 'Max. days since check-in', default: '14' },
  ],
  allowedHosts(config) {
    const subdomain = required(config, 'subdomain', SUBDOMAIN);

    required(config, 'apiToken');
    integer(config, 'maxCheckInDays', 14, 1, 365);

    return [`${subdomain}.api.${choice(config, 'region', ['us', 'eu'], 'us') === 'eu' ? 'eu.' : ''}kandji.io`];
  },
  create(config) {
    const host = kandjiPluginFactory.allowedHosts(config)[0];
    const headers = { authorization: `Bearer ${required(config, 'apiToken')}` };
    const options = {
      blueprintIds: optional(config, 'blueprintIds')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      maxCheckInDays: integer(config, 'maxCheckInDays', 14, 1, 365),
    };

    return {
      id: 'kandji',
      category: 'mdm',
      async testConnection({ http }) {
        await http.json({ url: `https://${host}/api/v1/devices?limit=1&offset=0`, headers });

        return 'Kandji answered; devices are readable';
      },
      async fetchDevices({ http }) {
        const devices: PostureVendorDevice[] = [];
        const now = Date.now();

        for (let offset = 0; ; offset += PAGE_SIZE) {
          const page = await http.json<KandjiDevice[]>({
            url: `https://${host}/api/v1/devices?limit=${PAGE_SIZE}&offset=${offset}`,
            headers,
          });

          for (const d of Array.isArray(page) ? page : []) {
            const normalized = kandjiDevice(d, options, now);

            if (normalized) devices.push(normalized);
          }

          if (!Array.isArray(page) || page.length < PAGE_SIZE) break;
        }

        return devices;
      },
      async enrich({ http }, devices) {
        return await mapConcurrent(devices, 4, async (d) => {
          try {
            return applyKandjiStatus(
              d,
              await http.json<KandjiStatus>({
                url: `https://${host}/api/v1/devices/${encodeURIComponent(d.externalId)}/status`,
                headers,
              }),
            );
          } catch {
            return { ...d, status: 'unknown' as const, reasons: [...d.reasons, 'Kandji: device status unavailable'] };
          }
        });
      },
    };
  },
};
