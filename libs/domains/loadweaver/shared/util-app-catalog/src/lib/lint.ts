import { isRecord } from './common';
import { composeServices, PINNED_IMAGE_PATTERN, type ComposeService } from './compose-tree';
import { checkLicense } from './licenses';
import { EXCEPTION_RULES, type AppManifest, type ExceptionRule } from './manifest';
import { findPlaceholders } from './render';

export type LintSeverity = 'error' | 'warning' | 'info';

export type LintRule =
  | ExceptionRule
  | 'plaintext-secret'
  | 'unpinned-image'
  | 'license'
  | 'undeclared-reference'
  | 'conditional-secret'
  | 'invalid-placeholder'
  | 'unused-exception'
  | 'manifest'
  | 'compose';

export interface LintFinding {
  rule: LintRule;
  severity: LintSeverity;
  message: string;
  /** Where in the compose / manifest (e.g. `services.web.privileged`). */
  path?: string;
}

/**
 * Service-level compose key for exception reasons (`x-loadweaver-exceptions: { privileged: "<reason>" }`), next to
 * the manifest's `exceptions`. (`x-loadweaver` itself is a strict schema of the compose parser.)
 */
export const SERVICE_EXCEPTIONS_KEY = 'x-loadweaver-exceptions';

/** Environment keys that hold secrets (heuristic): *PASSWORD*, *PASSWD*, *SECRET*, *TOKEN*, a word ending in KEY. */
const SECRET_KEY_PATTERN = /PASSWORD|PASSWD|SECRET|TOKEN|(^|[_.-])[A-Z0-9]*KEY($|[_.-])|[a-z0-9]Key($|[_.-])/i;
const NON_SECRET_VALUE = /^(true|false|yes|no|on|off|\d+(\.\d+)?)$/i;

function isHostPath(source: string): boolean {
  return /^(\/|\.{1,2}(\/|$)|~)/.test(source);
}

function environmentEntries(environment: unknown): [string, unknown][] {
  if (isRecord(environment)) return Object.entries(environment);

  if (!Array.isArray(environment)) return [];

  return environment.flatMap((entry): [string, unknown][] => {
    if (typeof entry !== 'string') return [];

    const eq = entry.indexOf('=');

    return eq < 0 ? [] : [[entry.slice(0, eq), entry.slice(eq + 1)]];
  });
}

/** True when an environment value is a literal (not empty, no placeholder, no secret file path, not a flag / number). */
function isLiteralSecretValue(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return false;

  const text = String(value).trim();

  return text !== '' && !text.includes('${') && !text.startsWith('/run/secrets/') && !NON_SECRET_VALUE.test(text);
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (isRecord(value))
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectStrings(v, out);
    }
}

/** Host-access uses of a service: rule + compose path. */
function hostAccess(name: string, service: ComposeService): { rule: ExceptionRule; path: string; detail: string }[] {
  const base = `services.${name}`;
  const found: { rule: ExceptionRule; path: string; detail: string }[] = [];

  if (service['network_mode'] === 'host')
    found.push({ rule: 'host-network', path: `${base}.network_mode`, detail: 'host networking' });

  if (service['privileged'] === true || service['privileged'] === 'true')
    found.push({ rule: 'privileged', path: `${base}.privileged`, detail: 'a privileged container' });

  if (service['pid'] === 'host')
    found.push({ rule: 'host-pid', path: `${base}.pid`, detail: 'the host PID namespace' });

  if (service['ipc'] === 'host')
    found.push({ rule: 'host-ipc', path: `${base}.ipc`, detail: 'the host IPC namespace' });

  const volumes = Array.isArray(service['volumes']) ? service['volumes'] : [];

  volumes.forEach((volume, i) => {
    const source =
      typeof volume === 'string'
        ? volume.includes(':')
          ? volume.split(':')[0]
          : ''
        : isRecord(volume) &&
            (volume['type'] === 'bind' || volume['type'] === undefined) &&
            typeof volume['source'] === 'string'
          ? volume['source']
          : '';
    const bind = isRecord(volume) && volume['type'] === 'bind';

    if (bind || (source && isHostPath(source)))
      found.push({
        rule: 'host-path',
        path: `${base}.volumes[${i}]`,
        detail: `a host path mount (${source || 'bind'})`,
      });
  });

  return found;
}

