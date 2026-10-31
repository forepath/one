import type { PostureRiskLevel } from '@forepath/loadweaver/shared/util-model';

import type { PosturePluginFactory, PostureVendorDevice } from '../../remote-access/posture-plugin';
import { clientCredentialsToken, type PostureHttp } from '../posture-http';
import { choice, CLIENT_ID, device, ids, maxRisk, required, TENANT_ID, text } from './plugin-helpers';

/** Documented API hosts of Defender for Endpoint (global and regional). */
const API_HOSTS = [
  'api.security.microsoft.com',
  'api.securitycenter.microsoft.com',
  'api-us.securitycenter.microsoft.com',
  'api-eu.securitycenter.microsoft.com',
  'api-uk.securitycenter.microsoft.com',
  'api-au.securitycenter.microsoft.com',
] as const;

interface Machine {
  id?: string;
  computerDnsName?: string;
  aadDeviceId?: string | null;
  healthStatus?: string;
  riskScore?: string;
  exposureLevel?: string;
  onboardingStatus?: string;
  lastSeen?: string;
}

function level(value: string | undefined): PostureRiskLevel | undefined {
  switch (value) {
    case 'None':
    case 'Informational':
    case 'Low':
      return 'low';
    case 'Medium':
      return 'medium';
    case 'High':
      return 'high';
    default:
      return undefined;
  }
}

/** A Defender machine → risk from `riskScore` (and `exposureLevel`), compliance from the sensor health. */
export function defenderDevice(m: Machine, includeExposure: boolean): PostureVendorDevice | null {
  const externalId = text(m.id, 64);

  if (!externalId) return null;

  const reasons: string[] = [];
  const risk = level(m.riskScore);
  const exposure = includeExposure ? level(m.exposureLevel) : undefined;

  const notOnboarded = !!m.onboardingStatus && m.onboardingStatus !== 'Onboarded';
  const unhealthy = m.healthStatus !== undefined && m.healthStatus !== 'Active';

  if (notOnboarded) reasons.push(`Defender: onboarding status ${m.onboardingStatus}`);

  if (unhealthy) reasons.push(`Defender: sensor health ${m.healthStatus}`);

  if (risk && risk !== 'low') reasons.push(`Defender: risk score ${m.riskScore}`);

  if (exposure && exposure !== 'low') reasons.push(`Defender: exposure level ${m.exposureLevel}`);

  return device({
    externalId,
    hostname: text(m.computerDnsName, 253),
    deviceIds: ids(m.id, m.aadDeviceId ?? undefined),
    lastSeen: text(m.lastSeen, 40),
    status: notOnboarded || unhealthy ? 'non-compliant' : m.healthStatus === undefined ? 'unknown' : 'compliant',
    ...(risk ? { risk: maxRisk(risk, exposure) } : {}),
    reasons,
  });
}

/**
 * Microsoft Defender for Endpoint (EDR): app registration with the WindowsDefenderATP application permission
 * `Machine.Read.All` (client credentials), `GET /api/machines` paged through `@odata.nextLink`; risk from
 * `riskScore` (optionally the higher of it and `exposureLevel`), compliance from `healthStatus` / onboarding.
 */
export const defenderPluginFactory: PosturePluginFactory = {
  id: 'defender',
  displayName: 'Microsoft Defender for Endpoint',
  category: 'edr',
  defaultMatchBy: ['deviceId'],
  fields: [
    { key: 'tenantId', label: 'Tenant ID', required: true },
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client secret', required: true, secret: true },
    { key: 'apiHost', label: 'API host', options: API_HOSTS, default: 'api.security.microsoft.com' },
    { key: 'includeExposure', label: 'Include the exposure level', options: ['true', 'false'], default: 'true' },
  ],
  allowedHosts(config) {
    required(config, 'tenantId', TENANT_ID);
    required(config, 'clientId', CLIENT_ID);
    required(config, 'clientSecret');
    choice(config, 'includeExposure', ['true', 'false'], 'true');

    return ['login.microsoftonline.com', choice(config, 'apiHost', API_HOSTS, 'api.security.microsoft.com')];
  },
  create(config) {
    const apiHost = choice(config, 'apiHost', API_HOSTS, 'api.security.microsoft.com');
    const includeExposure = choice(config, 'includeExposure', ['true', 'false'], 'true') === 'true';
    const token = async (http: PostureHttp) =>
      await clientCredentialsToken(
        http,
        `https://login.microsoftonline.com/${encodeURIComponent(required(config, 'tenantId', TENANT_ID))}/oauth2/v2.0/token`,
        {
          client_id: required(config, 'clientId', CLIENT_ID),
          client_secret: required(config, 'clientSecret'),
          scope: 'https://api.securitycenter.microsoft.com/.default',
        },
      );

    return {
      id: 'defender',
      category: 'edr',
      async testConnection({ http }) {
        const bearer = await token(http);

        await http.json({
          url: `https://${apiHost}/api/machines?$top=1`,
          headers: { authorization: `Bearer ${bearer}` },
        });

        return 'Defender for Endpoint answered; machines are readable';
      },
      async fetchDevices({ http }) {
        const bearer = await token(http);
        const devices: PostureVendorDevice[] = [];
        let url: string | undefined = `https://${apiHost}/api/machines`;

        while (url) {
          const page: { value?: Machine[]; '@odata.nextLink'?: string } = await http.json({
            url,
            headers: { authorization: `Bearer ${bearer}` },
          });

          for (const m of page.value ?? []) {
            const normalized = defenderDevice(m, includeExposure);

            if (normalized) devices.push(normalized);
          }

          url = page['@odata.nextLink'];
        }

        return devices;
      },
    };
  },
};
