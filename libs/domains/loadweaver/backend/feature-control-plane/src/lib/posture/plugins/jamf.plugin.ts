import type { PosturePluginFactory, PostureVendorDevice } from '../../remote-access/posture-plugin';
import { clientCredentialsToken, httpsOrigin, type PostureHttp } from '../posture-http';
import { CLIENT_ID, daysSince, device, ids, integer, optional, required, text, users } from './plugin-helpers';

interface JamfComputer {
  id?: string;
  udid?: string;
  general?: {
    name?: string;
    lastContactTime?: string;
    remoteManagement?: { managed?: boolean };
  };
  hardware?: { serialNumber?: string };
  userAndLocation?: { email?: string; username?: string };
  groupMemberships?: { groupId?: string; groupName?: string; smartGroup?: boolean }[];
}

const PAGE_SIZE = 200;

/** One Jamf Pro inventory record → normalized posture (managed, recent check-in, compliance smart group). */
export function jamfDevice(
  c: JamfComputer,
  options: { complianceGroupId?: string; maxCheckInDays: number },
  now = Date.now(),
): PostureVendorDevice | null {
  const externalId = text(c.id, 64);

  if (!externalId) return null;

  const reasons: string[] = [];

  if (c.general?.remoteManagement?.managed !== true) reasons.push('Jamf Pro: the computer is not managed');

  const days = daysSince(c.general?.lastContactTime, now);

  if (days > options.maxCheckInDays)
    reasons.push(
      Number.isFinite(days)
        ? `Jamf Pro: no check-in for ${Math.floor(days)} days`
        : 'Jamf Pro: the computer never checked in',
    );

  if (
    options.complianceGroupId &&
    !(c.groupMemberships ?? []).some((g) => String(g.groupId) === options.complianceGroupId)
  )
    reasons.push('Jamf Pro: not in the compliance smart group');

  return device({
    externalId,
    serial: text(c.hardware?.serialNumber, 64),
    hostname: text(c.general?.name, 253),
    deviceIds: ids(c.id, c.udid),
    lastSeen: text(c.general?.lastContactTime, 40),
    users: users(c.userAndLocation?.email, c.userAndLocation?.username),
    status: reasons.length ? 'non-compliant' : 'compliant',
    reasons,
  });
}

/**
 * Jamf Pro (MDM): API client credentials (`POST /api/oauth/token`, privilege "Read Computers"), inventory through
 * `GET /api/v1/computers-inventory` with the GENERAL, HARDWARE, USER_AND_LOCATION and GROUP_MEMBERSHIPS sections,
 * paged. Compliant when managed, checked in recently and (if configured) a member of the compliance smart group. The
 * assigned user's e-mail (or a UPN-style username) is compared with the VPN client's owner (`requireUserMatch`).
 */
export const jamfPluginFactory: PosturePluginFactory = {
  id: 'jamf',
  displayName: 'Jamf Pro',
  category: 'mdm',
  defaultMatchBy: ['serial', 'deviceId'],
  supportsUserMatch: true,
  fields: [
    { key: 'baseUrl', label: 'Jamf Pro URL', required: true, description: 'https://<instance>.jamfcloud.com' },
    { key: 'clientId', label: 'API client ID', required: true },
    { key: 'clientSecret', label: 'API client secret', required: true, secret: true },
    { key: 'complianceGroupId', label: 'Compliance smart group ID' },
    { key: 'maxCheckInDays', label: 'Max. days since check-in', default: '14' },
  ],
  allowedHosts(config) {
    required(config, 'clientId', CLIENT_ID);
    required(config, 'clientSecret');
    integer(config, 'maxCheckInDays', 14, 1, 365);

    if (optional(config, 'complianceGroupId') && !/^[0-9]{1,12}$/.test(optional(config, 'complianceGroupId')))
      throw new Error('complianceGroupId must be a number');

    return [httpsOrigin(config['baseUrl'], 'baseUrl').hostname];
  },
  create(config) {
    const base = httpsOrigin(config['baseUrl'], 'baseUrl');
    const origin = `${base.origin}${base.pathname.replace(/\/+$/, '')}`;
    const options = {
      complianceGroupId: optional(config, 'complianceGroupId') || undefined,
      maxCheckInDays: integer(config, 'maxCheckInDays', 14, 1, 365),
    };
    const token = async (http: PostureHttp) =>
      await clientCredentialsToken(http, `${origin}/api/oauth/token`, {
        client_id: required(config, 'clientId', CLIENT_ID),
        client_secret: required(config, 'clientSecret'),
      });
    const page = async (http: PostureHttp, bearer: string, index: number, size: number) =>
      await http.json<{ totalCount?: number; results?: JamfComputer[] }>({
        url: `${origin}/api/v1/computers-inventory?section=GENERAL&section=HARDWARE&section=USER_AND_LOCATION&section=GROUP_MEMBERSHIPS&page=${index}&page-size=${size}&sort=id%3Aasc`,
        headers: { authorization: `Bearer ${bearer}` },
      });

    return {
      id: 'jamf',
      category: 'mdm',
      async testConnection({ http }) {
        const answer = await page(http, await token(http), 0, 1);

        return `Jamf Pro answered; ${answer.totalCount ?? 0} computers in the inventory`;
      },
      async fetchDevices({ http }) {
        const bearer = await token(http);
        const devices: PostureVendorDevice[] = [];
        const now = Date.now();

        for (let index = 0; ; index++) {
          const answer = await page(http, bearer, index, PAGE_SIZE);
          const results = answer.results ?? [];

          for (const c of results) {
            const normalized = jamfDevice(c, options, now);

            if (normalized) devices.push(normalized);
          }

          if (results.length < PAGE_SIZE || (index + 1) * PAGE_SIZE >= (answer.totalCount ?? 0)) break;
        }

        return devices;
      },
    };
  },
};
