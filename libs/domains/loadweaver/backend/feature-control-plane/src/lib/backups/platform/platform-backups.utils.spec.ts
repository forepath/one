import { controlPlaneRoleSchema, memberPlatformBackups } from '@forepath/loadweaver/shared/util-agent-protocol';
import { clusterSpecSchema, platformBackupSettings } from '@forepath/loadweaver/shared/util-model';

import type { PlatformRestoreEntity } from './platform-backups.entities';
import { platformBackupsRole, withPlatformBackupSecrets } from './platform-backups.role';
import {
  cloneScope,
  etcdSnapshotName,
  gatewayAccessKeyId,
  gatewaySecret,
  platformGarageKey,
  recoveryTargetTime,
  retentionVictims,
  scheduledRunDue,
  walgBackupsFromKeys,
  walgCommand,
  walgPushedBackup,
  walgRetentionKeys,
  walgTargetKeys,
  walgResult,
} from './platform-backups.utils';
import { grantsAllow } from './platform-object-store';
import { memberPrincipals, gatewayListenAddress } from './s3-gateway.service';

const KEY = 'test-encryption-key';

describe('platform backup schedule and retention math', () => {
  const firstSeen = new Date('2026-10-19T00:00:00Z');

  it('is due once per scheduled time, missed runs collapse into one', () => {
    // Daily 02:00 UTC: not due before the first 02:00 after the kind was first seen.
    expect(scheduledRunDue('0 2 * * *', 'UTC', new Date('2026-10-19T01:59:00Z'), null, firstSeen)).toBeNull();
    expect(scheduledRunDue('0 2 * * *', 'UTC', new Date('2026-10-19T02:00:30Z'), null, firstSeen)).toEqual(
      new Date('2026-10-19T02:00:00Z'),
    );
    // Ran at 02:00:05 → not due again until the next day.
    expect(
      scheduledRunDue(
        '0 2 * * *',
        'UTC',
        new Date('2026-10-19T14:00:00Z'),
        new Date('2026-10-19T02:00:05Z'),
        firstSeen,
      ),
    ).toBeNull();
    // Three days missed → one run, for the latest time.
    expect(
      scheduledRunDue(
        '0 2 * * *',
        'UTC',
        new Date('2026-10-22T09:00:00Z'),
        new Date('2026-10-19T02:00:05Z'),
        firstSeen,
      ),
    ).toEqual(new Date('2026-10-22T02:00:00Z'));
  });

  it('evaluates schedules in the configured time zone', () => {
    // 02:00 in Berlin (CEST, UTC+2) is 00:00 UTC.
    expect(scheduledRunDue('0 2 * * *', 'Europe/Berlin', new Date('2026-10-20T00:00:10Z'), null, firstSeen)).toEqual(
      new Date('2026-10-20T00:00:00Z'),
    );
  });

  it('keeps the newest N and always at least one', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 19, h));
    const entries = [3, 1, 5, 2, 4].map((h) => ({ name: `b${h}`, startedAt: at(h) }));

    expect(retentionVictims(entries, 2).map((e) => e.name)).toEqual(['b1', 'b2', 'b3']);
    expect(retentionVictims(entries, 0).map((e) => e.name)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(retentionVictims(entries, 10)).toEqual([]);
  });

  it('reads the defaults from the cluster spec', () => {
    const spec = clusterSpecSchema.parse({
      network: { podPoolV4: '10.244.0.0/16', servicePoolV4: '10.96.0.0/16' },
      backups: { platform: { etcd: { keep: 10 } } },
    });
    const settings = platformBackupSettings(spec.backups);

    expect(settings.enabled).toBe(true);
    expect(settings.postgres).toEqual({ enabled: true, schedule: '0 2 * * *', keep: 7 });
    expect(settings.etcd.keep).toBe(10);
    expect(() => platformBackupSettings({ platform: { timeZone: 'Mars/Base' } as never })).toThrow();
  });
});