/**
 * Policy lint for a package (CLI, CI, control plane at install). Rules:
 * - `host-network` / `privileged` / `host-pid` / `host-ipc` / `host-path`: error unless the manifest's `exceptions`
 *   (or the service's `x-loadweaver-exceptions`) give a reason; then an `info` finding with the reason.
 * - `plaintext-secret`: literal values for environment keys named like secrets (error).
 * - `unpinned-image`: images not pinned by digest (error).
 * - `license`: not a free / OSS SPDX licence (error); `LicenseRef-…` needs human review (warning).
 * - `undeclared-reference` / `invalid-placeholder`: `${…}` the manifest doesn't declare or that isn't supported.
 * - `conditional-secret`: a conditional secret (`requiredWhen`) used outside the compose's top-level `secrets` (an
 *   unset one is left out of the compose, so nothing else may refer to it).
 * - `manifest`: manifest references to compose services / volumes that don't exist.
 * - `unused-exception`: exceptions nothing needs (warning).
 */
export function lintPackage(input: {
  manifest: AppManifest;
  compose: string | Record<string, unknown>;
}): LintFinding[] {
  const { manifest } = input;
  const findings: LintFinding[] = [];
  const parsed = composeServices(input.compose);

  const license = checkLicense(manifest.license);

  if (license.verdict === 'not-free')
    findings.push({
      rule: 'license',
      severity: 'error',
      path: 'manifest.license',
      message: `${manifest.license} is not a free / open-source SPDX licence${license.ids.length ? ` (${license.ids.join(', ')})` : ''}`,
    });
  else if (license.verdict === 'review')
    findings.push({
      rule: 'license',
      severity: 'warning',
      path: 'manifest.license',
      message: `${license.ids.join(', ')} is not an SPDX licence: needs human review (free tiers only)`,
    });

  if (parsed.ok === false) return [...findings, { rule: 'compose', severity: 'error', message: parsed.error }];

  const services = parsed.services;
  const usedExceptions = new Set<number>();

  for (const [name, service] of Object.entries(services)) {
    const base = `services.${name}`;
    const serviceExceptions = isRecord(service[SERVICE_EXCEPTIONS_KEY]) ? service[SERVICE_EXCEPTIONS_KEY] : {};

    for (const access of hostAccess(name, service)) {
      const index = manifest.exceptions.findIndex(
        (e) => e.rule === access.rule && (e.service === undefined || e.service === name),
      );
      const inline = serviceExceptions[access.rule];
      const reason =
        index >= 0
          ? manifest.exceptions[index].reason
          : typeof inline === 'string' && inline.trim().length >= 10
            ? inline.trim()
            : undefined;

      if (index >= 0) usedExceptions.add(index);

      findings.push(
        reason
          ? {
              rule: access.rule,
              severity: 'info',
              path: access.path,
              message: `${name} uses ${access.detail}: ${reason}`,
            }
          : {
              rule: access.rule,
              severity: 'error',
              path: access.path,
              message: `${name} uses ${access.detail} without a declared reason (manifest exceptions)`,
            },
      );
    }

    for (const key of Object.keys(serviceExceptions)) {
      if (!(EXCEPTION_RULES as readonly string[]).includes(key))
        findings.push({
          rule: 'manifest',
          severity: 'error',
          path: `${base}.${SERVICE_EXCEPTIONS_KEY}.${key}`,
          message: `unknown exception rule ${key} (${EXCEPTION_RULES.join(', ')})`,
        });
    }

    const image = typeof service['image'] === 'string' ? service['image'] : '';

    if (!PINNED_IMAGE_PATTERN.test(image))
      findings.push({
        rule: 'unpinned-image',
        severity: 'error',
        path: `${base}.image`,
        message: image ? `${name}: image ${image} is not pinned by digest (@sha256:…)` : `${name} has no image`,
      });

    for (const [key, value] of environmentEntries(service['environment'])) {
      if (/_FILE$/i.test(key) || !SECRET_KEY_PATTERN.test(key) || !isLiteralSecretValue(value)) continue;

      findings.push({
        rule: 'plaintext-secret',
        severity: 'error',
        path: `${base}.environment.${key}`,
        message: `${name}: ${key} has a literal value; use a secret (\${secret:name}) or a parameter`,
      });
    }
  }

  const strings: string[] = [];

  collectStrings(parsed.tree, strings);

  const declaredParameters = manifest.parameters.properties;
  const declaredSecrets = new Set(manifest.secrets.map((s) => s.name));
  const reported = new Set<string>();

  for (const placeholder of strings.flatMap(findPlaceholders)) {
    if (reported.has(placeholder.raw)) continue;

    reported.add(placeholder.raw);

    if (placeholder.kind === 'invalid')
      findings.push({
        rule: 'invalid-placeholder',
        severity: 'error',
        message: `unsupported placeholder ${placeholder.raw} (use \${parameter}, \${secret:name} or $$ for a literal $)`,
      });
    else if (
      placeholder.kind === 'parameter' &&
      !Object.prototype.hasOwnProperty.call(declaredParameters, placeholder.name)
    )
      findings.push({
        rule: 'undeclared-reference',
        severity: 'error',
        message: `${placeholder.raw}: parameter ${placeholder.name} is not declared in the manifest`,
      });
    else if (placeholder.kind === 'secret' && !declaredSecrets.has(placeholder.name))
      findings.push({
        rule: 'undeclared-reference',
        severity: 'error',
        message: `${placeholder.raw}: secret ${placeholder.name} is not declared in the manifest`,
      });
  }

  const conditional = new Set(manifest.secrets.filter((s) => s.requiredWhen).map((s) => s.name));

  if (conditional.size > 0) {
    const outside: { path: string; strings: string[] }[] = [
      ...Object.entries(parsed.tree)
        .filter(([key]) => key !== 'secrets')
        .map(([key, value]) => {
          const found: string[] = [];

          collectStrings(value, found);

          return { path: key, strings: found };
        }),
      ...(['groups', 'policies', 'ingress', 'dns'] as const).flatMap((group) =>
        manifest.suggestions[group].map((doc, i) => {
          const found: string[] = [];

          collectStrings(doc, found);

          return { path: `manifest.suggestions.${group}[${i}]`, strings: found };
        }),
      ),
    ];
    const seen = new Set<string>();

    for (const { path, strings: found } of outside)
      for (const placeholder of found.flatMap(findPlaceholders)) {
        if (
          placeholder.kind !== 'secret' ||
          !conditional.has(placeholder.name) ||
          seen.has(`${path}|${placeholder.raw}`)
        )
          continue;

        seen.add(`${path}|${placeholder.raw}`);
        findings.push({
          rule: 'conditional-secret',
          severity: 'error',
          path,
          message: `${placeholder.raw}: secret ${placeholder.name} is conditional (requiredWhen) and may only be referenced in the top-level secrets section (mount it as a file instead)`,
        });
      }
  }

  const serviceNames = new Set(Object.keys(services));
  const missingService = (service: string, path: string) => {
    if (!serviceNames.has(service))
      findings.push({
        rule: 'manifest',
        severity: 'error',
        path,
        message: `service ${service} is not in compose.yaml`,
      });
  };

  manifest.dependencies.forEach((d, i) =>
    d.bundled?.services.forEach((s, j) => missingService(s, `manifest.dependencies[${i}].bundled.services[${j}]`)),
  );
  manifest.healthChecks.forEach((h, i) => missingService(h.service, `manifest.healthChecks[${i}].service`));
  manifest.migrations.forEach((m, i) =>
    m.steps.forEach((s, j) => missingService(s.service, `manifest.migrations[${i}].steps[${j}].service`)),
  );
  manifest.exceptions.forEach((e, i) => {
    if (e.service !== undefined) missingService(e.service, `manifest.exceptions[${i}].service`);

    if (!usedExceptions.has(i))
      findings.push({
        rule: 'unused-exception',
        severity: 'warning',
        path: `manifest.exceptions[${i}]`,
        message: `exception ${e.rule}${e.service ? ` for ${e.service}` : ''} is not needed`,
      });
  });

  return findings;
}

/** Whether findings block a submission / install (any `error`). */
export function hasLintErrors(findings: readonly LintFinding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}
