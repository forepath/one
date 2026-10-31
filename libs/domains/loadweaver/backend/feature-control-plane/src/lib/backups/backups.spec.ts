import { scryptSync } from 'node:crypto';

import {
  KOPIA_ACL_RULES,
  kopiaAclChanges,
  kopiaPasswordHash,
  kopiaServerScript,
  parseKopiaAclList,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { backupRetentionSchema } from '@forepath/loadweaver/shared/util-model';
import { generateKey, secretId, splitSecret } from '@forepath/loadweaver/shared/util-secrets';

import { backupServerRole, freeBackupPort } from './backup-server-role';
import {
  backupDataKey,
  combineKit,
  kitShareDocument,
  kitShareText,
  parseKitShare,
  repositoryPassword,
  repositoryUserPassword,
  validateKitSize,
} from './backup-keys.utils';
import {
  applyRetention,
  approvalRefusal,
  backupPins,
  deletionDelayMs,
  deletionDue,
  isoWeek,
  latestScheduled,
  policyVolumes,
  retentionMax,
  retentionShorter,
  volumeCandidates,
  volumeDue,
} from './backup.utils';
import { replicatedEnvironment } from '../services/network-state.service';
import { DR_ENVELOPE_ENV_KEYS, drEnvironment, openDrEnvelope, sealDrEnvelope } from './dr-envelope';
import { BackupsService } from './backups.service';
import { parseKopiaDiff, parseKopiaList } from './kopia-cli';

const retention = (r: Partial<Record<string, number>>) => backupRetentionSchema.parse({ keepLast: 0, ...r });
const at = (iso: string) => new Date(iso);

describe('retention (3.20)', () => {
  const hourly = Array.from({ length: 72 }, (_, i) => ({
    id: `h${i}`,
    time: new Date(Date.UTC(2026, 9, 1, 0) + i * 3_600_000),
  }));

  it('always keeps the newest snapshot, even with an empty retention', () => {
    const keep = applyRetention(hourly, retention({}));

    expect([...keep.keys()]).toEqual(['h71']);
  });

  it('keeps the newest keepLast', () => {
    const keep = applyRetention(hourly, retention({ keepLast: 3 }));

    expect([...keep.keys()].sort()).toEqual(['h69', 'h70', 'h71']);
    expect(keep.get('h71')).toEqual(['keepLast']);
  });

  it('keeps the newest snapshot per day for the given number of days', () => {
    const keep = applyRetention(hourly, retention({ keepLast: 1, daily: 3 }));

    // Days 1, 2, 3 of October: newest of each = 23:00 (h23, h47, h71).
    expect([...keep.keys()].sort()).toEqual(['h23', 'h47', 'h71']);
    expect(keep.get('h71')).toEqual(['keepLast', 'daily']);
  });

  it('counts periods with snapshots only and combines rules (hourly 2 / daily 14 / monthly 12)', () => {
    const snapshots = [
      { id: 'jan', time: at('2026-01-15T03:00:00Z') },
      { id: 'mar', time: at('2026-03-15T03:00:00Z') },
      { id: 'sep-1', time: at('2026-09-01T03:00:00Z') },
      { id: 'sep-30', time: at('2026-09-30T03:00:00Z') },
      { id: 'oct-1a', time: at('2026-10-01T01:00:00Z') },
      { id: 'oct-1b', time: at('2026-10-01T02:00:00Z') },
    ];
    const keep = applyRetention(snapshots, retention({ hourly: 2, daily: 14, monthly: 12 }));

    expect(keep.has('oct-1a')).toBe(true); // hourly
    expect(keep.has('sep-30')).toBe(true); // daily + monthly
    // Periods without snapshots don't count: six snapshot days are all within "daily 14".
    expect(keep.get('sep-1')).toEqual(['daily']);
    expect(keep.get('jan')).toEqual(['daily', 'monthly']);
    expect(keep.get('oct-1a')).toEqual(['hourly']);
  });

  it('weekly uses ISO weeks and yearly the calendar year', () => {
    expect(isoWeek(2026, 1, 1)).toBe('2026-W01');
    expect(isoWeek(2027, 1, 1)).toBe('2026-W53');
    expect(isoWeek(2024, 12, 30)).toBe('2025-W01');

    const keep = applyRetention(
      [
        { id: 'mon', time: at('2026-10-12T10:00:00Z') },
        { id: 'sun', time: at('2026-10-18T10:00:00Z') },
        { id: 'next', time: at('2026-10-19T10:00:00Z') },
        { id: 'y25', time: at('2025-06-01T10:00:00Z') },
      ],
      retention({ weekly: 2, yearly: 2 }),
    );

    expect(keep.has('sun')).toBe(true);
    expect(keep.has('mon')).toBe(false);
    expect(keep.get('y25')).toEqual(['yearly']);
  });

  it('evaluates periods in the policy time zone', () => {
    // 23:30 UTC on Oct 1 is Oct 2 in Berlin: two different days there, one in UTC.
    const snapshots = [
      { id: 'a', time: at('2026-10-01T20:00:00Z') },
      { id: 'b', time: at('2026-10-01T23:30:00Z') },
    ];

    expect(applyRetention(snapshots, retention({ daily: 2 }), 'UTC').has('a')).toBe(false);
    expect(applyRetention(snapshots, retention({ daily: 2 }), 'Europe/Berlin').has('a')).toBe(true);
  });

  it('detects shortening and keeps the longer rules meanwhile', () => {
    const previous = retention({ keepLast: 5, daily: 14 });

    expect(retentionShorter(previous, retention({ keepLast: 5, daily: 30 }))).toBe(false);
    expect(retentionShorter(previous, retention({ keepLast: 2, daily: 30 }))).toBe(true);
    expect(retentionMax(previous, retention({ keepLast: 2, daily: 30 }))).toMatchObject({ keepLast: 5, daily: 30 });
  });
});

describe('policy selection and schedules', () => {
  const volumes = [
    { id: 'a/web/data', project: 'a', deployment: 'web', volume: 'data', deploymentLabels: { tier: 'critical' } },
    { id: 'a/web/cache', project: 'a', deployment: 'web', volume: 'cache', deploymentLabels: { tier: 'critical' } },
    { id: 'b/db/pg', project: 'b', deployment: 'db', volume: 'pg', deploymentLabels: {} },
  ];

  it('project policies only select their own project', () => {
    expect(policyVolumes({ project: 'a', spec: { selector: {} } }, volumes).map((v) => v.id)).toEqual([
      'a/web/data',
      'a/web/cache',
    ]);
    expect(policyVolumes({ project: 'a', spec: { selector: { projects: ['b'] } } }, volumes).map((v) => v.id)).toEqual(
      [],
    );
  });

  it('cluster policies select by project, deployment labels and volume names', () => {
    expect(
      policyVolumes(
        {
          project: null,
          spec: { selector: { deployments: { matchLabels: { tier: 'critical' } }, volumes: ['data'] } },
        },
        volumes,
      ).map((v) => v.id),
    ).toEqual(['a/web/data']);
    expect(policyVolumes({ project: null, spec: { selector: { projects: ['b'] } } }, volumes)).toHaveLength(1);
  });

  it("selects VM disks by their VirtualMachine's labels and name (3.35)", () => {
    const candidates = volumeCandidates(
      [{ id: 'a/web/data' }, { id: 'a/lw-vm/db1.root' }, { id: 'a/lw-vm/db1.data' }, { id: 'a/lw-vm/gone.root' }],
      [
        { kind: 'Deployment', project: 'a', name: 'web', labels: { tier: 'critical' } },
        { kind: 'VirtualMachine', project: 'a', name: 'db1', labels: { app: 'db', tier: 'critical' } },
        { kind: 'VirtualMachine', project: 'b', name: 'db1', labels: { app: 'other' } },
      ],
    );

    expect(candidates).toEqual([
      { id: 'a/web/data', project: 'a', deployment: 'web', volume: 'data', deploymentLabels: { tier: 'critical' } },
      {
        id: 'a/lw-vm/db1.root',
        project: 'a',
        deployment: 'lw-vm',
        volume: 'db1.root',
        deploymentLabels: { app: 'db', tier: 'critical', 'loadweaver.com/vm': 'db1' },
      },
      {
        id: 'a/lw-vm/db1.data',
        project: 'a',
        deployment: 'lw-vm',
        volume: 'db1.data',
        deploymentLabels: { app: 'db', tier: 'critical', 'loadweaver.com/vm': 'db1' },
      },
      {
        id: 'a/lw-vm/gone.root',
        project: 'a',
        deployment: 'lw-vm',
        volume: 'gone.root',
        deploymentLabels: { 'loadweaver.com/vm': 'gone' },
      },
    ]);
    expect(
      policyVolumes(
        { project: 'a', spec: { selector: { deployments: { matchLabels: { 'loadweaver.com/vm': 'db1' } } } } },
        candidates,
      ).map((v) => v.id),
    ).toEqual(['a/lw-vm/db1.root', 'a/lw-vm/db1.data']);
    expect(
      policyVolumes(
        { project: null, spec: { selector: { deployments: { matchLabels: { tier: 'critical' } } } } },
        candidates,
      ).map((v) => v.id),
    ).toEqual(['a/web/data', 'a/lw-vm/db1.root', 'a/lw-vm/db1.data']);
  });

  it('is due once per scheduled time; missed runs collapse', () => {
    const latest = latestScheduled(
      { schedules: ['0 * * * *', '30 2 * * *'], timeZone: 'UTC' },
      at('2026-10-19T02:45:00Z'),
    );

    expect(latest?.toISOString()).toBe('2026-10-19T02:30:00.000Z');
    expect(volumeDue(latest, null)).toBe(true);
    expect(volumeDue(latest, at('2026-10-19T02:00:00Z'))).toBe(true);
    expect(volumeDue(latest, at('2026-10-19T02:30:00Z'))).toBe(false);
    expect(volumeDue(null, null)).toBe(false);
  });
});

describe('deletions: second admin + delay (3.20)', () => {
  const request = { state: 'pending' as const, requestedBy: 'alice', notBefore: at('2026-10-22T12:00:00Z') };

  it('defaults to 72 h, configurable to at least an hour', () => {
    expect(deletionDelayMs({})).toBe(72 * 3_600_000);
    expect(deletionDelayMs({ LOADWEAVER_BACKUP_DELETION_DELAY_HOURS: '1' })).toBe(3_600_000);
    expect(deletionDelayMs({ LOADWEAVER_BACKUP_DELETION_DELAY_HOURS: '0' })).toBe(72 * 3_600_000);
  });

  it('needs an admin who is not the requester', () => {
    expect(approvalRefusal(request, { id: 'alice', admin: true })).toMatch(/second admin/);
    expect(approvalRefusal(request, { id: 'bob', admin: false })).toMatch(/only an admin/);
    expect(approvalRefusal(request, { id: 'bob', admin: true })).toBeNull();
    expect(approvalRefusal({ ...request, state: 'executed' }, { id: 'bob', admin: true })).toMatch(/executed/);
  });

  it('runs only when approved and after the delay', () => {
    expect(deletionDue(request, at('2026-10-23T00:00:00Z'))).toBe(false);
    expect(deletionDue({ ...request, state: 'approved' }, at('2026-10-22T11:59:59Z'))).toBe(false);
    expect(deletionDue({ ...request, state: 'approved' }, at('2026-10-22T12:00:00Z'))).toBe(true);
  });
});

describe('recovery kit (Shamir, 3.20)', () => {
  const root = generateKey();
  const shares = splitSecret(root, 3, 2);
  const docs = shares.map((share) =>
    kitShareDocument({ cluster: 'c1', generation: 1, shares: 3, share, createdAt: at('2026-10-19T00:00:00Z') }),
  );

  it('round-trips any threshold of shares, from the text kit or the JSON', () => {
    expect(combineKit([kitShareText(docs[0]), JSON.stringify(docs[2])], secretId(root)).equals(root)).toBe(true);
    expect(combineKit([docs[1].share, docs[2].share]).equals(root)).toBe(true);
    expect(kitShareText(docs[0])).toContain('share 1 of 3 (any 2 recover the backups)');
  });

  it('refuses a typo (checksum), too few, duplicate and wrong / mixed shares', () => {
    const typo = { ...docs[0], share: docs[0].share.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) };

    expect(() => parseKitShare(JSON.stringify(typo))).toThrow(/checksum/);
    expect(() => combineKit([JSON.stringify(docs[0])])).toThrow(/2 shares are needed/);
    expect(() => combineKit([JSON.stringify(docs[0]), JSON.stringify(docs[0])])).toThrow(/twice/);

    const other = splitSecret(generateKey(), 3, 2);

    expect(() =>
      combineKit([
        docs[0].share,
        kitShareDocument({ cluster: 'c1', generation: 1, shares: 3, share: other[1], createdAt: new Date() }).share,
      ]),
    ).toThrow(/different recovery kits/);
    expect(() => combineKit([docs[0].share, docs[1].share], 'ffffffffffffffff')).toThrow(/another key generation/);

    // A share with the right id but a corrupted value reconstructs a different secret: refused, never returned.
    const corrupted = { ...shares[1], value: Buffer.from(shares[1].value.map((b) => b ^ 0xff)) };
    const corruptedDoc = kitShareDocument({
      cluster: 'c1',
      generation: 1,
      shares: 3,
      share: corrupted,
      createdAt: new Date(),
    });

    expect(() => combineKit([docs[0].share, corruptedDoc.share], secretId(root))).toThrow(/reconstruct/);
  });

  it('validates the kit size', () => {
    expect(() => validateKitSize(3, 2)).not.toThrow();
    expect(() => validateKitSize(1, 1)).toThrow();
    expect(() => validateKitSize(2, 3)).toThrow();
  });

  it('derives stable, scope-separated passwords from the root', () => {
    const data = backupDataKey(root, 1);

    expect(data).toHaveLength(32);
    expect(backupDataKey(root, 2).equals(data)).toBe(false);
    expect(repositoryPassword(data, 'project-a')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repositoryPassword(data, 'project-a')).not.toBe(repositoryPassword(data, 'project-b'));
    expect(repositoryUserPassword(data, 'project-a', 'v-web.data@a')).not.toBe(
      repositoryUserPassword(data, 'project-a', 'v-web.db@a'),
    );
  });
});