describe('WAL-G helpers', () => {
  it('finds the pushed backup and the catalogued ones', () => {
    expect(walgPushedBackup('INFO: 2026/10/19 10:00:00.1 Wrote backup with name base_000000010000000000000004\n')).toBe(
      'base_000000010000000000000004',
    );
    expect(walgPushedBackup('nothing')).toBeNull();
    expect(
      walgBackupsFromKeys('spilo/c/wal/17/', [
        'spilo/c/wal/17/basebackups_005/base_000000010000000000000004_backup_stop_sentinel.json',
        'spilo/c/wal/17/basebackups_005/base_000000010000000000000004/metadata.json',
        'spilo/c/wal/17/basebackups_005/base_000000010000000000000002_backup_stop_sentinel.json',
        'spilo/c/wal/17/basebackups_005/evil;rm_backup_stop_sentinel.json',
      ]),
    ).toEqual(['base_000000010000000000000002', 'base_000000010000000000000004']);
  });

  it('builds the leader command from constants and a validated data directory only', () => {
    expect(walgCommand('backup-push', '/home/postgres/pgdata/pgroot/data')).toBe(
      `bash -c 'export PGHOST=/var/run/postgresql; envdir /run/etc/wal-e.d/env nice -n 5 wal-g backup-push /home/postgres/pgdata/pgroot/data 2>&1 | tail -c 16000; echo "LW_EXIT=\${PIPESTATUS[0]}"'`,
    );
    expect(() => walgCommand('backup-push', "/data'; rm -rf /")).toThrow('unsafe');
    expect(() => walgCommand('backup-push', '/data/../etc')).toThrow('unsafe');
    expect(walgResult(['a', 'b', 'LW_EXIT=0'])).toEqual({ exitCode: 0, output: 'a\nb' });
    expect(walgResult(['boom'])).toEqual({ exitCode: -1, output: 'boom' });
  });

  it('names clones and recovery targets the way Spilo / Patroni accept them', () => {
    expect(cloneScope('lw-abc', '0f1e2d3c-aaaa-bbbb-cccc-000000000000')).toBe('lw-abc-r0f1e2d3c');
    expect(cloneScope('a'.repeat(63), 'abcdef12')).toHaveLength(63);
    expect(recoveryTargetTime(new Date('2026-10-19T10:00:00.250Z'))).toBe('2026-10-19 10:00:00.250+00:00');
    expect(etcdSnapshotName(new Date('2026-10-19T10:15:00Z'))).toBe('etcd-20261019t101500z');
  });
});

describe('gateway credentials and the member role', () => {
  it('derives stable, distinct credentials per client and member', () => {
    const pg1 = gatewayAccessKeyId(KEY, 'postgres', 'n1');

    expect(pg1).toMatch(/^LWPB[0-9A-F]{24}$/);
    expect(gatewayAccessKeyId(KEY, 'postgres', 'n1')).toBe(pg1);
    expect(gatewayAccessKeyId(KEY, 'postgres', 'n2')).not.toBe(pg1);
    expect(gatewayAccessKeyId(KEY, 'opensearch', 'n1')).not.toBe(pg1);
    expect(gatewayAccessKeyId('other', 'postgres', 'n1')).not.toBe(pg1);
    expect(gatewaySecret(KEY, pg1)).toMatch(/^[0-9a-f]{64}$/);
    expect(platformGarageKey(KEY, 1).accessKeyId).not.toBe(platformGarageKey(KEY, 2).accessKeyId);

    const principals = memberPrincipals(KEY, ['n1', 'n2']);

    expect(principals.size).toBe(4);
    expect(principals.get(pg1)).toMatchObject({ role: 'postgres', node: 'n1', prefix: 'spilo/' });
  });

  it("pushes a fresh member exactly what the agent's bootstrap starts Postgres with (2026-10-27)", () => {
    const env = { ENCRYPTION_KEY: KEY };

    expect(withPlatformBackupSecrets(platformBackupsRole('n1', 'member', undefined, null, env)!, KEY)).toEqual(
      memberPlatformBackups(KEY, 'n1'),
    );
    expect(
      platformBackupsRole('n1', 'member', undefined, null, { ...env, LOADWEAVER_BACKUP_GATEWAY_PORT: '7490' })
        ?.gatewayPort,
    ).toBe(7490);
  });

  it('puts key ids into the desired state and secrets only at push time', () => {
    const env = { ENCRYPTION_KEY: KEY };
    const role = platformBackupsRole('n1', 'member', undefined, null, env);

    expect(role).toMatchObject({ gatewayPort: 7480, bucket: 'lw-platform', region: 'garage' });
    expect(role?.postgres?.secretAccessKey).toBeUndefined();
    expect(platformBackupsRole('w', 'witness', undefined, null, env)).toBeUndefined();
    expect(platformBackupsRole('n1', 'member', { platform: { enabled: false } as never }, null, env)).toBeUndefined();
    expect(platformBackupsRole('n1', 'member', undefined, null, {})).toBeUndefined();

    const pushed = withPlatformBackupSecrets(role!, KEY);

    expect(pushed.postgres?.secretAccessKey).toBe(gatewaySecret(KEY, role!.postgres!.accessKeyId));
    // The agent's strict schema accepts what is sent.
    expect(
      controlPlaneRoleSchema.safeParse({
        role: 'member',
        members: [],
        automaticFailover: false,
        scope: 'lw-abc',
        platformBackups: pushed,
      }).success,
    ).toBe(true);
  });

  it('adds the point-in-time clone only on its member', () => {
    const restore = {
      id: '0f1e2d3c-aaaa-bbbb-cccc-000000000000',
      node: 'n2',
      scope: 'lw-abc-r0f1e2d3c',
      sourceScope: 'lw-abc',
      targetTime: new Date('2026-10-19T10:00:00Z'),
    } as PlatformRestoreEntity;
    const env = { ENCRYPTION_KEY: KEY };

    expect(platformBackupsRole('n1', 'member', undefined, restore, env)?.postgresClone).toBeUndefined();
    expect(platformBackupsRole('n2', 'member', undefined, restore, env)?.postgresClone).toEqual({
      id: restore.id,
      scope: 'lw-abc-r0f1e2d3c',
      sourceScope: 'lw-abc',
      targetTime: '2026-10-19 10:00:00.000+00:00',
      pgPort: 5442,
      apiPort: 8018,
    });
  });

  it('parses the gateway listen address', () => {
    expect(gatewayListenAddress({ LOADWEAVER_BACKUP_GATEWAY_LISTEN: '127.0.0.1:7480' })).toEqual({
      host: '127.0.0.1',
      port: 7480,
    });
    expect(gatewayListenAddress({ LOADWEAVER_BACKUP_GATEWAY_LISTEN: '[::1]:7480' })).toEqual({
      host: '::1',
      port: 7480,
    });
    expect(gatewayListenAddress({ LOADWEAVER_BACKUP_GATEWAY_LISTEN: 'evil' })).toBeNull();
    expect(gatewayListenAddress({})).toBeNull();
  });
});

