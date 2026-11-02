import { APP_BACKUP_BEFORE_UPDATE_ANNOTATION, appAnnotations } from '@forepath/loadweaver/shared/util-model';

import {
  backupPhaseOutcome,
  backupProgress,
  preApplyBackupTimeoutMs,
  preApplyBackupVolumes,
  volumeBackupChanges,
  volumeBackupIssues,
  volumeBackupsOf,
  volumeBackupWarnings,
} from './pre-apply-backups.utils';

/** Backups before applying (P1: app updates, uninstall with a final backup): which volumes, where the phase stands. */
describe('backups before applying (P1)', () => {
  const app = (version: string) =>
    appAnnotations({ catalog: 'acme', name: 'wiki', version, channel: 'stable', digest: `sha256:${'a'.repeat(64)}` });
  const marker = (version: string, volumes: string[]) => ({
    [APP_BACKUP_BEFORE_UPDATE_ANNOTATION]: JSON.stringify({ version, volumes }),
  });
  const update = (before: Record<string, string>, after: Record<string, string>) => ({
    action: 'update' as const,
    kind: 'Deployment',
    name: 'wiki',
    project: 'shop',
    before: { annotations: before },
    after: { annotations: after },
  });
  const existing = new Set(['shop/wiki/pgdata', 'shop/wiki/data']);

  it('backs up the marked volumes of an app version change (existing ones only)', () => {
    expect(
      preApplyBackupVolumes(
        [update(app('1.0.0'), { ...app('1.2.0'), ...marker('1.2.0', ['pgdata', 'data', 'gone']) })],
        existing,
      ),
    ).toEqual(['shop/wiki/data', 'shop/wiki/pgdata']);
  });

  it('backs up nothing without a marker for the new version, for other edits or other kinds', () => {
    // No marker (no declared backups / backup: skip).
    expect(preApplyBackupVolumes([update(app('1.0.0'), app('1.2.0'))], existing)).toEqual([]);
    // A later edit of the updated deployment keeps the old marker: same version, no backup.
    expect(
      preApplyBackupVolumes(
        [
          update(
            { ...app('1.2.0'), ...marker('1.2.0', ['pgdata']) },
            { ...app('1.2.0'), ...marker('1.2.0', ['pgdata']) },
          ),
        ],
        existing,
      ),
    ).toEqual([]);
    // A rollback to a version the marker doesn't name.
    expect(
      preApplyBackupVolumes([update(app('1.2.0'), { ...app('1.0.0'), ...marker('1.2.0', ['pgdata']) })], existing),
    ).toEqual([]);
    expect(
      preApplyBackupVolumes(
        [{ ...update(app('1.0.0'), { ...app('1.2.0'), ...marker('1.2.0', ['pgdata']) }), action: 'create' as const }],
        existing,
      ),
    ).toEqual([]);
  });

  it('backs up the listed volumes of a deleted deployment (uninstall with a final backup), existing ones only', () => {
    const remove = {
      action: 'delete' as const,
      kind: 'Deployment',
      name: 'wiki',
      project: 'shop',
      before: {},
      after: null,
    };
    const placements = [
      { id: 'shop/wiki/pgdata', primaryNode: 'n1', syncReplicas: ['n2'], remoteReplicas: [], sizeBytes: '1024' },
    ];
    const listed = volumeBackupChanges(['shop/wiki/pgdata', 'shop/wiki/gone'], placements as never);

    expect(listed).toEqual({
      changes: [{ action: 'backup-volume', volume: 'shop/wiki/pgdata', nodes: ['n1', 'n2'], sizeBytes: 1024 }],
      missing: ['shop/wiki/gone'],
    });
    expect(volumeBackupWarnings(listed.changes)[0]).toMatchObject({ level: 'info', volume: 'shop/wiki/pgdata' });
    expect(volumeBackupIssues(['shop/wiki/pgdata'], [remove])).toEqual([]);
    expect(volumeBackupIssues(['shop/other/pgdata', 'bad', 'shop/wiki/pgdata', 'shop/wiki/pgdata'], [remove])).toEqual([
      'volume shop/other/pgdata: a backup before applying is listed only for volumes of a deployment the plan deletes (Deployment shop/other)',
      'volume bad: not <project>/<deployment>/<volume>',
      'volume shop/wiki/pgdata is listed twice',
    ]);

    const workloadChanges = [
      ...(listed.changes as unknown as Record<string, unknown>[]),
      { action: 'backup-volume', volume: 'shop/wiki/data', nodes: [], sizeBytes: 0 },
      { action: 'backup-volume', volume: 'shop/wiki/missing', nodes: [], sizeBytes: 0 },
      { action: 'delete-volume', volume: 'shop/wiki/other', nodes: [], sizeBytes: 0 },
    ];

    expect(volumeBackupsOf(workloadChanges).map((c) => c.volume)).toEqual([
      'shop/wiki/pgdata',
      'shop/wiki/data',
      'shop/wiki/missing',
    ]);
    expect(preApplyBackupVolumes([remove], existing, workloadChanges)).toEqual(['shop/wiki/data', 'shop/wiki/pgdata']);
    expect(preApplyBackupVolumes([remove], existing)).toEqual([]);
  });

  it('tracks the phase: starting, running, succeeded, failed, timed out', () => {
    const started = new Date(Date.now() - 1_000).toISOString();
    const progress = (backups: Record<string, string | null>) => ({ backups, startedAt: started });
    const now = Date.now();

    expect(backupPhaseOutcome(progress({ a: null, b: 'b1' }), [], now, 60_000)).toEqual({
      state: 'failed',
      failure: 'the backup before applying failed (b: the backup record is gone)',
    });
    expect(
      backupPhaseOutcome(progress({ a: null, b: 'b1' }), [{ id: 'b1', status: 'running', error: null }], now, 60_000),
    ).toEqual({ state: 'starting', missing: ['a'] });
    expect(
      backupPhaseOutcome(
        progress({ a: 'a1', b: 'b1' }),
        [
          { id: 'a1', status: 'succeeded', error: null },
          { id: 'b1', status: 'running', error: null },
        ],
        now,
        60_000,
      ),
    ).toEqual({ state: 'running', done: 1, total: 2 });
    expect(
      backupPhaseOutcome(
        progress({ a: 'a1' }),
        [{ id: 'a1', status: 'succeeded', error: null }],
        now + 3_600_000,
        60_000,
      ),
    ).toEqual({ state: 'succeeded' });
    expect(
      backupPhaseOutcome(
        progress({ a: 'a1' }),
        [{ id: 'a1', status: 'failed', error: 'kopia: no space' }],
        now,
        60_000,
      ),
    ).toEqual({ state: 'failed', failure: 'the backup before applying failed (a: kopia: no space)' });
    expect(
      backupPhaseOutcome(progress({ a: 'a1' }), [{ id: 'a1', status: 'running', error: null }], now + 120_000, 60_000),
    ).toEqual({ state: 'failed', failure: 'the backup before applying did not finish within 1 minutes' });
  });

  it('starts the phase with every volume pending; timeout from the environment', () => {
    expect(backupProgress(['shop/wiki/pgdata'], 7, 'u1')).toMatchObject({
      phase: 'backup',
      baseRevision: 7,
      targets: null,
      step: 'Backing up before applying: 0 / 1 volume(s)',
      backups: { 'shop/wiki/pgdata': null },
      by: 'u1',
    });
    expect(preApplyBackupTimeoutMs({})).toBe(3_600_000);
    expect(preApplyBackupTimeoutMs({ LOADWEAVER_PRE_UPDATE_BACKUP_TIMEOUT_MINUTES: '5' })).toBe(300_000);
    expect(preApplyBackupTimeoutMs({ LOADWEAVER_PRE_UPDATE_BACKUP_TIMEOUT_MINUTES: '0' })).toBe(3_600_000);
  });
});
