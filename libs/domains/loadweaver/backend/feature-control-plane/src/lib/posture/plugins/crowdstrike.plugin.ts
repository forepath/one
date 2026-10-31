import type { PostureRiskLevel } from '@forepath/loadweaver/shared/util-model';

import type { PosturePluginFactory, PostureVendorDevice } from '../../remote-access/posture-plugin';
import { PostureHttpError, type PostureHttp } from '../posture-http';
import { choice, CLIENT_ID, device, ids, integer, required, text } from './plugin-helpers';

const CLOUDS = {
  'us-1': 'api.crowdstrike.com',
  'us-2': 'api.us-2.crowdstrike.com',
  'eu-1': 'api.eu-1.crowdstrike.com',
  'us-gov-1': 'api.laggar.gcw.crowdstrike.com',
} as const;
type Cloud = keyof typeof CLOUDS;

interface Host {
  device_id?: string;
  hostname?: string;
  serial_number?: string;
  status?: string;
  last_seen?: string;
  reduced_functionality_mode?: string;
}

interface Assessment {
  aid?: string;
  assessment?: { overall?: number };
}

const SCROLL_LIMIT = 5000;
const DETAILS_BATCH = 5000;
const ZTA_BATCH = 100;

/** A Falcon host → compliance from containment / sensor mode; risk comes from the ZTA score (`applyZta`). */
export function crowdstrikeDevice(h: Host): PostureVendorDevice | null {
  const externalId = text(h.device_id, 64);

  if (!externalId) return null;

  const reasons: string[] = [];
  const contained = h.status === 'contained' || h.status === 'containment_pending';

  if (contained) reasons.push('CrowdStrike: the host is network-contained');

  if (h.reduced_functionality_mode === 'yes')
    reasons.push('CrowdStrike: the sensor runs in reduced functionality mode');

  return device({
    externalId,
    serial: text(h.serial_number, 64),
    hostname: text(h.hostname, 253),
    deviceIds: ids(h.device_id),
    lastSeen: text(h.last_seen, 40),
    status: reasons.length ? 'non-compliant' : 'compliant',
    ...(contained ? { risk: 'high' as const } : {}),
    reasons,
  });
}

/** ZTA overall score (0–100, higher is better) → risk level by the configured thresholds. */
export function ztaRisk(score: number, lowMin: number, mediumMin: number): PostureRiskLevel {
  return score >= lowMin ? 'low' : score >= mediumMin ? 'medium' : 'high';
}

export function applyZta(
  d: PostureVendorDevice,
  score: number | undefined,
  lowMin: number,
  mediumMin: number,
): PostureVendorDevice {
  if (score === undefined) return { ...d, reasons: [...d.reasons, 'CrowdStrike: no Zero Trust Assessment yet'] };

  const risk = ztaRisk(score, lowMin, mediumMin);

  return {
    ...d,
    // Containment keeps the host at high risk.
    risk: d.risk === 'high' ? 'high' : risk,
    reasons: risk === 'low' ? d.reasons : [...d.reasons, `CrowdStrike: Zero Trust Assessment score ${score}`],
  };
}

/**
 * CrowdStrike Falcon (EDR): API client (`POST /oauth2/token`, scopes "Hosts: Read" and "Zero Trust Assessment:
 * Read"), host ids through `GET /devices/queries/devices-scroll/v1`, details through
 * `POST /devices/entities/devices/v2`, and ZTA scores (`GET /zero-trust-assessment/entities/assessments/v1`) for
 * matched hosts only.
 */
