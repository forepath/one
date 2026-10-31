import { readFileSync } from 'node:fs';

import { isUnknown, type BlockSchema, type TfObject } from '@forepath/loadweaver/backend/util-terraform-protocol';

import { attributeError, type Diagnostic } from './diagnostics';

export const PROVIDER_SCHEMA: BlockSchema = {
  version: 0,
  description:
    'Manages Loadweaver resources through the control-plane API. Every change goes through a Loadweaver plan: `terraform plan` runs a dry-run plan, `terraform apply` creates and applies one (subject to approval rules).',
  attributes: [
    {
      name: 'endpoint',
      type: 'string',
      optional: true,
      description: 'Control-plane URL, e.g. `https://cp.example.com`. Default: `LOADWEAVER_URL`.',
    },
    {
      name: 'token',
      type: 'string',
      optional: true,
      sensitive: true,
      description:
        'Personal access token (scopes `resources:read`, `plans:create`, `plans:apply`). Default: `LOADWEAVER_TOKEN`.',
    },
    {
      name: 'project',
      type: 'string',
      optional: true,
      description:
        'Default project for project resources (and for resources that may be cluster-wide or project-scoped). Default: `LOADWEAVER_PROJECT`.',
    },
    {
      name: 'ca_certificate',
      type: 'string',
      optional: true,
      description:
        'CA certificate(s) (PEM) to verify the control plane with instead of the system CAs, e.g. `file("ca.pem")`. Default: `LOADWEAVER_CA_CERT` (PEM or a file path).',
    },
    {
      name: 'approval_timeout',
      type: 'string',
      optional: true,
      description:
        'How long `terraform apply` waits for approvals required by the project settings (e.g. `30m`, `2h`). Default `30m`; `0s` fails at once.',
    },
    {
      name: 'apply_timeout',
      type: 'string',
      optional: true,
      description: 'How long to follow an apply until every node reported it (e.g. `15m`). Default `15m`.',
    },
    {
      name: 'poll_interval',
      type: 'string',
      optional: true,
      description: 'How often to check for approvals and apply progress. Default `5s`.',
    },
    {
      name: 'confirm_pins',
      type: 'bool',
      optional: true,
      description:
        'Confirm unacknowledged pins listed in plan warnings (the console / CLI `confirm`). Default `false`.',
    },
    {
      name: 'dry_run',
      type: 'bool',
      optional: true,
      description: 'Run a Loadweaver dry-run plan during `terraform plan` (validation and effects). Default `true`.',
    },
    {
      name: 'insecure_http',
      type: 'bool',
      optional: true,
      description:
        'Allow a plain `http://` endpoint (the token is then sent unencrypted). Only for local development / tests. Default `false`.',
    },
  ],
};

export interface ProviderSettings {
  endpoint: string;
  token: string;
  project: string | null;
  caCertificate: string | null;
  approvalTimeoutMs: number;
  applyTimeoutMs: number;
  pollIntervalMs: number;
  confirmPins: boolean;
  dryRun: boolean;
}

const HTTP_URL = /^https?:\/\/[^/\s]+/i;

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** Parses a Go-style duration (`90s`, `30m`, `1h30m`, `500ms`) into milliseconds; `null` if invalid. */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();

  if (trimmed === '0') return 0;

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/gy;
  let total = 0;
  let matched = 0;

  for (let m = pattern.exec(trimmed); m; m = pattern.exec(trimmed)) {
    total += Number(m[1]) * UNITS[m[2]];
    matched = pattern.lastIndex;
  }

  return matched > 0 && matched === trimmed.length ? Math.round(total) : null;
}

function str(config: TfObject | null, key: string): string | null {
  const v = config?.[key];

  return typeof v === 'string' && v !== '' ? v : null;
}

function readCa(value: string, source: string, diags: Diagnostic[]): string | null {
  if (value.includes('-----BEGIN')) return value;

  try {
    return readFileSync(value, 'utf8');
  } catch {
    diags.push(
      attributeError(
        'ca_certificate',
        'Invalid CA certificate',
        `${source} is neither a PEM certificate nor a readable file.`,
      ),
    );

    return null;
  }
}

function insecureEndpointError(source: string): Diagnostic {
  return attributeError(
    'endpoint',
    'Insecure endpoint',
    `${source} uses plain http://, which would send the access token unencrypted. Use https:// (with \`ca_certificate\` for a private CA) or set \`insecure_http = true\` for local development only.`,
  );
}

