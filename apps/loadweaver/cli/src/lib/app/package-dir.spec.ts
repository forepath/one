import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseManifest } from '@forepath/loadweaver/shared/util-app-catalog';

import {
  dryRunParameters,
  initPackage,
  lintPackageFiles,
  readPackageDir,
  scaffoldFiles,
  SCAFFOLD_IMAGE,
  validatePackage,
} from './package-dir';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function withDependency() {
  return {
    manifest: `apiVersion: apps.loadweaver.com/v1
name: wiki
version: 1.0.0
title: Wiki
description: A wiki.
publisher: Acme
license: MIT
homepage: https://example.com
docs: https://example.com/docs
parameters:
  type: object
  properties:
    domain: { type: string, examples: [wiki.example.com] }
    bundlePostgres: { type: boolean, default: true }
    dbHost: { type: string, default: postgres }
  required: [domain]
secrets:
  - { name: db-password, description: Database password }
dependencies:
  - name: postgres
    bundled: { parameter: bundlePostgres, services: [postgres], volumes: [pgdata] }
    provided: { parameters: [dbHost] }
`,
    compose: `services:
  web:
    image: ghcr.io/acme/wiki:1.0.0@${DIGEST}
    environment:
      DB_HOST: \${dbHost}
      DB_PASSWORD_FILE: /run/secrets/db-password
    secrets: [db-password]
    depends_on: [postgres]
    x-loadweaver:
      exposure: { http: [{ host: '\${domain}', port: 8080 }] }
  postgres:
    image: postgres:17@${DIGEST}
    volumes: [pgdata:/var/lib/postgresql/data]
volumes:
  pgdata: {}
secrets:
  db-password:
    x-loadweaver-ref: \${secret:db-password}
`,
    readme: '# Wiki\n',
  };
}

describe('lw app: package folders', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-app-pkg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('scaffolds a package that validates and lints clean', async () => {
    const written = await initPackage('my-app', join(dir, 'my-app'), { publisher: 'Me' });

    expect(written).toHaveLength(3);

    const files = await readPackageDir(join(dir, 'my-app'));

    expect(files.compose).toContain(SCAFFOLD_IMAGE);
    expect(validatePackage(files).errors).toEqual([]);
    expect(lintPackageFiles(files).filter((f) => f.severity === 'error')).toEqual([]);
    expect(parseManifest(files.manifest).ok).toBe(true);
  });

  it('refuses invalid names and existing files', async () => {
    await expect(initPackage('My_App', join(dir, 'x'))).rejects.toThrow('invalid app name');
    await initPackage('app', join(dir, 'app'));
    await expect(initPackage('app', join(dir, 'app'))).rejects.toThrow('already exists');
  });

  it('names a missing package file', async () => {
    await writeFile(join(dir, 'manifest.yaml'), 'x');
    await expect(readPackageDir(dir)).rejects.toThrow('compose.yaml is missing');
  });

  it('renders the defaults and every provided dependency through the compose parser', () => {
    const result = validatePackage(withDependency());

    expect(result.errors).toEqual([]);
    expect(result.variants.map((v) => v.name)).toEqual(['defaults', 'postgres provided']);
    expect(result.variants[0].compose).toMatch(/host: '?wiki\.example\.com/);
    expect(result.variants[0].compose).toContain('secret://app-dry-run/db-password');
    expect(result.variants[1].compose).not.toContain('postgres:17');
    expect(result.variants[1].compose).not.toContain('depends_on');
  });

  it('drops conditional secrets that are off (a dry-run reference is given for every secret), renders each condition on', () => {
    const files = withDependency();

    files.manifest = files.manifest
      .replace(
        '    dbHost: { type: string, default: postgres }\n',
        '    dbHost: { type: string, default: postgres }\n    mailer: { type: string, enum: [none, smtp], default: none }\n',
      )
      .replace(
        '  - { name: db-password, description: Database password }\n',
        '  - { name: db-password, description: Database password }\n' +
          '  - { name: smtp-password, description: SMTP password, requiredWhen: { parameter: mailer, equals: smtp } }\n',
      );
    files.compose = files.compose
      .replace('    secrets: [db-password]\n', '    secrets: [db-password, smtp-password]\n')
      .replace(
        '    x-loadweaver-ref: ${secret:db-password}\n',
        '    x-loadweaver-ref: ${secret:db-password}\n  smtp-password:\n    x-loadweaver-ref: ${secret:smtp-password}\n',
      );

    const result = validatePackage(files);

    expect(result.errors).toEqual([]);
    expect(result.variants.map((v) => v.name)).toEqual(['defaults', 'postgres provided', 'mailer = "smtp"']);
    expect(result.variants[0].compose).not.toContain('smtp-password');
    expect(result.variants[1].compose).not.toContain('smtp-password');
    expect(result.variants[2].compose).toContain('secret://app-dry-run/smtp-password');
  });

  it('uses given values over examples, and fails without a value for a required parameter', () => {
    const manifest = parseManifest(withDependency().manifest);

    if (!manifest.ok) throw new Error('fixture');

    expect(dryRunParameters(manifest.value, { domain: 'a.example.org' })).toEqual({ domain: 'a.example.org' });
    expect(dryRunParameters(manifest.value)).toEqual({ domain: 'wiki.example.com' });

    const noExample = withDependency();

    noExample.manifest = noExample.manifest.replace(', examples: [wiki.example.com]', '');
    expect(validatePackage(noExample).errors.join('\n')).toContain('parameter domain is required');
    expect(validatePackage(noExample, { domain: 'w.example.com' }).errors).toEqual([]);
  });

  it('reports unpinned images, an empty README and compose the control plane refuses', () => {
    const files = withDependency();

    files.compose = files.compose
      .replace(`postgres:17@${DIGEST}`, 'postgres:17')
      .replace('    secrets: [db-password]\n', '    secrets: [db-password]\n    env_file: .env\n');
    files.readme = ' ';

    const errors = validatePackage(files).errors.join('\n');

    expect(errors).toContain('postgres: image postgres:17 is not pinned by digest');
    expect(errors).toContain('README.md is empty');
    expect(errors).toContain('env_file is not supported');
  });

  it('reports manifest errors without rendering', () => {
    const files = withDependency();

    files.manifest = files.manifest.replace('license: MIT\n', '');

    const result = validatePackage(files);

    expect(result.errors).toEqual([expect.stringMatching(/^manifest\.yaml: license: /)]);
    expect(result.variants).toEqual([]);
    expect(lintPackageFiles(files)[0]).toMatchObject({ rule: 'manifest', severity: 'error' });
  });

  it('lints policy problems', () => {
    const files = withDependency();

    files.compose = files.compose.replace('  postgres:\n', '  postgres:\n    privileged: true\n');

    const findings = lintPackageFiles(files);

    expect(findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'privileged', severity: 'error' })]),
    );
  });

  it('scaffold files carry the version and publisher', async () => {
    const files = scaffoldFiles('demo', { version: '2.0.0', publisher: 'Demo Inc' });

    expect(files.manifest).toContain('version: 2.0.0');
    expect(files.manifest).toContain('publisher: Demo Inc');
    await writeFile(join(dir, 'x'), files.readme);
    expect(await readFile(join(dir, 'x'), 'utf8')).toContain('# Demo');
  });
});
