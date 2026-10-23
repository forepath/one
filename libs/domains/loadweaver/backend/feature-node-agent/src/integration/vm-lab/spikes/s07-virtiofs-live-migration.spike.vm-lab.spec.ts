import { randomBytes, randomUUID } from 'node:crypto';

import type { MigrationProgress } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  eventually,
  genericMicrovm,
  inspectHubImage,
  LAUNCHER_IMAGE,
  type NodeDriver,
  podNetwork,
  sleep,
} from '../m7/m7-lab';

import { type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S7 — virtio-fs live migration: QEMU 10 (vhost-user-fs `migration=internal`) + virtiofsd 1.13
 * (`--migration-mode=find-paths`) move a generic microVM live — the guest keeps its open file handles on the virtio-fs
 * root and its process — instead of stop-and-copy. Needs the nodes to report `microvmMigration` (launcher labels).
 */
const rec = spikeRecorder({
  id: 'S7',
  title: 'virtio-fs state migration of generic microVMs',
  validates:
    'M7.4 eligibility: generic microVMs `vm-live` only with LOADWEAVER_MICROVM_LIVE_MIGRATION=on (default off) — this spike decides whether it can be turned on',
  ifFails:
    'keep LOADWEAVER_MICROVM_LIVE_MIGRATION off: generic microVMs move by short stop (filesystem volumes always), bundled ones by fallback; revisit with newer QEMU / virtiofsd',
});

describe('spike S7: virtio-fs live migration', () => {
  let s: SpikeLab;

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [
        { name: 'vm1', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 6 },
        { name: 'vm2', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 6 },
      ],
      packages: ['attr'],
      certs: true,
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('migrates a generic microVM live with an open file on its virtio-fs root', async () => {
    if (!s.nested) return;

    const [vm1] = s.vms;
    const [n1, n2] = s.drivers as [NodeDriver, NodeDriver];

    rec.note(
      'launcher labels',
      (await vm1.exec(`docker inspect -f '{{json .Config.Labels}}' ${LAUNCHER_IMAGE}`)).trim(),
    );

    const caps = await Promise.all([n1.capabilities(), n2.capabilities()]);
    const supported = caps.every((c) => c['microvmMigration'] === true);

    if (
      !rec.verdict(
        'both nodes report microvmMigration (QEMU ≥ 10, virtiofsd ≥ 1.13, generic mode)',
        supported,
        JSON.stringify(caps.map((c) => c['microvmMigration'])),
      )
    )
      return expect(supported).toBe(true);

    const alpine = await inspectHubImage('alpine:3.22');
    const spec = genericMicrovm({ id: 'spike/s7/mv/0', addresses: ['10.244.1.20'] }, alpine, {
      process: {
        entrypoint: ['/bin/sh', '-c'],
        // A counter appending to a file it keeps open (fd 3) on the virtio-fs root.
        cmd: ['exec 3>>/root/counter; i=0; while true; do i=$((i+1)); echo $i >&3; echo "tick $i"; sleep 0.2; done'],
      },
    });

    await n1.apply({ workloads: [spec], network: podNetwork('10.244.1.0/24') });
    await n2.apply({ workloads: [], network: podNetwork('10.244.1.0/24') });

    const source = await eventually(
      'source launcher',
      async () => (await n1.containerOf(spec.id)) || undefined,
      300_000,
      2_000,
    );

    await eventually(
      'ticking',
      async () => ((await vm1.exec(`docker logs ${source} 2>&1 | tail -n1`)).includes('tick') ? true : undefined),
      300_000,
      1_000,
    );
    await sleep(3_000);

    const migration = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const base = { migration, attempt: 1, replica: spec.id };
    const progress = (driver: NodeDriver, phase: string) =>
      eventually(
        phase,
        async () =>
          (await driver.messages(0))
            .filter((m) => m.type === 'migrationProgress')
            .map((m) => m.payload as MigrationProgress)
            .filter((p) => p.migration === migration && p.phase === phase && p.status !== 'running')
            .pop(),
        600_000,
        500,
      );

    await n2.migration('vmMigrationPrepare', {
      ...base,
      source: 'vm1',
      token,
      addresses: spec.addresses,
      volumes: [],
      expiresInSeconds: 900,
      spec,
    });

    const prepared = await progress(n2, 'prepare');

    if (!rec.verdict('target prepared an incoming generic microVM', prepared.status === 'done', prepared.error ?? ''))
      return expect(prepared.status).toBe('done');

    await n1.migration('vmMigrationStart', {
      ...base,
      target: 'vm2',
      endpoint: prepared.endpoint,
      token,
      downtimeLimitMs: 3000,
      maxSeconds: 120,
    });

    const precopy = await progress(n1, 'precopy');
    const freeze = precopy.status === 'done' ? await progress(n1, 'freeze') : undefined;

    rec.measure('microVM live migration freeze', freeze?.freezeMs ?? -1, 'ms', 3000);

    if (!rec.verdict('QEMU + virtiofsd migrated the microVM', precopy.status === 'done', precopy.error ?? '')) {
      await n2.migration('migrationAbort', { ...base, role: 'target', reason: 'spike', volumes: [] });
      await n1.migration('migrationAbort', { ...base, role: 'source', reason: 'spike', volumes: [] });

      return expect(precopy.status).toBe('done');
    }

    await progress(n2, 'restore');
    await n1.migration('migrationCommit', { ...base, role: 'source' });
    await n2.migration('migrationCommit', { ...base, role: 'target' });
    await sleep(3_000);

    const target = await n2.containerOf(spec.id);
    const counter = await n2.exec(spec.id, [
      '/bin/sh',
      '-c',
      'tail -n 3 /root/counter; ls -l /proc/1/fd/3 2>/dev/null || true',
    ]);
    const numbers = counter.text
      .trim()
      .split('\n')
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);

    rec.note('target counter tail', counter.text.trim());
    rec.verdict(
      'the same process continues (counter continues, no restart from 1)',
      numbers.length > 0 && numbers[numbers.length - 1] > 20,
    );
    rec.verdict('target launcher runs', Boolean(target));
    expect(rec.verdicts.every((v) => v.pass)).toBe(true);
  });
});