describe('key-bound delete grants (M6 review L4)', () => {
  const p = 'spilo/c/wal/17/';
  const old = 'base_000000010000000000000004';
  const kept = 'base_000000010000000000000009';
  const keys = [
    `${p}basebackups_005/${old}_backup_stop_sentinel.json`,
    `${p}basebackups_005/${old}/tar_partitions/part_1.tar.br`,
    `${p}basebackups_005/${kept}_backup_stop_sentinel.json`,
    `${p}basebackups_005/${kept}/tar_partitions/part_1.tar.br`,
    `${p}wal_005/000000010000000000000003.br`,
    `${p}wal_005/000000010000000000000004.00000028.backup.br`,
    `${p}wal_005/000000020000000000000008.br`,
    `${p}wal_005/000000010000000000000009.br`,
    `${p}wal_005/00000002.history.br`,
  ];

  it('names only the victim backups and the WAL before the oldest kept backup', () => {
    expect(walgRetentionKeys(p, keys, [old], kept)).toEqual([
      `${p}basebackups_005/${old}_backup_stop_sentinel.json`,
      `${p}basebackups_005/${old}/tar_partitions/part_1.tar.br`,
      `${p}wal_005/000000010000000000000003.br`,
      `${p}wal_005/000000010000000000000004.00000028.backup.br`,
      `${p}wal_005/000000020000000000000008.br`,
    ]);
  });

  it('names a deleted backup and its newer deltas only', () => {
    const delta = `base_00000001000000000000000A_D_${old.slice(5)}`;

    expect(walgTargetKeys(p, [...keys, `${p}basebackups_005/${delta}_backup_stop_sentinel.json`], old)).toEqual([
      `${p}basebackups_005/${old}_backup_stop_sentinel.json`,
      `${p}basebackups_005/${old}/tar_partitions/part_1.tar.br`,
      `${p}basebackups_005/${delta}_backup_stop_sentinel.json`,
    ]);
  });

  it('allows deletes only of granted keys (prefix-wide grants stay prefix-wide)', () => {
    const bound = [{ prefix: p, keys: [`${p}wal_005/000000010000000000000003.br`] }];

    expect(grantsAllow(bound, [`${p}wal_005/000000010000000000000003.br`])).toBe(true);
    expect(grantsAllow(bound, [`${p}wal_005/000000010000000000000009.br`])).toBe(false);
    expect(grantsAllow(bound, [])).toBe(false);
    expect(grantsAllow([{ prefix: 'opensearch/c/', keys: null }], ['opensearch/c/indices/x'])).toBe(true);
    expect(grantsAllow([{ prefix: 'opensearch/c/', keys: null }], ['opensearch/d/x'])).toBe(false);
  });
});
