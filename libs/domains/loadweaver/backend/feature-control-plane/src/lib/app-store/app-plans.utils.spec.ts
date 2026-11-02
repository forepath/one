import { parseManifest, type AppManifest } from '@forepath/loadweaver/shared/util-app-catalog';
import {
  APP_BACKUP_BEFORE_UPDATE_ANNOTATION,
  APP_INSTALL_ANNOTATION,
  APP_PARAMETERS_ANNOTATION,
  APP_SECRETS_ANNOTATION,
  installedAppOf,
  parseResourceDocuments,
} from '@forepath/loadweaver/shared/util-model';
import { parse } from 'yaml';

import {
  addMigrationJobs,
  backupBeforeUpdateVolumes,
  migrationsBetween,
  recordedInputs,
  renderInstall,
} from './app-plans.utils';
import { WIKI_COMPOSE, WIKI_MANIFEST } from './app-store.testing';

const app = { catalog: 'acme', name: 'wiki', version: '1.2.0', channel: 'stable', digest: `sha256:${'c'.repeat(64)}` };

function manifest(version = '1.2.0', text = WIKI_MANIFEST): AppManifest {
  const parsed = parseManifest(text.replace('VERSION', version));

  if (parsed.ok === false) throw new Error(parsed.errors.join('; '));

  return parsed.value;
}

const base = {
  manifest: manifest(),
  compose: WIKI_COMPOSE,
  app,
  project: 'shop',
  deployment: 'wiki',
  parameters: { hostname: 'wiki.example.com' },
  secrets: { 'db-password': 'secret://shop/wiki-db' },
};

function single(document: string) {
  const parsed = parseResourceDocuments(document);

  if (parsed.ok === false || parsed.resources.length !== 1) throw new Error('not one resource');

  return parsed.resources[0];
}

describe('renderInstall (P1 app store)', () => {
  it('renders the Deployment with the app record, the inputs and the rendered compose', () => {
    const result = renderInstall(base);

    if (result.ok === false) throw new Error(result.errors.join('; '));

    const deployment = single(result.value.deployment);

    expect(deployment).toMatchObject({ kind: 'Deployment', metadata: { name: 'wiki', project: 'shop' } });
    expect(installedAppOf(deployment.metadata.annotations)).toEqual(app);
    expect(JSON.parse(deployment.metadata.annotations?.[APP_PARAMETERS_ANNOTATION] ?? '')).toEqual({
      hostname: 'wiki.example.com',
      port: 8080,
      bundlePostgres: true,
    });
    expect(JSON.parse(deployment.metadata.annotations?.[APP_SECRETS_ANNOTATION] ?? '')).toEqual(base.secrets);

    const compose = parse((deployment.spec as { compose: string }).compose);

    expect(compose.services.web.environment).toMatchObject({ HOSTNAME: 'wiki.example.com', PORT: 8080 });
    expect(compose.secrets['db-password']['x-loadweaver-ref']).toBe('secret://shop/wiki-db');
    expect(result.value.parameters.port).toBe(8080);
  });

  it('removes a bundled dependency that is switched off (strings from forms are coerced)', () => {
    const result = renderInstall({ ...base, parameters: { hostname: 'w.example.com', bundlePostgres: 'false' } });

    if (result.ok === false) throw new Error(result.errors.join('; '));

    expect(result.value.removedServices).toEqual(['postgres']);
    expect(
      parse((single(result.value.deployment).spec as { compose: string }).compose).services.postgres,
    ).toBeUndefined();
  });

  it('suggests project resources as separate documents, scoped and marked; cluster kinds are left out', () => {
    const result = renderInstall(base);

    if (result.ok === false) throw new Error(result.errors.join('; '));

    expect(result.value.suggestions.map((s) => [s.group, s.kind, s.name])).toEqual([
      ['groups', 'WorkloadGroup', 'wiki-web'],
      ['backups', 'BackupPolicy', 'wiki-nightly'],
    ]);

    const group = single(result.value.suggestions[0].document);
    const backup = single(result.value.suggestions[1].document);

    expect(group.metadata).toMatchObject({ project: 'shop', annotations: { [APP_INSTALL_ANNOTATION]: 'wiki' } });
    expect(backup.spec).toMatchObject({
      selector: { deployments: { names: ['wiki'] }, volumes: ['pgdata'] },
      schedules: ['@daily'],
    });
    expect(String((backup.spec as { description: string }).description)).toContain('7 days');
    expect(result.value.warnings).toEqual([
      expect.stringContaining('suggestions.dns[0] left out: Cluster is a cluster-level'),
    ]);

    const only = renderInstall({ ...base, include: ['backups'] });

    expect(only.ok && only.value.suggestions.map((s) => s.kind)).toEqual(['BackupPolicy']);
  });

  it('refuses missing parameters / secrets and secrets of another project', () => {
    const missing = renderInstall({ ...base, parameters: {} });

    expect(missing.ok === false && missing.errors).toEqual(expect.arrayContaining(['parameter hostname is required']));

    const noSecret = renderInstall({ ...base, secrets: {} });

    expect(noSecret.ok).toBe(false);

    const foreign = renderInstall({ ...base, secrets: { 'db-password': 'secret://other/db' } });

    expect(foreign.ok === false && foreign.errors[0]).toContain('must name a secret of project shop');
  });

  it('blocks lint errors unless the manifest declares an exception', () => {
    const privileged = WIKI_COMPOSE.replace('    ports: ["8080"]\n', '    ports: ["8080"]\n    privileged: true\n');
    const blocked = renderInstall({ ...base, compose: privileged });

    expect(blocked.ok).toBe(false);
    expect(
      blocked.ok === false && blocked.findings?.some((f) => f.rule === 'privileged' && f.severity === 'error'),
    ).toBe(true);

    const allowed = renderInstall({
      ...base,
      compose: privileged,
      manifest: manifest(
        '1.2.0',
        `${WIKI_MANIFEST}exceptions:\n  - { rule: privileged, service: web, reason: needs raw sockets for the indexer }\n`,
      ),
    });

    expect(allowed.ok).toBe(true);
    expect(allowed.ok && allowed.value.findings.some((f) => f.rule === 'privileged' && f.severity === 'info')).toBe(
      true,
    );
  });

  it('keeps labels, variables and foreign annotations of an existing Deployment on update', () => {
    const result = renderInstall({
      ...base,
      include: [],
      labels: { team: 'docs' },
      variables: { TZ: 'UTC' },
      annotations: { 'example.com/owner': 'docs', [APP_PARAMETERS_ANNOTATION]: '{"old":1}' },
    });
    const deployment = result.ok ? single(result.value.deployment) : null;

    expect(deployment?.metadata.labels).toEqual({ team: 'docs' });
    expect(deployment?.metadata.annotations?.['example.com/owner']).toBe('docs');
    expect(deployment?.metadata.annotations?.[APP_PARAMETERS_ANNOTATION]).not.toContain('old');
    expect((deployment?.spec as { variables?: unknown }).variables).toEqual({ TZ: 'UTC' });
    expect(result.ok && result.value.suggestions).toEqual([]);
  });
});

