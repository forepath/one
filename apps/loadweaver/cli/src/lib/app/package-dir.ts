import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  APP_NAME_PATTERN,
  findUnpinnedImages,
  lintPackage,
  parseManifest,
  renderCompose,
  type AppManifest,
  type LintFinding,
  type PackageFiles,
} from '@forepath/loadweaver/shared/util-app-catalog';
import { parseCompose } from '@forepath/loadweaver/shared/util-compose';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** Project the dry-run renders into (secret references, private image checks). */
export const DRY_RUN_PROJECT = 'app-dry-run';

/** Reads the three package files of a folder. */
export async function readPackageDir(dir: string): Promise<PackageFiles> {
  const read = async (name: string) => {
    try {
      return await readFile(join(dir, name), 'utf8');
    } catch {
      throw new Error(`${join(dir, name)} is missing`);
    }
  };

  return {
    manifest: await read('manifest.yaml'),
    compose: await read('compose.yaml'),
    readme: await read('README.md'),
  };
}

export interface RenderVariant {
  /** `defaults`, `<dependency> provided` (the bundled toggle switched off) or `<parameter> = <value>` (a secret condition on). */
  name: string;
  parameters: Record<string, unknown>;
  compose?: string;
  errors: string[];
  warnings: string[];
}

export interface ValidationResult {
  manifest?: AppManifest;
  errors: string[];
  warnings: string[];
  variants: RenderVariant[];
}

/**
 * Values for a dry-run render: the given values, then for required parameters without a default the first JSON
 * Schema `examples` entry (publishers give one for every required parameter, so CI can render without input).
 */
export function dryRunParameters(manifest: AppManifest, values: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };

  for (const [name, schema] of Object.entries(manifest.parameters.properties)) {
    if (out[name] !== undefined || schema.default !== undefined) continue;

    const examples = (schema as Record<string, unknown>)['examples'];

    if (Array.isArray(examples) && examples.length > 0) out[name] = examples[0];
  }

  return out;
}

/**
 * Secret references for a dry run: `secret://app-dry-run/<name>` for every declared secret. Conditional secrets whose
 * condition is off are dropped by the renderer, as in an install that was given a reference for them.
 */
export function dryRunSecrets(manifest: AppManifest, project = DRY_RUN_PROJECT): Record<string, string> {
  return Object.fromEntries(manifest.secrets.map((s) => [s.name, `secret://${project}/${s.name}`]));
}

function renderVariant(
  manifest: AppManifest,
  compose: string,
  name: string,
  parameters: Record<string, unknown>,
  project: string,
): RenderVariant {
  const rendered = renderCompose({
    manifest,
    compose,
    parameters,
    secrets: dryRunSecrets(manifest, project),
    coerceStrings: true,
  });

  if (!rendered.ok) return { name, parameters, errors: rendered.errors, warnings: [] };

  // The control plane's own compose parser: what a Deployment with this compose would be planned from.
  const parsed = parseCompose(rendered.value.compose, {
    name: manifest.name,
    project,
    defaultRequests: { cpuMillis: 250, memoryBytes: 256 * 1024 * 1024 },
  });

  return parsed.ok
    ? {
        name,
        parameters,
        compose: rendered.value.compose,
        errors: [],
        warnings: parsed.warnings.map((w) => `${w.path ? `${w.path}: ` : ''}${w.message}`),
      }
    : {
        name,
        parameters,
        errors: parsed.issues
          .filter((i) => i.level === 'error')
          .map((i) => `${i.path ? `${i.path}: ` : ''}${i.message}`),
        warnings: parsed.issues
          .filter((i) => i.level !== 'error')
          .map((i) => `${i.path ? `${i.path}: ` : ''}${i.message}`),
      };
}

/**
 * `lw app validate`: manifest and compose parse, images pinned by digest, and a dry-run install: the compose rendered
 * with the defaults (plus `examples` / given values), once per dependency that can be provided instead of bundled
 * (toggle off) and once per conditional secret's condition switched on, each parsed by the control plane's compose
 * parser (the plan's input). Secrets whose condition is off are left out of the compose, as in an install.
 */
export function validatePackage(
  files: PackageFiles,
  values: Record<string, unknown> = {},
  project = DRY_RUN_PROJECT,
): ValidationResult {
  const manifest = parseManifest(files.manifest);

  if (!manifest.ok) return { errors: manifest.errors.map((e) => `manifest.yaml: ${e}`), warnings: [], variants: [] };

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    parseYaml(files.compose, { maxAliasCount: 100 });

    for (const unpinned of findUnpinnedImages(files.compose))
      errors.push(
        unpinned.image
          ? `compose.yaml: ${unpinned.service}: image ${unpinned.image} is not pinned by digest (@sha256:…)`
          : `compose.yaml: ${unpinned.service} has no image`,
      );
  } catch (error) {
    return {
      manifest: manifest.value,
      errors: [`compose.yaml: ${(error as Error).message.split('\n')[0]}`],
      warnings,
      variants: [],
    };
  }

  if (!files.readme.trim()) errors.push('README.md is empty');

  const base = dryRunParameters(manifest.value, values);
  const variants = [renderVariant(manifest.value, files.compose, 'defaults', base, project)];

  for (const dependency of manifest.value.dependencies) {
    if (!dependency.bundled || !dependency.provided) continue;

    variants.push(
      renderVariant(
        manifest.value,
        files.compose,
        `${dependency.name} provided`,
        {
          ...base,
          [dependency.bundled.parameter]: false,
        },
        project,
      ),
    );
  }

  // Conditional secrets: once per condition switched on (the defaults variant renders them switched off).
  const conditions = new Map<string, Record<string, unknown>>();

  for (const secret of manifest.value.secrets) {
    const condition = secret.requiredWhen;

    if (!condition) continue;

    const value = condition.equals === undefined ? true : condition.equals;

    conditions.set(`${condition.parameter} = ${JSON.stringify(value)}`, { [condition.parameter]: value });
  }

  for (const [name, change] of conditions)
    variants.push(renderVariant(manifest.value, files.compose, name, { ...base, ...change }, project));

  for (const variant of variants) {
    errors.push(...variant.errors.map((e) => `render (${variant.name}): ${e}`));
    warnings.push(...variant.warnings.map((w) => `render (${variant.name}): ${w}`));
  }

  return { manifest: manifest.value, errors, warnings, variants };
}

