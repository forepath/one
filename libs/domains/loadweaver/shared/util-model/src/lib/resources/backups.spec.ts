import { parseResource, resourceJsonSchema } from '../resource';

const doc = (kind: string, spec: unknown, project?: string) => ({
  apiVersion: 'loadweaver.com/v1',
  kind,
  metadata: { name: 'x', ...(project ? { project } : {}) },
  spec,
});
const parse = (kind: string, spec: unknown, project?: string) => parseResource(doc(kind, spec, project));

describe('backup resources (3.20)', () => {
  it('takes policies with schedules, retention, targets and restore tests (defaults filled in)', () => {
    const result = parse(
      'BackupPolicy',
      { schedules: ['0 * * * *'], retention: { daily: 14 }, targets: ['offsite'] },
      'shop',
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.resource.spec).toMatchObject({
      selector: {},
      timeZone: 'UTC',
      retention: { keepLast: 1, hourly: 0, daily: 14, weekly: 0, monthly: 0, yearly: 0 },
      hooks: true,
    });
    expect(parse('BackupPolicy', { schedules: [] }).ok).toBe(false);
    expect(parse('BackupPolicy', { schedules: ['every hour'] }).ok).toBe(false);
    expect(parse('BackupPolicy', { schedules: ['@daily'], timeZone: 'Mars/Base' }).ok).toBe(false);
    expect(parse('BackupPolicy', { schedules: ['@daily'], restoreTest: { schedule: '0 5 * * 0' } }).ok).toBe(true);
  });

  it('takes S3 targets with object lock and SFTP targets with known hosts', () => {
    expect(
      parse('BackupTarget', {
        type: 's3',
        endpoint: 'https://s3.example.com',
        bucket: 'acme-backups',
        credentials: 'secret://ops/s3',
        objectLock: { days: 30 },
      }).ok,
    ).toBe(true);
    expect(
      parse('BackupTarget', { type: 's3', endpoint: 'ftp://x', bucket: 'b-1', credentials: 'secret://o/s' }).ok,
    ).toBe(false);
    expect(
      parse('BackupTarget', {
        type: 'sftp',
        host: 'backup.example.com',
        user: 'lw',
        path: '/srv/backups',
        keySecret: 'secret://ops/key',
        knownHosts: 'backup.example.com ssh-ed25519 AAAA',
      }).ok,
    ).toBe(true);
    expect(
      parse('BackupTarget', {
        type: 'sftp',
        host: 'h',
        user: 'u',
        path: 'relative',
        keySecret: 'secret://o/k',
        knownHosts: 'x'.repeat(20),
      }).ok,
    ).toBe(false);
  });

  it('takes restores of a whole volume or one path, without ..', () => {
    const backup = '6f0c5a4e-3a3b-4c47-9c39-8c3b7f1f2a10';

    expect(parse('Restore', { backup, target: { deployment: 'web', volume: 'data' } }, 'shop').ok).toBe(true);
    expect(
      parse('Restore', { backup, target: { deployment: 'web', volume: 'data', path: 'a/b.txt' } }, 'shop').ok,
    ).toBe(true);
    expect(parse('Restore', { backup, target: { deployment: 'web', volume: 'data', path: '../etc' } }, 'shop').ok).toBe(
      false,
    );
    expect(parse('Restore', { backup: 'nope', target: { deployment: 'web', volume: 'data' } }, 'shop').ok).toBe(false);
  });

  it('publishes JSON Schemas for the editor', () => {
    expect(resourceJsonSchema('BackupPolicy')).toBeTruthy();
    expect(resourceJsonSchema('BackupTarget')).toBeTruthy();
    expect(resourceJsonSchema('Restore')).toBeTruthy();
  });
});
