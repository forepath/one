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

import { type SpikeLab, spikeRecorder, startSpikeLab, stopSpikeLab } from './spike-lab';

/**
 * Spike S7 — virtio-fs live migration (W10b `microvm-live (QEMU)`): QEMU 10 + virtiofsd 1.13 (`--migration-mode`)
 * move a generic microVM live — the guest keeps its process and its open file handles on the virtio-fs root — through
 * the agents' QMP flow (pause-before-switchover, writable-layer passes, relay to the target's incoming socket).
 *
 * Combined gate G3: QEMU 10.0 has no vhost-user-fs `migration` device property (W10b / F5 set `migration=internal`,
 * the domain didn't start); QEMU migrates the vhost-user-fs state on its own when virtiofsd supports it, so the launchers
 * only add the property where QEMU has it.
 */
const rec = spikeRecorder({
  id: 'S7',
  title: 'virtio-fs state migration of generic microVMs',
  validates:
    'M7.4 / W10b: generic microVMs migrate live (`microvm-live (QEMU)`) when both nodes report microvmMigration (QEMU >= 10.0, virtiofsd >= 1.13)',
  ifFails:
    'generic (and bundled) microVMs move by short stop: drop `generic` / `bundled` from the launcher label io.forepath.microvm.migration (nodes then report no microvmMigration) until QEMU / virtiofsd migrate virtio-fs state',
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
    await stopSpikeLab(rec, s);
  }, 300_000);

  it('migrates a generic microVM live with an open file on its virtio-fs root', async () => {
    if (!s.nested) return;

    const [vm1] = s.vms;
    const [n1, n2] = s.drivers as [NodeDriver, NodeDriver];

    rec.note(
      'launcher labels',
      (await vm1.exec(`docker inspect -f '{{json .Config.Labels}}' ${LAUNCHER_IMAGE}`)).trim(),
    );

    // The capability needs a ready microVM level: a fresh isolation probe (boots the probe microVM) on both nodes.
    const reports = await Promise.all([n1.isolation(true), n2.isolation(true)]);

    rec.note(
      'microvm level after the probe',
      reports.map((r) => r.levels.microvm),
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
        // A counter appending to a file it keeps open (fd 3) on the virtio-fs root, and a file in the writable layer.
        cmd: [
          'echo before > /root/written-before; exec 3>>/root/counter; i=0; while true; do i=$((i+1)); echo $i >&3; echo "tick $i"; sleep 0.2; done',
        ],
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

    const t0 = Date.now();

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

    rec.measure('microVM live migration (start → freeze done)', Math.round((Date.now() - t0) / 100) / 10, 's');
    rec.measure('microVM live migration freeze', freeze?.freezeMs ?? -1, 'ms', 3000);

    if (!rec.verdict('QEMU + virtiofsd migrated the microVM', precopy.status === 'done', precopy.error ?? '')) {
      await n2.migration('migrationAbort', { ...base, role: 'target', reason: 'spike', volumes: [] });
      await n1.migration('migrationAbort', { ...base, role: 'source', reason: 'spike', volumes: [] });

      return expect(precopy.status).toBe('done');
    }

    const restore = await progress(n2, 'restore');

    rec.verdict('target restored (guest resumed there)', restore.status === 'done', restore.error ?? '');
    await n1.migration('migrationCommit', { ...base, role: 'source' });
    await n2.migration('migrationCommit', { ...base, role: 'target' });
    await sleep(3_000);

    const target = await n2.containerOf(spec.id);
    const counter = await n2.exec(spec.id, [
      '/bin/sh',
      '-c',
      'tail -n 3 /root/counter; cat /root/written-before; ls -l /proc/1/fd/3 2>/dev/null || true',
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
    rec.verdict('writable-layer file from before the migration is on the target', /before/.test(counter.text));
    rec.verdict('target launcher runs', Boolean(target));
    rec.verdict(
      'source launcher removed after the commit',
      (await vm1.exec(`docker ps -aq --filter label=loadweaver.com/workload=${spec.id} | wc -l`)).trim() === '0',
    );
    expect(rec.verdicts.every((v) => v.pass)).toBe(true);
  });
});
