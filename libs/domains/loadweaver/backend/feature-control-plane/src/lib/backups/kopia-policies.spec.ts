import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BACKUP_POLICY_DRIFT, BackupSchedulerService } from './backup-scheduler.service';
import { expectedGlobalPolicy, KopiaCli, kopiaPolicyDrift } from './kopia-cli';

/**
 * Kopia policies (user decision 2026-10-27): nodes may write their own source policies (Kopia's `manual` flag for
 * stdin sources); the control plane re-asserts everything else before retention and alerts on drift.
 */
const GLOBAL = {
  retention: { keepLatest: 1000000, keepHourly: 0, keepDaily: 0, keepWeekly: 0, keepMonthly: 0, keepAnnual: 0 },
  files: { ignoreDotFiles: ['.kopiaignore'] },
  scheduling: { runMissed: true },
  compression: { compressorName: 'zstd' },
};
const EMPTY = { retention: {}, files: {}, errorHandling: {}, compression: {}, splitter: {}, actions: {} };

describe('Kopia policy drift', () => {
  it('knows the global setting of the repository servers', () => {
    expect(expectedGlobalPolicy()).toEqual({ retention: GLOBAL.retention, compression: { compressorName: 'zstd' } });
  });

  it("accepts a node's manual flag, flags anything more and a changed global retention", () => {
    expect(
      kopiaPolicyDrift({
        '(global)': GLOBAL,
        'v-app.data@shop:/volume': { ...EMPTY, scheduling: { manual: true } },
        'v-app.logs@shop:/volume': EMPTY,
      }),
    ).toEqual({ sources: [], global: false });

    const drift = kopiaPolicyDrift({
      '(global)': { ...GLOBAL, retention: { ...GLOBAL.retention, keepLatest: 1 } },
      'v-app.data@shop:/volume': { ...EMPTY, retention: { keepLatest: 1 }, scheduling: { manual: true } },
      'v-app.data@shop': { ...EMPTY, actions: { beforeSnapshotRoot: { script: 'x' } } },
    });

    expect(drift.global).toBe(true);
    expect(drift.sources).toEqual([
      { target: 'v-app.data@shop:/volume', policy: { retention: { keepLatest: 1 }, scheduling: { manual: true } } },
      { target: 'v-app.data@shop', policy: { actions: { beforeSnapshotRoot: { script: 'x' } } } },
    ]);
  });

  it('resets drifted source policies to manual only and the global policy to the servers setting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-kopia-policies-'));
    const calls: string[][] = [];
    let imported = '';

    try {
      const cli = new KopiaCli(['kopia']);

      jest.spyOn(cli, 'session').mockImplementation(async (_conn, fn) =>
        fn(
          async (args) => {
            calls.push(args);

            if (args[1] === 'export')
              return JSON.stringify({
                '(global)': { ...GLOBAL, retention: { ...GLOBAL.retention, keepLatest: 3 } },
                'v-app.data@shop:/volume': { ...EMPTY, retention: { keepLatest: 1 }, scheduling: { manual: true } },
              });

            if (args[1] === 'import') imported = await readFile(args[2].replace('--from-file=', ''), 'utf8');

            return '';
          },
          { HOME: dir },
        ),
      );

      const drift = await cli.reassertPolicies({} as never);

      expect(drift.global).toBe(true);
      expect(JSON.parse(imported)).toEqual({ 'v-app.data@shop:/volume': { scheduling: { manual: true } } });
      expect(calls.map((c) => c.slice(0, 3).join(' '))).toEqual([
        'policy export',
        `policy import --from-file=${join(dir, 'policies.json')}`,
        'policy set --global',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('policy re-assert in the backup scheduler', () => {
  function scheduler(drift: { sources: Array<{ target: string; policy: unknown }>; global: boolean }) {
    const reassert = jest.fn(async () => drift);
    const repositories = { cli: { reassertPolicies: reassert }, controlConnection: async () => ({}) };
    const audit = { record: jest.fn(async () => undefined) };
    const metrics = { event: jest.fn(async () => undefined) };
    const svc = new BackupSchedulerService(
      { manager: {} } as never,
      {} as never,
      repositories as never,
      audit as never,
      {} as never,
      {} as never,
      undefined,
      metrics as never,
    );

    return { svc, reassert, audit, metrics };
  }

  it('audits and raises the drift event when it reset something, at most every 10 min unless forced', async () => {
    const { svc, reassert, audit, metrics } = scheduler({
      sources: [{ target: 'v-app.data@shop:/volume', policy: { retention: { keepLatest: 1 } } }],
      global: false,
    });
    const now = new Date('2026-10-27T12:00:00Z');

    await svc.reassertPolicies('project-shop', now);
    expect(audit.record).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'backup.policy-drift-corrected', target: 'backup-repository/project-shop' }),
    );
    expect(metrics.event).toHaveBeenCalledWith(
      BACKUP_POLICY_DRIFT,
      expect.stringContaining('v-app.data@shop:/volume'),
      expect.objectContaining({ entity: 'project-shop' }),
    );

    await svc.reassertPolicies('project-shop', new Date(now.getTime() + 60_000));
    expect(reassert).toHaveBeenCalledTimes(1);
    // Right before snapshots are deleted it always runs.
    await svc.reassertPolicies('project-shop', new Date(now.getTime() + 60_000), true);
    expect(reassert).toHaveBeenCalledTimes(2);
  });

  it('stays quiet without drift', async () => {
    const { svc, audit, metrics } = scheduler({ sources: [], global: false });

    await svc.reassertPolicies('cluster', new Date());
    expect(audit.record).not.toHaveBeenCalled();
    expect(metrics.event).not.toHaveBeenCalled();
  });
});

describe('builtin:backup-policy-drift', () => {
  it('fires per repository for drift events of the last 24 hours', async () => {
    const { AlertService } = await import('../alerts/alert.service');
    const query = jest.fn(async () => [
      { entity: 'project-shop', count: '2', message: 'reset: v-app.data@shop:/volume' },
    ]);
    const service = Object.create(AlertService.prototype) as { dataSource: unknown };

    service.dataSource = { query };

    const findings = await (service as unknown as { backupPolicyDrift(): Promise<unknown[]> }).backupPolicyDrift();

    expect(query.mock.calls[0]).toEqual([expect.stringMatching(/kind = 'backup-policy-drift'.*24 hours/s)]);
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'builtin:backup-policy-drift',
        key: 'project-shop',
        severity: 'critical',
        value: 2,
      }),
    ]);
  });
});
