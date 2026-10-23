import type {
  PostureCertificateFact,
  PostureIntegration,
  PostureIntegrationFact,
  PostureMatchKey,
  PosturePluginInfo,
  VpnClientPosture,
} from '@forepath/loadweaver/frontend/data-access-console';

export type PostureTone = 'success' | 'warning' | 'danger' | 'secondary' | 'info';

export const POSTURE_MATCH_KEYS: readonly PostureMatchKey[] = ['serial', 'deviceId', 'hostname'];

/** Integration names as the API takes them (used in conditions: `mdm.<name>.compliant`). */
export const INTEGRATION_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function matchKeyLabel(key: PostureMatchKey): string {
  switch (key) {
    case 'serial':
      return $localize`:@@lwConsolePosture-matchSerial:Serial number`;
    case 'deviceId':
      return $localize`:@@lwConsolePosture-matchDeviceId:Device ID`;
    default:
      return $localize`:@@lwConsolePosture-matchHostname:Hostname`;
  }
}

export function integrationStatusTone(status: PostureIntegration['status']): PostureTone {
  return status === 'ok' ? 'success' : status === 'failing' ? 'danger' : status === 'pending' ? 'info' : 'secondary';
}

export function integrationStatusLabel(status: PostureIntegration['status']): string {
  switch (status) {
    case 'ok':
      return $localize`:@@lwConsolePosture-statusOk:Syncing`;
    case 'failing':
      return $localize`:@@lwConsolePosture-statusFailing:Failing`;
    case 'pending':
      return $localize`:@@lwConsolePosture-statusPending:Waiting for the first sync`;
    default:
      return $localize`:@@lwConsolePosture-statusDisabled:Disabled`;
  }
}

export function isStale(fact: PostureIntegrationFact, now = Date.now()): boolean {
  return Date.parse(fact.staleAt) < now;
}

/** Tone of a device's integration result: stale results count as unknown. */
export function factTone(fact: PostureIntegrationFact, now = Date.now()): PostureTone {
  if (isStale(fact, now) || fact.status === 'unknown') return 'secondary';

  if (fact.status === 'non-compliant' || fact.risk === 'high') return 'danger';

  return fact.risk === 'medium' ? 'warning' : 'success';
}

/** `intune: compliant`, `crowdstrike: compliant · risk low`, `jamf: outdated`. */
export function factLabel(fact: PostureIntegrationFact, now = Date.now()): string {
  if (isStale(fact, now)) return `${fact.integration}: ${$localize`:@@lwConsolePosture-factStale:outdated`}`;

  const status =
    fact.status === 'compliant'
      ? $localize`:@@lwConsolePosture-factCompliant:compliant`
      : fact.status === 'non-compliant'
        ? $localize`:@@lwConsolePosture-factNonCompliant:not compliant`
        : $localize`:@@lwConsolePosture-factUnknown:unknown`;
  const risk = fact.risk ? ` · ${$localize`:@@lwConsolePosture-factRisk:risk`} ${riskLabel(fact.risk)}` : '';

  return `${fact.integration}: ${status}${risk}`;
}

export function riskLabel(risk: NonNullable<PostureIntegrationFact['risk']>): string {
  switch (risk) {
    case 'low':
      return $localize`:@@lwConsolePosture-riskLow:low`;
    case 'medium':
      return $localize`:@@lwConsolePosture-riskMedium:medium`;
    default:
      return $localize`:@@lwConsolePosture-riskHigh:high`;
  }
}

export function certificateTone(certificate: PostureCertificateFact | null, now = Date.now()): PostureTone {
  if (!certificate) return 'secondary';

  if (!certificate.valid || (certificate.notAfter && Date.parse(certificate.notAfter) < now)) return 'danger';

  return certificate.notAfter && Date.parse(certificate.notAfter) - now < 14 * 86_400_000 ? 'warning' : 'success';
}

export function certificateLabel(certificate: PostureCertificateFact | null, now = Date.now()): string {
  if (!certificate) return $localize`:@@lwConsolePosture-certNone:No device certificate`;

  if (!certificate.valid) return $localize`:@@lwConsolePosture-certInvalid:Device certificate invalid`;

  if (certificate.notAfter && Date.parse(certificate.notAfter) < now)
    return $localize`:@@lwConsolePosture-certExpired:Device certificate expired`;

  return certificate.source === 'loadweaver'
    ? $localize`:@@lwConsolePosture-certCluster:Device certificate (cluster CA)`
    : $localize`:@@lwConsolePosture-certCompany:Device certificate (company CA)`;
}

/** `macos 15.1 · serial C02… · alice-mbp`, or null without a report. */
export function reportSummary(posture: VpnClientPosture | undefined): string | null {
  if (!posture?.platform) return null;

  return [
    `${posture.platform} ${posture.osVersion ?? ''}`.trim(),
    posture.serialNumber ? `${$localize`:@@lwConsolePosture-serial:serial`} ${posture.serialNumber}` : null,
    posture.hostname,
  ]
    .filter((p): p is string => !!p)
    .join(' · ');
}

/** The configuration payload: non-empty values only; on edit, empty secret fields keep the stored secret. */
export function configPayload(
  plugin: PosturePluginInfo,
  values: Record<string, string>,
  editing: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const field of plugin.fields) {
    const value = (values[field.key] ?? '').trim();

    if (value) result[field.key] = value;
    else if (editing && !field.secret) result[field.key] = '';
  }

  return result;
}

/** Fields the form still needs (required fields; secrets may stay empty when one is stored). */
export function missingFields(
  plugin: PosturePluginInfo,
  values: Record<string, string>,
  secretsSet: readonly string[] = [],
): string[] {
  return plugin.fields
    .filter((f) => f.required && !(values[f.key] ?? '').trim() && !(f.secret && secretsSet.includes(f.key)))
    .map((f) => f.key);
}

/** Match keys in the order the plugin prefers, limited to the selected ones. */
export function orderedMatchBy(selected: readonly PostureMatchKey[], plugin: PosturePluginInfo): PostureMatchKey[] {
  const order = [...plugin.defaultMatchBy, ...POSTURE_MATCH_KEYS.filter((k) => !plugin.defaultMatchBy.includes(k))];

  return order.filter((k) => selected.includes(k));
}