describe('recovery kit through a fleet (2026-10-30)', () => {
  const svc = { user: { id: 'svc', amr: ['pat'], scopes: ['fleet:on-behalf-of'] } };
  const person = { person: 'fleet:fleet-test:u1', email: 'alice@example.com' };
  const setup = (caller: Record<string, unknown>) => {
    const keys = {
      reissueKit: jest.fn(async () => ({ generation: 2 })),
      downloadShare: jest.fn(async () => ({ index: 1 })),
      confirmKit: jest.fn(async () => undefined),
    };
    const access = { caller: jest.fn(async () => caller) };
    const service = new BackupsService(
      {} as never,
      access as never,
      keys as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, keys };
  };

  it('refuses the fleet service credential without a verified person', async () => {
    const { service, keys } = setup({ userId: 'svc', isApiKey: false, clusterRole: 'cluster-admin' });

    for (const call of [
      () => service.reissueKit(svc as never, 2, { shares: 3, threshold: 2 }),
      () => service.downloadShare(svc as never, 2, 1),
      () => service.confirmKit(svc as never, 2, ['x', 'y']),
    ])
      await expect(call()).rejects.toThrow(/the recovery kit through a fleet needs a verified fleet identity/);
    expect(keys.reissueKit).not.toHaveBeenCalled();
    expect(keys.downloadShare).not.toHaveBeenCalled();
    expect(keys.confirmKit).not.toHaveBeenCalled();
  });

  it('names the fleet person (not the service user / API key) as the one who handled the kit', async () => {
    const viaPat = { ...svc, fleetIdentity: person };
    const pat = setup({ userId: person.person, isApiKey: false, clusterRole: 'cluster-admin' });

    await pat.service.downloadShare(viaPat as never, 2, 1);
    await pat.service.confirmKit(viaPat as never, 2, ['x', 'y']);
    expect(pat.keys.downloadShare).toHaveBeenCalledWith(2, 1, expect.objectContaining({ label: person.person }));
    expect(pat.keys.confirmKit).toHaveBeenCalledWith(
      2,
      ['x', 'y'],
      expect.objectContaining({ label: person.person, onBehalfOf: person.person }),
    );

    const viaKey = { apiKeyAuthenticated: true, fleetIdentity: person };
    const key = setup({ isApiKey: true, clusterRole: 'cluster-admin' });

    await key.service.downloadShare(viaKey as never, 2, 1);
    expect(key.keys.downloadShare).toHaveBeenCalledWith(
      2,
      1,
      expect.objectContaining({ type: 'api-key', label: person.person, onBehalfOf: person.person }),
    );
  });

  it('keeps native callers as before', async () => {
    const { service, keys } = setup({ userId: 'u1', isApiKey: false, clusterRole: 'cluster-admin' });

    await service.confirmKit({ user: { id: 'u1', amr: ['pwd'] } } as never, 2, ['x', 'y']);
    expect(keys.confirmKit).toHaveBeenCalledWith(2, ['x', 'y'], expect.objectContaining({ label: 'u1' }));
    await expect(
      setup({ userId: 'u2', isApiKey: false, clusterRole: 'auditor' }).service.confirmKit(
        { user: { id: 'u2', amr: ['pwd'] } } as never,
        2,
        [],
      ),
    ).rejects.toThrow(/cluster admins manage backup keys/);
  });
});