/** `insecure_http = true` (or not known yet during validation). */
function insecureAllowed(config: TfObject | null): boolean {
  const v = config?.['insecure_http'];

  return v === true || isUnknown(v);
}

/** Validation that works on partially unknown configuration (ValidateProviderConfig). */
export function validateProviderConfig(config: TfObject | null): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const key of ['approval_timeout', 'apply_timeout', 'poll_interval']) {
    const v = config?.[key];

    if (typeof v === 'string' && parseDuration(v) === null)
      diags.push(attributeError(key, 'Invalid duration', `"${v}" is not a duration such as "90s", "30m" or "1h30m".`));
  }

  const endpoint = config?.['endpoint'];

  if (typeof endpoint === 'string' && endpoint !== '' && !HTTP_URL.test(endpoint))
    diags.push(
      attributeError('endpoint', 'Invalid endpoint', 'The endpoint must be an http(s) URL of the control plane.'),
    );
  else if (typeof endpoint === 'string' && /^http:/i.test(endpoint) && !insecureAllowed(config))
    diags.push(insecureEndpointError('endpoint'));

  return diags;
}

/** Resolves the provider block with its environment defaults (ConfigureProvider). */
export function resolveProviderSettings(
  config: TfObject | null,
  env: NodeJS.ProcessEnv,
): { settings: ProviderSettings | null; diagnostics: Diagnostic[] } {
  const diags = validateProviderConfig(config);
  const unknown = Object.entries(config ?? {}).filter(([, v]) => isUnknown(v));

  for (const [key] of unknown)
    diags.push(
      attributeError(
        key,
        'Provider configuration not known yet',
        'The Loadweaver provider needs its configuration during planning; it must not depend on resources that are created in the same run.',
      ),
    );

  const endpointSource = str(config, 'endpoint') ? 'endpoint' : 'LOADWEAVER_URL';
  const endpoint = str(config, 'endpoint') ?? env['LOADWEAVER_URL'] ?? null;
  const insecureHttp = config?.['insecure_http'] === true;
  const token = str(config, 'token') ?? env['LOADWEAVER_TOKEN'] ?? null;

  if (!endpoint)
    diags.push(
      attributeError('endpoint', 'Missing endpoint', 'Set `endpoint` in the provider block or `LOADWEAVER_URL`.'),
    );
  else if (!HTTP_URL.test(endpoint))
    diags.push(attributeError('endpoint', 'Invalid endpoint', `"${endpoint}" is not an http(s) URL.`));
  else if (/^http:/i.test(endpoint)) {
    // An http:// `endpoint` attribute without the flag was already reported by validateProviderConfig.
    if (!insecureHttp) {
      if (endpointSource === 'LOADWEAVER_URL') diags.push(insecureEndpointError(endpointSource));
    } else
      diags.push({
        severity: 2,
        summary: 'Insecure endpoint',
        detail: `${endpointSource} uses plain http:// with \`insecure_http = true\`: the access token is sent unencrypted. Use https:// outside local development.`,
        attribute: { steps: [{ attribute_name: 'insecure_http' }] },
      });
  }

  if (!token)
    diags.push(
      attributeError(
        'token',
        'Missing token',
        'Set `token` in the provider block or `LOADWEAVER_TOKEN` (a personal access token from the console or `loadweaver login`).',
      ),
    );

  const caValue = str(config, 'ca_certificate');
  const caEnv = env['LOADWEAVER_CA_CERT'];
  const caCertificate = caValue
    ? readCa(caValue, 'ca_certificate', diags)
    : caEnv
      ? readCa(caEnv, 'LOADWEAVER_CA_CERT', diags)
      : null;
  const duration = (key: string, fallback: number) => {
    const v = str(config, key);

    return v === null ? fallback : (parseDuration(v) ?? fallback);
  };
  const bool = (key: string, fallback: boolean) => {
    const v = config?.[key];

    return typeof v === 'boolean' ? v : fallback;
  };

  if (diags.some((d) => d.severity === 1) || !endpoint || !token) return { settings: null, diagnostics: diags };

  return {
    settings: {
      endpoint,
      token,
      project: str(config, 'project') ?? (env['LOADWEAVER_PROJECT'] || null),
      caCertificate,
      approvalTimeoutMs: duration('approval_timeout', 30 * 60_000),
      applyTimeoutMs: duration('apply_timeout', 15 * 60_000),
      pollIntervalMs: Math.max(duration('poll_interval', 5_000), 50),
      confirmPins: bool('confirm_pins', false),
      dryRun: bool('dry_run', true),
    },
    diagnostics: diags,
  };
}