describe('migrations (P1 app store)', () => {
  it('selects the migrations in (from, to], oldest first', () => {
    const m = manifest();

    expect(migrationsBetween(m, '1.0.0', '1.2.0').map((x) => x.version)).toEqual(['1.1.0', '1.2.0']);
    expect(migrationsBetween(m, '1.1.0', '1.2.0').map((x) => x.version)).toEqual(['1.2.0']);
    expect(migrationsBetween(m, '1.0.0', '1.0.5')).toEqual([]);
  });

  it('adds the steps as one-off jobs in a copy of their service (no ports, no own extensions)', () => {
    const result = addMigrationJobs(WIKI_COMPOSE, [
      { version: '1.1.0', step: { name: 'migrate', service: 'web', command: ['wiki', 'migrate'], phase: 'before' } },
      { version: '1.2.0', step: { name: 'reindex', service: 'web', command: ['wiki', 'reindex'], phase: 'after' } },
    ]);

    if (result.ok === false) throw new Error(result.errors.join('; '));

    const compose = parse(result.compose);
    const job = compose.services['lw-migrate-1-1-0-1'];

    expect(job).toMatchObject({
      image: compose.services.web.image,
      command: ['wiki', 'migrate'],
      restart: 'no',
      volumes: ['data:/data'],
      secrets: ['db-password'],
      'x-loadweaver': { job: { phase: 'before' } },
    });
    expect(job.ports).toBeUndefined();
    expect(job.depends_on).toBeUndefined();
    expect(compose.services['lw-migrate-1-2-0-2']['x-loadweaver']).toEqual({ job: { phase: 'after' } });
    expect(result.compose).not.toContain('*');
  });

  it('refuses a step whose service is not in the rendered compose', () => {
    const result = addMigrationJobs(WIKI_COMPOSE, [
      { version: '1.1.0', step: { name: 'x', service: 'gone', command: ['x'], phase: 'before' } },
    ]);

    expect(result.ok === false && result.errors[0]).toContain('service gone is not part of the rendered compose');
  });

  it('reads the recorded inputs back (and survives garbage)', () => {
    expect(
      recordedInputs({
        [APP_PARAMETERS_ANNOTATION]: '{"a":1}',
        [APP_SECRETS_ANNOTATION]: '{"s":"secret://p/x","n":1}',
      }),
    ).toEqual({ parameters: { a: 1 }, secrets: { s: 'secret://p/x' } });
    expect(recordedInputs({ [APP_PARAMETERS_ANNOTATION]: 'nope' })).toEqual({ parameters: {}, secrets: {} });
  });
});

describe('backup before an update (P1 app store)', () => {
  it('backs up the volumes the declared backups name; a backup without volumes means all; none without backups', () => {
    expect(backupBeforeUpdateVolumes(manifest(), ['data', 'pgdata'])).toEqual(['pgdata']);
    expect(
      backupBeforeUpdateVolumes({ backups: [{ name: 'all', schedule: '@daily', volumes: [] }] }, ['pgdata', 'data']),
    ).toEqual(['data', 'pgdata']);
    expect(backupBeforeUpdateVolumes({ backups: [] }, ['data'])).toEqual([]);
  });

  it('records the marker on the updated Deployment and replaces an old one', () => {
    const marked = single(
      (
        renderInstall({
          ...base,
          annotations: { [APP_BACKUP_BEFORE_UPDATE_ANNOTATION]: '{"version":"1.0.0","volumes":["old"]}', team: 'x' },
          backupBeforeUpdate: { version: '1.2.0', volumes: ['pgdata'] },
        }) as { value: { deployment: string } }
      ).value.deployment,
    );

    expect(marked.metadata.annotations?.[APP_BACKUP_BEFORE_UPDATE_ANNOTATION]).toBe(
      '{"version":"1.2.0","volumes":["pgdata"]}',
    );
    expect(marked.metadata.annotations?.['team']).toBe('x');

    const plain = single(
      (
        renderInstall({
          ...base,
          annotations: { [APP_BACKUP_BEFORE_UPDATE_ANNOTATION]: '{"version":"1.0.0","volumes":["old"]}' },
        }) as { value: { deployment: string } }
      ).value.deployment,
    );

    expect(plain.metadata.annotations?.[APP_BACKUP_BEFORE_UPDATE_ANNOTATION]).toBeUndefined();
  });
});
