import {
  APP_ANNOTATIONS,
  appAnnotations,
  installedAppOf,
  APP_BACKUP_BEFORE_UPDATE_ANNOTATION,
  backupBeforeUpdateOf,
} from './app-store';
import { clusterSpecSchema } from './infrastructure';
import { parseResource, resourceJsonSchema } from '../resource';

const KEY = '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\n';
const network = { podPoolV4: '10.0.0.0/8', servicePoolV4: '10.96.0.0/12' };
const app = {
  catalog: 'official',
  name: 'wiki',
  version: '1.2.0',
  channel: 'stable',
  digest: `sha256:${'a'.repeat(64)}`,
};

describe('app store in the cluster spec (P1)', () => {
  it('is optional and validated by the shared app store schema', () => {
    expect(clusterSpecSchema.parse({ network }).appStore).toBeUndefined();

    const spec = clusterSpecSchema.parse({
      network,
      appStore: {
        catalogs: [
          { name: 'official', type: 'oci', url: 'oci://ghcr.io/forepath/loadweaver-apps', official: true },
          { name: 'acme', type: 'git', url: 'https://git.example.com/acme/apps.git', ref: 'main', publicKey: KEY },
          { name: 'fleet', type: 'fleet', url: 'https://fleet.example.com', enabled: true },
        ],
      },
    });

    expect(spec.appStore?.allowedTrust).toEqual(['official', 'verified']);
    expect(spec.appStore?.catalogs.map((c) => [c.name, c.enabled])).toEqual([
      ['official', false],
      ['acme', false],
      ['fleet', true],
    ]);
    expect(spec.appStore?.catalogs[1]?.publicKeys).toEqual([KEY]);
  });

  it('refuses invalid catalogs', () => {
    const ok = (appStore: unknown) => clusterSpecSchema.safeParse({ network, appStore }).success;

    expect(ok({ catalogs: [{ name: 'x', type: 'git', url: 'https://g.example.com/r.git' }] })).toBe(false);
    expect(ok({ catalogs: [{ name: 'x', type: 'oci', url: 'https://ghcr.io/x', publicKey: KEY }] })).toBe(false);
    expect(ok({ allowedTrust: ['bogus'] })).toBe(false);
    expect(ok({ unknown: true })).toBe(false);
  });

  it('is part of the published JSON Schema', () => {
    expect(JSON.stringify(resourceJsonSchema('Cluster'))).toContain('appStore');
  });
});

describe('installed app annotations (P1)', () => {
  it('round-trips through annotations and survives resource parsing', () => {
    const annotations = appAnnotations(app);

    expect(installedAppOf(annotations)).toEqual(app);

    const parsed = parseResource({
      apiVersion: 'loadweaver.com/v1',
      kind: 'Deployment',
      metadata: { name: 'wiki', project: 'shop', annotations },
      spec: { compose: 'services: {}\n' },
    });

    expect(parsed.ok && installedAppOf(parsed.resource.metadata.annotations)).toEqual(app);
  });

  it('ignores resources without a complete, valid record', () => {
    expect(installedAppOf(undefined)).toBeNull();
    expect(installedAppOf({})).toBeNull();
    expect(installedAppOf({ ...appAnnotations(app), [APP_ANNOTATIONS.digest]: 'nope' })).toBeNull();
  });
});

describe('backup before update marker (P1)', () => {
  it('reads the marker; invalid or empty ones are ignored', () => {
    const read = (value: string) => backupBeforeUpdateOf({ [APP_BACKUP_BEFORE_UPDATE_ANNOTATION]: value });

    expect(read('{"version":"1.2.0","volumes":["pgdata","../x"]}')).toEqual({ version: '1.2.0', volumes: ['pgdata'] });
    expect(read('{"version":"1.2.0","volumes":[]}')).toBeNull();
    expect(read('not json')).toBeNull();
    expect(backupBeforeUpdateOf(undefined)).toBeNull();
  });
});