export const crowdstrikePluginFactory: PosturePluginFactory = {
  id: 'crowdstrike',
  displayName: 'CrowdStrike Falcon',
  category: 'edr',
  defaultMatchBy: ['deviceId', 'serial'],
  fields: [
    { key: 'cloud', label: 'Cloud', options: Object.keys(CLOUDS), default: 'us-1' },
    { key: 'clientId', label: 'API client ID', required: true },
    { key: 'clientSecret', label: 'API client secret', required: true, secret: true },
    { key: 'ztaLowRiskMin', label: 'ZTA score for low risk (≥)', default: '70' },
    { key: 'ztaMediumRiskMin', label: 'ZTA score for medium risk (≥)', default: '40' },
  ],
  allowedHosts(config) {
    required(config, 'clientId', CLIENT_ID);
    required(config, 'clientSecret');

    const low = integer(config, 'ztaLowRiskMin', 70, 1, 100);
    const medium = integer(config, 'ztaMediumRiskMin', 40, 0, 100);

    if (medium > low) throw new Error('ztaMediumRiskMin must not exceed ztaLowRiskMin');

    return [CLOUDS[choice<Cloud>(config, 'cloud', ['us-1', 'us-2', 'eu-1', 'us-gov-1'], 'us-1')]];
  },
  create(config) {
    const host = CLOUDS[choice<Cloud>(config, 'cloud', ['us-1', 'us-2', 'eu-1', 'us-gov-1'], 'us-1')];
    const low = integer(config, 'ztaLowRiskMin', 70, 1, 100);
    const medium = integer(config, 'ztaMediumRiskMin', 40, 0, 100);
    const token = async (http: PostureHttp) => {
      const answer = await http.json<{ access_token?: string }>({
        method: 'POST',
        url: `https://${host}/oauth2/token`,
        form: { client_id: required(config, 'clientId', CLIENT_ID), client_secret: required(config, 'clientSecret') },
      });

      if (!answer.access_token) throw new PostureHttpError('the token endpoint returned no access token');

      return answer.access_token;
    };

    return {
      id: 'crowdstrike',
      category: 'edr',
      async testConnection({ http }) {
        const bearer = await token(http);
        const answer = await http.json<{ meta?: { pagination?: { total?: number } } }>({
          url: `https://${host}/devices/queries/devices-scroll/v1?limit=1`,
          headers: { authorization: `Bearer ${bearer}` },
        });

        return `CrowdStrike answered; ${answer.meta?.pagination?.total ?? 0} hosts`;
      },
      async fetchDevices({ http }) {
        const bearer = await token(http);
        const headers = { authorization: `Bearer ${bearer}` };
        const hostIds: string[] = [];
        let offset: string | undefined;

        for (;;) {
          const answer: { resources?: string[]; meta?: { pagination?: { offset?: string; total?: number } } } =
            await http.json({
              url: `https://${host}/devices/queries/devices-scroll/v1?limit=${SCROLL_LIMIT}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`,
              headers,
            });
          const page = answer.resources ?? [];

          hostIds.push(...page);
          offset = answer.meta?.pagination?.offset;

          if (page.length === 0 || !offset || hostIds.length >= (answer.meta?.pagination?.total ?? 0)) break;
        }

        const devices: PostureVendorDevice[] = [];

        for (let i = 0; i < hostIds.length; i += DETAILS_BATCH) {
          const answer = await http.json<{ resources?: Host[] }>({
            method: 'POST',
            url: `https://${host}/devices/entities/devices/v2`,
            headers,
            json: { ids: hostIds.slice(i, i + DETAILS_BATCH) },
          });

          for (const h of answer.resources ?? []) {
            const normalized = crowdstrikeDevice(h);

            if (normalized) devices.push(normalized);
          }
        }

        return devices;
      },
      async enrich({ http }, devices) {
        const bearer = await token(http);
        const scores = new Map<string, number>();

        for (let i = 0; i < devices.length; i += ZTA_BATCH) {
          const batch = devices.slice(i, i + ZTA_BATCH);
          const query = batch.map((d) => `ids=${encodeURIComponent(d.externalId)}`).join('&');

          try {
            const answer = await http.json<{ resources?: Assessment[] }>({
              url: `https://${host}/zero-trust-assessment/entities/assessments/v1?${query}`,
              headers: { authorization: `Bearer ${bearer}` },
            });

            for (const a of answer.resources ?? [])
              if (a.aid && typeof a.assessment?.overall === 'number') scores.set(a.aid, a.assessment.overall);
          } catch (error) {
            // 404: none of the hosts has an assessment yet; others leave the risk unknown.
            if (!(error instanceof PostureHttpError && error.status === 404)) throw error;
          }
        }

        return devices.map((d) => applyZta(d, scores.get(d.externalId), low, medium));
      },
    };
  },
};