/**
 * A Deployment resource for a rendered variant (what an install plans): `loadweaver plan -f` takes it, e.g. against a
 * sandbox cluster in the catalog CI.
 */
export function deploymentDocument(manifest: AppManifest, compose: string, project = DRY_RUN_PROJECT): string {
  return stringifyYaml(
    {
      apiVersion: 'loadweaver.com/v1',
      kind: 'Deployment',
      metadata: { name: manifest.name, project },
      spec: { compose },
    },
    { lineWidth: 0 },
  );
}

/** `lw app lint`: `lintPackage` (plus manifest errors as findings when the manifest doesn't parse). */
export function lintPackageFiles(files: PackageFiles): LintFinding[] {
  const manifest = parseManifest(files.manifest);

  if (!manifest.ok) return manifest.errors.map((message) => ({ rule: 'manifest', severity: 'error', message }));

  return lintPackage({ manifest: manifest.value, compose: files.compose });
}

export function formatFinding(finding: LintFinding): string {
  return `${finding.severity.padEnd(7)} ${finding.rule}${finding.path ? ` (${finding.path})` : ''}: ${finding.message}`;
}

/** Digest-pinned image used by `lw app init` (traefik/whoami v1.12.0, Apache-2.0): replace it with your own. */
export const SCAFFOLD_IMAGE =
  'docker.io/traefik/whoami:v1.12.0@sha256:c4717a8d1f0134a7444e24f881160e033991f23027c6c5a9a3f8fd22e70d1d44';

export function scaffoldFiles(name: string, options: { version?: string; publisher?: string } = {}): PackageFiles {
  const version = options.version ?? '0.1.0';
  const publisher = options.publisher ?? 'your-publisher-name';
  const title = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return {
    manifest: `apiVersion: apps.loadweaver.com/v1
name: ${name}
version: ${version}
title: ${title}
description: >-
  One or two sentences: what ${title} does and who it is for.
# Must match a publisher registered in the catalog (publishers/<name>.yaml).
publisher: ${publisher}
# SPDX id or expression; the store lists free / open-source apps only.
license: Apache-2.0
homepage: https://example.com/${name}
docs: https://example.com/${name}/docs
channels: [stable]
parameters:
  type: object
  properties:
    domain:
      type: string
      title: Domain
      description: Public hostname the app is served on.
      format: hostname
      pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      # Used by \`lw app validate\` / CI for the dry-run install.
      examples: [${name}.example.com]
    replicas:
      type: integer
      title: Replicas
      default: 2
      minimum: 1
      maximum: 10
  required: [domain]
secrets: []
healthChecks:
  - service: web
    type: http
    port: 80
    path: /health
`,
    compose: `# Plain Docker Compose with x-loadweaver. Placeholders: \${parameter}, \${secret:name}; $$ is a literal $.
# Images must be pinned by digest.
services:
  web:
    image: ${SCAFFOLD_IMAGE}
    x-loadweaver:
      replicas: \${replicas}
      exposure:
        http:
          - { host: '\${domain}', port: 80 }
`,
    readme: `# ${title}

What the app does, in a few sentences.

## Parameters

| Parameter  | Meaning                                |
| ---------- | -------------------------------------- |
| \`domain\`   | Public hostname the app is served on   |
| \`replicas\` | Number of web replicas (default 2)     |

## After the install

What to do once the app runs (first login, DNS, …).
`,
  };
}

/** `lw app init`: writes a new package folder; refuses to overwrite existing files. */
export async function initPackage(
  name: string,
  dir: string,
  options: { version?: string; publisher?: string } = {},
): Promise<string[]> {
  if (!APP_NAME_PATTERN.test(name)) throw new Error(`invalid app name ${name}: a DNS label (a-z, 0-9, -; max. 63)`);

  const files = scaffoldFiles(name, options);
  const written: [string, string][] = [
    ['manifest.yaml', files.manifest],
    ['compose.yaml', files.compose],
    ['README.md', files.readme],
  ];

  for (const [file] of written) {
    const exists = await access(join(dir, file)).then(
      () => true,
      () => false,
    );

    if (exists) throw new Error(`${join(dir, file)} already exists`);
  }

  await mkdir(dir, { recursive: true });

  for (const [file, content] of written) await writeFile(join(dir, file), content, { flag: 'wx' });

  return written.map(([file]) => join(dir, file));
}