describe('DR envelope (3.20)', () => {
  const root = generateKey();
  const keys = {
    current: async () => ({ generation: 3, key: backupDataKey(root, 3) }),
    forGeneration: async (g: number) => backupDataKey(root, g),
  };
  const contents = {
    masterKey: { id: 'abcdef0123456789', value: generateKey() },
    env: drEnvironment({ ENCRYPTION_KEY: 'k', JWT_SECRET: 'j', DB_PASSWORD: 'p', PATH: '/bin', OTHER: 'x' }),
    cluster: { clusterId: 'c1', caCertificate: 'CERT', caPrivateKey: 'KEY' },
  };

  it('carries only the listed environment variables', () => {
    expect(Object.keys(contents.env).sort()).toEqual(['DB_PASSWORD', 'ENCRYPTION_KEY', 'JWT_SECRET']);
    expect(DR_ENVELOPE_ENV_KEYS).toContain('LOADWEAVER_POSTGRES_REPLICATION_PASSWORD');
  });

  it('carries the queue password under the Valkey name and the legacy Redis name (older envelopes)', () => {
    expect(drEnvironment({ VALKEY_PASSWORD: 'v', REDIS_PASSWORD: 'r' })).toEqual({
      VALKEY_PASSWORD: 'v',
      REDIS_PASSWORD: 'r',
    });
  });

  it('carries the admin claim hash and the posture settings to restores and control-plane members', () => {
    const env = {
      ADMIN_CLAIM_TOKEN_SHA256: 'a'.repeat(64),
      DYNAMIC_POSTURE_PLUGINS: '/opt/plugins/acme-mdm.js',
      LOADWEAVER_POSTURE_SYNC_CRON: '*/5 * * * *',
    };

    expect(drEnvironment(env)).toEqual(env);
    expect(replicatedEnvironment(env)).toEqual(env);
  });

  it('carries the email settings (SMTP password included) to restores and control-plane members', async () => {
    const env = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'lw',
      SMTP_PASSWORD: 'smtp-secret',
      EMAIL_FROM: 'Loadweaver <noreply@example.com>',
      EMAIL_COMPANY_NAME: 'Example GmbH',
      EMAIL_COMPANY_ADDRESS_LINE1: 'Street 1',
      EMAIL_COMPANY_POSTAL_CODE: '12345',
      EMAIL_COMPANY_CITY: 'Berlin',
      EMAIL_COMPANY_COUNTRY: 'DE',
      EMAIL_COMPANY_VAT_ID: 'DE123',
      EMAIL_COMPANY_EMAIL: 'info@example.com',
    };

    expect(drEnvironment(env)).toEqual(env);
    expect(replicatedEnvironment(env)).toEqual(env);

    const envelope = await sealDrEnvelope(keys, { ...contents, env: drEnvironment({ ...env, ENCRYPTION_KEY: 'k' }) });

    expect(JSON.stringify(envelope)).not.toContain('smtp-secret');
    expect((await openDrEnvelope(envelope, { root })).env).toEqual({ ...env, ENCRYPTION_KEY: 'k' });
  });

  it('seals under the current generation and opens with the service, the data key or the kit root', async () => {
    const envelope = await sealDrEnvelope(keys, contents, at('2026-10-19T00:00:00Z'));

    expect(envelope).toMatchObject({ format: 'loadweaver-dr-envelope', version: 1, generation: 3 });
    expect(JSON.stringify(envelope)).not.toContain('JWT');

    for (const key of [keys, { dataKey: backupDataKey(root, 3) }, { root }]) {
      const opened = await openDrEnvelope(envelope, key);

      expect(opened.masterKey.value.equals(contents.masterKey.value)).toBe(true);
      expect(opened.env).toEqual(contents.env);
      expect(opened.cluster).toEqual(contents.cluster);
    }
  });

  it('refuses another key and tampering', async () => {
    const envelope = await sealDrEnvelope(keys, contents);

    await expect(openDrEnvelope(envelope, { root: generateKey() })).rejects.toThrow(/cannot be opened/);
    await expect(openDrEnvelope({ ...envelope, createdAt: '2020-01-01T00:00:00.000Z' }, keys)).rejects.toThrow(
      /cannot be opened/,
    );
  });
});

