import type { PosturePluginFactory, PostureStatus, PostureVendorDevice } from '../../remote-access/posture-plugin';
import { clientCredentialsToken, type PostureHttp } from '../posture-http';
import { choice, CLIENT_ID, device, ids, required, TENANT_ID, text, users } from './plugin-helpers';

const CLOUDS = {
  global: { login: 'login.microsoftonline.com', graph: 'graph.microsoft.com' },
  usgov: { login: 'login.microsoftonline.us', graph: 'graph.microsoft.us' },
} as const;
type Cloud = keyof typeof CLOUDS;

interface ManagedDevice {
  id?: string;
  deviceName?: string;
  serialNumber?: string;
  azureADDeviceId?: string;
  complianceState?: string;
  lastSyncDateTime?: string;
  userPrincipalName?: string;
  emailAddress?: string;
}

/** Intune `complianceState` → normalized status (Microsoft Graph `complianceState` enum). */
export function intuneStatus(state: string | undefined): { status: PostureStatus; reasons: string[] } {
  switch (state) {
    case 'compliant':
      return { status: 'compliant', reasons: [] };
    case 'inGracePeriod':
      return { status: 'compliant', reasons: ['Intune: in the grace period of a compliance policy'] };
    case 'noncompliant':
      return { status: 'non-compliant', reasons: ['Intune: not compliant with its compliance policies'] };
    case 'conflict':
      return { status: 'non-compliant', reasons: ['Intune: compliance policies conflict'] };
    case 'error':
      return { status: 'non-compliant', reasons: ['Intune: compliance evaluation failed'] };
    default:
      return { status: 'unknown', reasons: [`Intune: compliance state ${state ?? 'missing'}`] };
  }
}

export function intuneDevice(d: ManagedDevice): PostureVendorDevice | null {
  const externalId = text(d.id, 64);

  if (!externalId) return null;

  return device({
    externalId,
    serial: text(d.serialNumber, 64),
    hostname: text(d.deviceName, 253),
    deviceIds: ids(d.id, d.azureADDeviceId !== '00000000-0000-0000-0000-000000000000' ? d.azureADDeviceId : undefined),
    lastSeen: text(d.lastSyncDateTime, 40),
    users: users(d.userPrincipalName, d.emailAddress),
    ...intuneStatus(d.complianceState),
  });
}

const SELECT =
  'id,deviceName,serialNumber,azureADDeviceId,complianceState,lastSyncDateTime,userPrincipalName,emailAddress';

/**
 * Microsoft Intune (MDM): `GET /v1.0/deviceManagement/managedDevices` on Microsoft Graph with an app registration
 * (client credentials, application permission `DeviceManagementManagedDevices.Read.All`); compliance from
 * `complianceState`, pages through `@odata.nextLink`. The primary user (`userPrincipalName` / `emailAddress`) is
 * compared with the VPN client's owner unless the integration turns `requireUserMatch` off.
 */
export const intunePluginFactory: PosturePluginFactory = {
  id: 'intune',
  displayName: 'Microsoft Intune',
  category: 'mdm',
  defaultMatchBy: ['serial', 'deviceId'],
  supportsUserMatch: true,
  fields: [
    { key: 'tenantId', label: 'Tenant ID', required: true },
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client secret', required: true, secret: true },
    { key: 'cloud', label: 'Cloud', options: Object.keys(CLOUDS), default: 'global' },
  ],
  allowedHosts(config) {
    required(config, 'tenantId', TENANT_ID);
    required(config, 'clientId', CLIENT_ID);
    required(config, 'clientSecret');

    const cloud = CLOUDS[choice<Cloud>(config, 'cloud', ['global', 'usgov'], 'global')];

    return [cloud.login, cloud.graph];
  },
  create(config) {
    const cloud = CLOUDS[choice<Cloud>(config, 'cloud', ['global', 'usgov'], 'global')];
    const token = async (http: PostureHttp) =>
      await clientCredentialsToken(
        http,
        `https://${cloud.login}/${encodeURIComponent(required(config, 'tenantId', TENANT_ID))}/oauth2/v2.0/token`,
        {
          client_id: required(config, 'clientId', CLIENT_ID),
          client_secret: required(config, 'clientSecret'),
          scope: `https://${cloud.graph}/.default`,
        },
      );

    return {
      id: 'intune',
      category: 'mdm',
      async testConnection({ http }) {
        const bearer = await token(http);

        await http.json({
          url: `https://${cloud.graph}/v1.0/deviceManagement/managedDevices?$top=1&$select=id`,
          headers: { authorization: `Bearer ${bearer}` },
        });

        return 'Microsoft Graph answered; managed devices are readable';
      },
      async fetchDevices({ http }) {
        const bearer = await token(http);
        const devices: PostureVendorDevice[] = [];
        let url: string | undefined =
          `https://${cloud.graph}/v1.0/deviceManagement/managedDevices?$select=${SELECT}&$top=999`;

        while (url) {
          const page: { value?: ManagedDevice[]; '@odata.nextLink'?: string } = await http.json({
            url,
            headers: { authorization: `Bearer ${bearer}` },
          });

          for (const d of page.value ?? []) {
            const normalized = intuneDevice(d);

            if (normalized) devices.push(normalized);
          }

          url = page['@odata.nextLink'];
        }

        return devices;
      },
    };
  },
};