describe('Kopia repository servers (3.20)', () => {
  it('reconciles the ACL to APPEND / READ for nodes (FULL on their own source policies) and FULL for the control plane', () => {
    const current = parseKopiaAclList(
      [
        'id:f23c user:*@* access:APPEND target:type=content',
        'id:c63b user:*@* access:READ target:type=policy,policyType=global',
        'id:6430 user:*@* access:READ target:type=policy,hostname=OWN_HOST,policyType=host',
        'id:82f3 user:*@* access:FULL target:type=policy,hostname=OWN_HOST,username=OWN_USER',
        'id:a2fb user:*@* access:FULL target:type=snapshot,hostname=OWN_HOST,username=OWN_USER',
        'id:a962 user:*@* access:FULL target:type=user,username=OWN_USER@OWN_HOST',
      ].join('\n'),
    );
    const changes = kopiaAclChanges(current);

    // Kopia's default FULL on a user's own policies stays (2026-10-27); snapshots and the user record don't.
    expect(changes.remove.sort()).toEqual(['a2fb', 'a962']);
    expect(changes.add).toEqual(
      expect.arrayContaining([
        { user: '*@*', access: 'APPEND', target: 'type=snapshot,hostname=OWN_HOST,username=OWN_USER' },
        { user: 'control-plane@loadweaver', access: 'FULL', target: 'type=snapshot' },
      ]),
    );
    // The only node rule with FULL is its own source policies; target order doesn't matter.
    expect(KOPIA_ACL_RULES.filter((r) => r.user === '*@*' && r.access === 'FULL').map((r) => r.target)).toEqual([
      'type=policy,hostname=OWN_HOST,username=OWN_USER',
    ]);
    // Existing repositories (READ before 2026-10-27) are migrated by the same reconcile.
    expect(
      kopiaAclChanges(
        parseKopiaAclList('id:b1d0 user:*@* access:READ target:type=policy,hostname=OWN_HOST,username=OWN_USER'),
      ),
    ).toMatchObject({
      remove: ['b1d0'],
      add: expect.arrayContaining([
        { user: '*@*', access: 'FULL', target: 'type=policy,hostname=OWN_HOST,username=OWN_USER' },
      ]),
    });
    expect(
      kopiaAclChanges([
        ...KOPIA_ACL_RULES.map((r, i) => ({ id: String(i), ...r, target: r.target.split(',').reverse().join(',') })),
      ]),
    ).toEqual({ remove: [], add: [] });
  });

  it('keeps secrets out of the server script and hashes user passwords like Kopia (scrypt)', () => {
    const script = kopiaServerScript({
      scope: 'project-a',
      port: 7500,
      s3: { address: '10.93.0.1', port: 3900, bucket: 'lw-backups', prefix: 'project-a/' },
    });

    expect(script).toContain('--prefix=project-a/');
    expect(script).toContain('--user-password-hash="$LW_CONTROL_PASSWORD_HASH"');
    expect(script).not.toMatch(/--password|--access-key|--secret-access-key|--server-control-password/);

    const hash = JSON.parse(Buffer.from(kopiaPasswordHash('pw'), 'base64').toString()) as {
      passwordHashVersion: number;
      passwordHash: string;
    };
    const raw = Buffer.from(hash.passwordHash, 'base64');

    expect(hash.passwordHashVersion).toBe(1);
    expect(
      scryptSync('pw', raw.subarray(0, 32), 32, { N: 65536, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).equals(
        raw.subarray(32),
      ),
    ).toBe(true);
    expect(kopiaPasswordHash('pw')).toBe(kopiaPasswordHash('pw'));
  });

  it('runs every repository on the members, against the active generation', () => {
    const nodes = [
      { name: 'n1', overlayV4: '10.93.0.1', overlayV6: null },
      { name: 'n2', overlayV4: '10.93.0.2', overlayV6: null },
    ];
    const generations = [{ generation: 2, state: 'active' as const, holders: ['n1'] }];
    const repos = [
      { scope: 'project-b', port: 7501, certificate: 'CB' },
      { scope: 'project-a', port: 7500, certificate: 'CA' },
    ];

    expect(backupServerRole(nodes[1], new Set(['n1', 'n2']), nodes, generations, repos)).toEqual({
      repositories: [
        {
          scope: 'project-a',
          port: 7500,
          s3: { address: '10.93.0.1', port: 3900, bucket: 'lw-backups', prefix: 'project-a/' },
          tls: { certificatePem: 'CA' },
        },
        {
          scope: 'project-b',
          port: 7501,
          s3: { address: '10.93.0.1', port: 3900, bucket: 'lw-backups', prefix: 'project-b/' },
          tls: { certificatePem: 'CB' },
        },
      ],
    });
    expect(backupServerRole(nodes[1], new Set(['n1']), nodes, generations, repos)).toBeUndefined();
    expect(backupServerRole(nodes[0], new Set(['n1']), nodes, [], repos)).toBeUndefined();
    expect(freeBackupPort([7500, 7502])).toBe(7501);
  });

  it('parses listings and diffs', () => {
    expect(
      parseKopiaList(
        [
          '-rw-r--r--            8 2026-10-19 12:08:25 UTC 28a14a8551cfa17fa5c8695d18fad45a   a file.txt',
          'drwxr-xr-x       100000 2026-10-19 12:06:58 UTC k4e9847e91fe7f2a0abb44985cc781ad4  sub/',
        ].join('\n'),
      ),
    ).toEqual([
      expect.objectContaining({ name: 'a file.txt', directory: false, size: 8 }),
      expect.objectContaining({ name: 'sub', directory: true, object: 'k4e9847e91fe7f2a0abb44985cc781ad4' }),
    ]);

    const diff = parseKopiaDiff(
      [
        '. modification times differ: x y',
        'changed ./a.txt at 2026-10-19 12:08:25.1 +0000 UTC (size 6 -> 8)',
        'added file ./sub/d.txt (4 bytes)',
        'removed file ./c.txt (6 bytes)',
        'added directory ./new',
      ].join('\n') + '{"fileEntries":{"added":1,"removed":1,"modified":1}}',
    );

    expect(diff.added).toEqual([
      { path: 'sub/d.txt', size: 4, directory: false },
      { path: 'new', size: null, directory: true },
    ]);
    expect(diff.removed).toEqual([{ path: 'c.txt', size: 6, directory: false }]);
    expect(diff.changed).toEqual([{ path: 'a.txt', before: 6, after: 8 }]);
    expect(diff.stats).toMatchObject({ fileEntries: { added: 1 } });
  });
});

describe('backup pins (3.12 / 3.20)', () => {
  it('pins an unconfirmed kit (unless escrowed) and a missing external target, only with policies', () => {
    expect(backupPins({ generation: 1, kitConfirmed: false, escrowed: false }, 0, 0)).toEqual([]);
    expect(backupPins({ generation: 1, kitConfirmed: false, escrowed: false }, 0, 1)).toHaveLength(2);
    expect(backupPins({ generation: 1, kitConfirmed: false, escrowed: true }, 1, 1)).toEqual([]);
    expect(backupPins({ generation: 1, kitConfirmed: true, escrowed: false }, 0, 1)).toEqual([
      expect.stringMatching(/loss of the cluster/),
    ]);
  });
});
