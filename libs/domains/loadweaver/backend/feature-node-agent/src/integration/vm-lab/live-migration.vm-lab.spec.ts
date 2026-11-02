import { randomBytes, randomUUID } from 'node:crypto';

import {
  migrationAbortSchema,
  migrationCommitSchema,
  migrationFreezeSchema,
  migrationPrecopySchema,
  migrationPrepareSchema,
  migrationRestoreSchema,
  volumeAssignmentSchema,
  workloadSpecSchema,
  type MigrationProgress,
  type MigrationReportPhase,
  type TransferEndpoint,
  type VolumeAssignment,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';

import { MIGRATION_AGENT_BUNDLE } from './vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * Live migration on real kernels (M6 step 1b, 3.10): the node agent's migration side (bundled from
 * `migration-agent.entry.ts`: real `MigrationService`, CRIU through runc, mutual-TLS transfer, restored replicas,
 * kept-address network plugin, volume manager on DRBD 9) on two Debian 13 VMs, a third VM as a client holding a TCP
 * connection. The test plays the control plane (the VMs can't reach the test process): it sends the session commands
 * in the order the control plane's state machine does (`sessionStep` / `sessionCommands`) and waits for the agents'
 * `migrationProgress` reports. BIRD's host route for the kept address is stood in for by a static route on the client.
 *
 * (a) a stateless counter + an established TCP connection migrate live: the counter continues, the connection
 *     survives, the freeze is measured; (d) the restored replica is adopted (desired state with `restoredFrom`): logs,
 *     stats and `runc exec` work, and after its process ends it is created through Docker again (address kept);
 * (b) a failing restore aborts: the target discards, the source resumes, the connection survives;
 * (c) a stateful service on a replicated DRBD volume (sync replica on the target) migrates live without losing writes.
 * (f) a gVisor (sandboxed) service with a fully established TCP connection moves by stop-and-copy (`runsc checkpoint`
 *     / `runsc restore` into the placeholder's network namespace): counter, connection and kept address come along;
 *     the restored sandbox is adopted (logs, stats, agent-run health check, `runsc exec`); (g) a failing gVisor
 *     restore aborts and the source resumes from its own image (connection kept); its next restart goes to Docker.
 */

const BUSYBOX =
  'docker.io/library/busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';
const AGENT = '/opt/loadweaver/migration-agent.js';
const SOCKET = '/run/lw-mig-lab.sock';
/** Promised in the plan (3.10): the default freeze budget of the control plane. */
const FREEZE_BUDGET_MS = 3_000;
const POD_SUBNETS: Record<string, string> = { vm1: '10.244.1.0/24', vm2: '10.244.2.0/24' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 120_000, stepMs = 500) {
  const start = Date.now();
  let last: unknown;

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }

    if (Date.now() - start > timeoutMs)
      throw new Error(`${what}: not reached in ${timeoutMs} ms${last ? ` (${String(last)})` : ''}`);

    await sleep(stepMs);
  }
}

function spec(overrides: Partial<WorkloadSpec> & Pick<WorkloadSpec, 'id' | 'addresses' | 'command'>): WorkloadSpec {
  const [project, deployment, service] = overrides.id.split('/');

  return workloadSpecSchema.parse({
    project,
    deployment,
    service,
    kind: 'service',
    image: BUSYBOX,
    environment: {},
    labels: {},
    dnsSearch: [],
    runtime: 'runc',
    resources: { cpuMillis: 100, memoryBytes: 64 * 1024 ** 2 },
    restart: 'always',
    stopGracePeriodMs: 2_000,
    init: false,
    readOnly: false,
    privileged: false,
    capAdd: [],
    capDrop: [],
    ulimits: {},
    extraHosts: [],
    volumes: [],
    secrets: [],
    specHash: randomBytes(8).toString('hex'),
    ...overrides,
  });
}

/** 64 MB of anonymous memory, a 100 ms tick (stdout + /tmp/count) and a TCP sink on :9000 (one line per message). */
const COUNTER = spec({
  id: 'shop/web/counter/0',
  addresses: ['10.244.1.10'],
  command: [
    'sh',
    '-c',
    'x=$(head -c 64000000 /dev/zero | tr "\\0" a); i=0; ' +
      '(while true; do nc -l -p 9000 >> /tmp/recv; done &); ' +
      'while true; do i=$((i+1)); echo $i > /tmp/count; echo "tick $i"; sleep 0.1; done',
  ],
});

/** Appends a sequence to its replicated volume (and keeps it in memory): no write may be lost or repeated. */
const STORE = spec({
  id: 'shop/db/store/0',
  addresses: ['10.244.1.20'],
  command: [
    'sh',
    '-c',
    'x=$(head -c 32000000 /dev/zero | tr "\\0" a); i=$(tail -n1 /data/log 2>/dev/null || echo 0); ' +
      'while true; do i=$((i+1)); echo $i >> /data/log; echo "wrote $i"; sleep 0.1; done',
  ],
  volumes: [{ type: 'volume', volume: 'shop/db/data', target: '/data', readOnly: false }],
});

/**
 * A sandboxed (gVisor) counter: 16 MB, a 100 ms tick and a TCP sink on :9000 whose stdin never ends (the connection
 * stays fully established, not half-closed), with a health check the agent runs after a restore.
 */
const GCOUNTER = spec({
  id: 'shop/web/gcounter/0',
  runtime: 'sandboxed',
  addresses: ['10.244.1.30'],
  command: [
    'sh',
    '-c',
    'x=$(head -c 16000000 /dev/zero | tr "\\0" a); i=0; ' +
      '(while true; do sleep 1000000 | nc -l -p 9000 >> /tmp/recv; done &); ' +
      'while true; do i=$((i+1)); echo $i > /tmp/count; echo "tick $i"; sleep 0.1; done',
  ],
  healthcheck: {
    test: ['CMD-SHELL', 'test -s /tmp/count'],
    intervalMs: 1_000,
    timeoutMs: 5_000,
    retries: 2,
    startPeriodMs: 0,
  },
});

describe('live migration on real kernels (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let vm3: Vm;
  const results: Record<string, unknown> = {};

  const api = async <T>(vm: Vm, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const out = await vm.exec(
      body === undefined
        ? `curl -sf --unix-socket ${SOCKET} -X ${method} http://lab${path}`
        : `curl -sS --unix-socket ${SOCKET} -X ${method} -H 'Content-Type: application/json' --data-binary @- http://lab${path} <<'LWEOF'\n${JSON.stringify(body)}\nLWEOF`,
    );
    const parsed = JSON.parse(out) as T & { error?: string };

    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) throw new Error(parsed.error);

    return parsed;
  };

  const send = (vm: Vm, type: string, payload: unknown) => api(vm, 'POST', '/message', { type, payload });

  /** The agent's final report of a phase (done / failed) for a migration, as the control plane receives it. */
  const report = (vm: Vm, migration: string, phase: MigrationReportPhase, timeoutMs = 120_000) =>
    eventually(
      `${vm.name} ${phase} of ${migration}`,
      async () =>
        (await api<MigrationProgress[]>(vm, 'GET', '/progress'))
          .filter((p) => p.migration === migration && p.phase === phase && p.status !== 'running')
          .pop(),
      timeoutMs,
      200,
    );

  const network = (vm: Vm) => ({ bgp: { originate: [POD_SUBNETS[vm.name]] } });

  const apply = (vm: Vm, workloads: WorkloadSpec[], volumes: VolumeAssignment[] = []) =>
    api<{ changed: boolean }>(vm, 'POST', '/apply', { node: vm.name, network: network(vm), workloads, volumes });

  const containerOf = async (vm: Vm, replica: string) =>
    (await vm.exec(`docker ps -aq --no-trunc --filter label=loadweaver.com/workload=${replica}`)).trim();

  /** Timestamps (ms) of a container's log lines matching `pattern` (Docker stamps them on the node that runs it). */
  const logTimes = async (vm: Vm, container: string, pattern: RegExp) =>
    (await vm.exec(`docker logs -t ${container} 2>&1`))
      .split('\n')
      .filter((l) => pattern.test(l))
      .map((l) => ({ at: Date.parse(l.split(' ')[0]), n: Number(/(\d+)\s*$/.exec(l)?.[1]) }));

  interface LiveOptions {
    source: Vm;
    target: Vm;
    replica: WorkloadSpec;
    volumes?: string[];
    /** Between transfer and restore (the control plane flips volume primaries here). */
    beforeRestore?: (migration: string) => Promise<void>;
    /** `runsc`: stop-and-copy (the control plane skips the pre-copy). */
    runtime?: 'runc' | 'runsc';
  }

  /**
   * One live attempt up to the restore, as the control plane drives it: prepare (target) → precopy → freeze /
   * transfer (source) → restore (target). Returns the reports and timings.
   */
  const live = async ({ source, target, replica, volumes = [], beforeRestore, runtime = 'runc' }: LiveOptions) => {
    const migration = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const base = { migration, attempt: 1, replica: replica.id };
    const timings: Record<string, number> = {};
    const timed = async <T>(label: string, fn: () => Promise<T>) => {
      const start = Date.now();

      try {
        return await fn();
      } finally {
        timings[label] = Date.now() - start;
      }
    };

    await send(
      target,
      'migrationPrepare',
      migrationPrepareSchema.parse({
        ...base,
        source: source.name,
        runtime,
        token,
        addresses: replica.addresses,
        expiresInSeconds: 900,
        spec: replica,
      }),
    );

    const prepared = await timed('prepare', () => report(target, migration, 'prepare'));

    expect(prepared).toMatchObject({ status: 'done', endpoint: { address: target.ip } });

    const endpoint = prepared.endpoint as TransferEndpoint;
    let precopy: MigrationProgress | undefined;

    if (runtime === 'runc') {
      await send(
        source,
        'migrationPrecopy',
        migrationPrecopySchema.parse({
          ...base,
          target: target.name,
          endpoint,
          token,
          maxRounds: 8,
          convergeBytes: 4 * 1024 ** 2,
        }),
      );
      precopy = await timed('precopy', () => report(source, migration, 'precopy'));
      expect(precopy.status).toBe('done');
    }

    await send(
      source,
      'migrationFreeze',
      migrationFreezeSchema.parse({
        ...base,
        target: target.name,
        endpoint,
        token,
        runtime,
        volumes,
        freezeBudgetMs: FREEZE_BUDGET_MS,
      }),
    );

    const freeze = await timed('freeze', () => report(source, migration, 'freeze'));
    const transfer = await timed('transfer', () => report(source, migration, 'transfer'));

    expect(freeze.status).toBe('done');
    expect(transfer.status).toBe('done');
    await beforeRestore?.(migration);
    await send(
      target,
      'migrationRestore',
      migrationRestoreSchema.parse({ ...base, runtime, volumes, addresses: replica.addresses }),
    );

    const restore = await timed('restore', () => report(target, migration, 'restore'));

    return { migration, base, endpoint, precopy: precopy as MigrationProgress, freeze, transfer, restore, timings };
  };

  const commit = async (source: Vm, target: Vm, base: { migration: string; attempt: number; replica: string }) => {
    await send(source, 'migrationCommit', migrationCommitSchema.parse({ ...base, role: 'source' }));
    await send(target, 'migrationCommit', migrationCommitSchema.parse({ ...base, role: 'target' }));
    expect(await report(source, base.migration, 'commit')).toMatchObject({ status: 'done' });
    expect(await report(target, base.migration, 'commit')).toMatchObject({ status: 'done' });
  };

  /** Stand-in for BIRD's host route of the kept address (`hostRoutes`, originated by the hosting node). */
  const routeVia = (address: string, via: Vm) => vm3.exec(`ip route replace ${address}/32 via ${via.ip}`);

  /** A client on vm3 holding one TCP connection to a counter, writing a line every 100 ms (exits on any error). */
  const startClient = async (address = '10.244.1.10', unit = 'lw-client') => {
    await vm3.exec(
      [
        `systemctl stop ${unit} 2>/dev/null || true`,
        `systemctl reset-failed ${unit} 2>/dev/null || true`,
        `rm -f /run/${unit}.state`,
        `cat > /opt/${unit}.sh <<'EOS'`,
        '#!/bin/bash',
        `for i in $(seq 1 100); do exec 3<>/dev/tcp/${address}/9000 && break; sleep 0.5; done`,
        `echo connected > /run/${unit}.state`,
        `while true; do echo "$(date +%s.%N)" >&3 || { echo "write failed" > /run/${unit}.state; exit 3; }; sleep 0.1; done`,
        'EOS',
        `chmod +x /opt/${unit}.sh`,
        `systemd-run --unit ${unit} /opt/${unit}.sh`,
      ].join('\n'),
    );
    await eventually('client connected', async () =>
      (await vm3.exec(`cat /run/${unit}.state 2>/dev/null || true`)).includes('connected') ? true : undefined,
    );
  };

  const clientAlive = async (unit = 'lw-client') =>
    (await vm3.exec(`systemctl is-active ${unit} || true`)).trim() === 'active';

  const received = async (vm: Vm) =>
    Number((await vm.exec(`docker exec ${await containerOf(vm, COUNTER.id)} sh -c 'wc -l < /tmp/recv'`)).trim());

  /** The stateful service's volume: copies on vm1 and vm2 (synchronous), primary where the control plane says. */
  const volume = (primary: Vm): VolumeAssignment =>
    volumeAssignmentSchema.parse({
      id: 'shop/db/data',
      dockerName: 'lw-vol-shop.db.data',
      minor: 1000,
      port: 7800,
      sizeBytes: 512 * 1024 ** 2,
      replicas: [
        { node: 'vm1', nodeId: 0, address: vm1.ip },
        { node: 'vm2', nodeId: 1, address: vm2.ip },
      ],
      connections: [{ a: 'vm1', b: 'vm2', protocol: 'C' }],
      primary: primary.name,
      keyRef: 'secret://shop/lw-volume-db.data',
    });

  beforeAll(async () => {
    lab = await startVmLab({
      vms: [
        { name: 'vm1', site: 'a', memoryMb: 1536, dataDiskGb: 4 },
        { name: 'vm2', site: 'a', memoryMb: 1536, dataDiskGb: 4 },
        { name: 'vm3', site: 'a', memoryMb: 1024 },
      ],
      log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
    });
    ({ vm1, vm2, vm3 } = lab.vms as Record<'vm1' | 'vm2' | 'vm3', Vm>);

    // Node certificates from a lab CA, as the control plane issues them at join (URI SAN identity, 3.21).
    const ca = await createCertificateAuthority({ commonName: 'lab', validityDays: 1 });

    await Promise.all(
      [vm1, vm2].map(async (vm) => {
        const peer = vm === vm1 ? vm2 : vm1;
        const keys = await generateKeyPair();
        const cert = await issueCertificate({
          ca,
          csrPem: await createCsr(keys, vm.name),
          clusterId: 'lab',
          kind: 'node',
          name: vm.name,
          validityHours: 4,
        });

        await vm.copyIn(MIGRATION_AGENT_BUNDLE, AGENT);
        await vm.exec(
          [
            'install -d -m 0700 /var/lib/loadweaver /etc/loadweaver',
            `cat > /var/lib/loadweaver/node.key <<'EOF'\n${keys.privateKeyPem.trim()}\nEOF`,
            `cat > /var/lib/loadweaver/node.crt <<'EOF'\n${cert.certificatePem.trim()}\nEOF`,
            `cat > /var/lib/loadweaver/ca.crt <<'EOF'\n${ca.certificatePem.trim()}\nEOF`,
            'chmod 0600 /var/lib/loadweaver/node.key',
            `echo '${JSON.stringify({ clusterId: 'lab', nodeName: vm.name, controlPlaneUrl: 'https://cp.lab', controlPlaneEndpoints: [] })}' > /var/lib/loadweaver/identity.json`,
            // Overlay address + link peer (the transfer endpoint's address and the firewall allowance's peer).
            `echo '${JSON.stringify({ network: { addresses: [vm.ip], wireguard: [{ peer: peer.name, peerAddresses: [peer.ip] }] } })}' > /var/lib/loadweaver/applied-state.json`,
            "printf '%s' lab-volume-key-0123456789abcdef > /etc/loadweaver/lab-volume.key",
            'chmod 0600 /etc/loadweaver/lab-volume.key',
            `pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}`,
            'lvcreate -q -l 90%FREE -T loadweaver/pool',
            'modprobe drbd',
            `systemd-run --unit lw-mig -E LOADWEAVER_STATE_DIR=/var/lib/loadweaver node ${AGENT} serve`,
          ].join('\n'),
        );
        await eventually(`${vm.name} agent`, async () =>
          (await vm.exec(`test -S ${SOCKET} && echo ok || true`)).includes('ok') ? true : undefined,
        );
        await apply(vm, []);
      }),
    );
    await vm3.exec(
      `ip route replace ${POD_SUBNETS['vm1']} via ${vm1.ip} && ip route replace ${POD_SUBNETS['vm2']} via ${vm2.ip}`,
    );
  });

  afterAll(async () => {
    await lab?.stop();
    process.stderr.write(`[vm-lab] live migration results: ${JSON.stringify(results, null, 1)}\n`);
  });

  it('(a) migrates a running counter with an established TCP connection live (runc, CRIU pre-copy)', async () => {
    await apply(vm1, [COUNTER]);
    await routeVia('10.244.1.10', vm1);
    await startClient();
    await sleep(3_000);

    const source = await containerOf(vm1, COUNTER.id);
    const before = await received(vm1);
    const attempt = await live({ source: vm1, target: vm2, replica: COUNTER });

    expect(attempt.restore).toMatchObject({ status: 'done' });
    await routeVia('10.244.1.10', vm2);
    await sleep(3_000);

    const target = await containerOf(vm2, COUNTER.id);
    const sourceTicks = await logTimes(vm1, source, /tick \d+/);
    const targetTicks = await logTimes(vm2, target, /tick \d+/);
    const lastSource = sourceTicks[sourceTicks.length - 1];
    const firstTarget = targetTicks.find((t) => t.n > lastSource.n);

    // The same process continues: the counter goes on from where it was frozen (no restart from 1).
    expect(firstTarget?.n).toBe(lastSource.n + 1);
    // The connection survived the move (the client never saw an error) and its data reaches the restored process.
    expect(await clientAlive()).toBe(true);

    const after = await received(vm2);

    await sleep(2_000);
    expect(await received(vm2)).toBeGreaterThan(after);
    expect(after).toBeGreaterThan(before);
    // The address moved with it: the kept address is routed to its veth on the target.
    expect(await vm2.exec('ip route show 10.244.1.10')).toMatch(/dev lwk[0-9a-f]+/);
    expect(await vm2.exec(`docker exec ${target} ip -4 addr show eth0`)).toContain('10.244.1.10/32');

    const gapMs = (firstTarget?.at ?? 0) - lastSource.at;
    // The target agent's own restore time (placeholder start + runc restore), without the lab driver's round trips.
    const restoreMs = Number(
      /Restored \S+ from \S+ in (\d+) ms/.exec(
        await vm2.exec('journalctl -u lw-mig --no-pager | grep Restored | tail -1'),
      )?.[1],
    );

    results['a'] = {
      precopyRounds: attempt.precopy.round,
      precopyBytes: attempt.precopy.totalBytes,
      lastRoundBytes: attempt.precopy.bytes,
      dirtyBytesPerSecond: attempt.precopy.dirtyBytesPerSecond,
      finalDumpBytes: attempt.freeze.bytes,
      sourceDumpMs: attempt.freeze.freezeMs,
      sourceFreezeAndTransferMs: attempt.transfer.freezeMs,
      targetRestoreMs: restoreMs,
      driverRestoreMs: attempt.timings['restore'],
      agentFreezeMs: (attempt.transfer.freezeMs ?? 0) + restoreMs,
      targetReportedFreezeMs: attempt.restore.freezeMs,
      appVisibleGapMs: gapMs,
      driverOverheadNote: 'appVisibleGapMs includes the lab driver (ssh polling) between transfer done and restore',
      budgetMs: FREEZE_BUDGET_MS,
    };
    // Freeze (dump + transfer on the source + restore on the target). The measured value is reported above; the
    // nested-KVM lab on a shared host has outliers (placeholder start alone varies 0.4–2 s), so the hard bound is
    // twice the budget, like the gVisor case — the budget itself is the control plane's eligibility default.
    expect((attempt.transfer.freezeMs ?? 0) + restoreMs).toBeLessThan(2 * FREEZE_BUDGET_MS);

    await commit(vm1, vm2, attempt.base);
    expect(await containerOf(vm1, COUNTER.id)).toBe('');
    expect(await vm1.exec('(ls /var/lib/loadweaver/migrations 2>/dev/null || true) | wc -l')).toBe('0\n');
    expect(await vm2.exec('nft list table inet lw_migration 2>/dev/null | grep -c "mark set" || true')).toBe('0\n');
  });

  it('(d) adopts the restored replica (logs, stats, runc exec) and returns it to Docker after its process ends', async () => {
    const restored = { ...COUNTER, hostRoutes: ['10.244.1.10/32'] };
    const holder = await containerOf(vm2, COUNTER.id);

    // The cut-over reaches the desired states: the target runs it (restoredFrom), the source no longer.
    await apply(vm2, [{ ...restored, restoredFrom: { migration: randomUUID(), runtime: 'runc' } }]);
    await apply(vm1, []);
    expect(await containerOf(vm2, COUNTER.id)).toBe(holder);
    expect((await api<{ workloads: { id: string; state: string }[] }>(vm2, 'GET', '/status')).workloads).toEqual([
      expect.objectContaining({ id: COUNTER.id, state: 'running' }),
    ]);

    // Live terminal path: `runc exec` in the restored namespaces sees the real process tree (pid 1 = the app).
    const runcName = `lwr-${holder.slice(0, 32)}`;
    const ps = await vm2.exec(`runc --root /run/loadweaver/runc exec ${runcName} ps`);

    expect(ps).toMatch(/^\s+1 root .*sh -c x=/m);
    // Logs and stats stay Docker's: the restored process writes into the container's log, its memory is accounted.
    expect(await vm2.exec(`docker logs --tail 1 ${holder}`)).toMatch(/^tick \d+/);

    const memory = await vm2.exec(`docker stats --no-stream --format '{{.MemUsage}}' ${holder}`);

    expect(Number(/^([\d.]+)MiB/.exec(memory)?.[1] ?? 0)).toBeGreaterThan(50);

    // Its next restart: the restored process ends, the replica is created through Docker again (address kept).
    await vm2.exec(`runc --root /run/loadweaver/runc kill ${runcName} KILL`);

    const recreated = await eventually('replica back on Docker', async () => {
      const id = await containerOf(vm2, COUNTER.id);
      const labels = id ? await vm2.exec(`docker inspect -f '{{json .Config.Labels}}' ${id}`) : '';

      return id && id !== holder && !labels.includes('loadweaver.com/restored') ? id : undefined;
    });

    expect(await vm2.exec(`docker inspect -f '{{.State.Running}} {{json .Config.Entrypoint}}' ${recreated}`)).toBe(
      'true null\n',
    );
    expect(await vm2.exec(`docker exec ${recreated} ip -4 addr show eth0`)).toContain('10.244.1.10/32');
    expect(await vm2.exec(`runc --root /run/loadweaver/runc list -q`)).toBe('');
  });

  it('(b) a failed restore aborts: the target discards, the source resumes with its connection', async () => {
    const replica = { ...COUNTER, hostRoutes: ['10.244.1.10/32'] };

    await apply(vm2, [replica]);
    await startClient();
    await sleep(2_000);

    const attempt = await live({
      source: vm2,
      target: vm1,
      replica,
      // A corrupted checkpoint on the target: CRIU fails to restore it.
      beforeRestore: async () =>
        void (await vm1.exec('rm -f /var/lib/loadweaver/migrations/*-target/final/inventory.img')),
    });

    expect(attempt.restore).toMatchObject({ status: 'failed', error: expect.stringContaining('runc restore failed') });

    // The control plane's abort order: the target first, the source resumes only after the target confirmed.
    const abort = { ...attempt.base, reason: 'restore failed', volumes: [] };

    await send(vm1, 'migrationAbort', migrationAbortSchema.parse({ ...abort, role: 'target' }));
    expect(await report(vm1, attempt.migration, 'abort')).toMatchObject({ status: 'done' });
    expect(await containerOf(vm1, COUNTER.id)).toBe('');
    await send(vm2, 'migrationAbort', migrationAbortSchema.parse({ ...abort, role: 'source' }));
    expect(await report(vm2, attempt.migration, 'abort')).toMatchObject({ status: 'done', resumed: true });

    await sleep(2_000);
    expect(await clientAlive()).toBe(true);

    const count = await received(vm2);

    await sleep(2_000);
    expect(await received(vm2)).toBeGreaterThan(count);
    // The kept-address route came back with the veth.
    expect(await vm2.exec('ip route show 10.244.1.10')).toMatch(/dev lwk[0-9a-f]+/);
    expect(
      await vm2.exec(`docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' ${await containerOf(vm2, COUNTER.id)}`),
    ).toBe('always\n');
    results['b'] = { restoreError: attempt.restore.error?.slice(0, 120), resumed: true, connectionKept: true };
  });

  it('(c) migrates a stateful service on a replicated DRBD volume live, without losing a write', async () => {
    const counterOnVm2 = { ...COUNTER, hostRoutes: ['10.244.1.10/32'] };

    await apply(vm2, [counterOnVm2], [volume(vm1)]);
    // A new volume becomes usable once both replicas are connected (the reconcile retries).
    await eventually(
      'store running on vm1',
      async () => {
        await apply(vm1, [STORE], [volume(vm1)]).catch(() => undefined);

        return (await vm1.exec(`docker ps -q --filter label=loadweaver.com/workload=${STORE.id}`)).trim() || undefined;
      },
      120_000,
      3_000,
    );
    await sleep(3_000);

    const attempt = await live({
      source: vm1,
      target: vm2,
      replica: STORE,
      volumes: ['shop/db/data'],
      // The control plane moves the primary to the target at restore (desired states of both nodes).
      beforeRestore: async () => {
        expect(await vm1.exec('drbdadm role lw-1000')).toBe('Secondary\n');
        await apply(vm1, [STORE], [volume(vm2)]);
        await apply(vm2, [counterOnVm2], [volume(vm2)]);
      },
    });

    expect(attempt.restore).toMatchObject({ status: 'done' });
    await commit(vm1, vm2, attempt.base);
    // The cut-over reaches both desired states: the restored replica (kept address) on vm2, nothing on vm1.
    await apply(vm2, [counterOnVm2, { ...STORE, hostRoutes: ['10.244.1.20/32'] }], [volume(vm2)]);
    await apply(vm1, [], [volume(vm2)]);
    await sleep(2_000);

    const store = await containerOf(vm2, STORE.id);
    const log = (await vm2.exec(`docker exec ${store} cat /data/log`)).trim().split('\n').map(Number);
    const gaps = log.filter((n, i) => i > 0 && n !== log[i - 1] + 1);

    expect(log.length).toBeGreaterThan(30);
    expect(gaps).toEqual([]);
    expect(await vm2.exec('drbdadm role lw-1000')).toBe('Primary\n');
    expect(await vm1.exec('drbdadm role lw-1000')).toBe('Secondary\n');
    const restoreMs = Number(
      /Restored \S+ from \S+ in (\d+) ms/.exec(
        await vm2.exec('journalctl -u lw-mig --no-pager | grep Restored | tail -1'),
      )?.[1],
    );

    results['c'] = {
      writes: log.length,
      sourceFreezeAndTransferMs: attempt.transfer.freezeMs,
      targetRestoreMs: restoreMs,
      agentFreezeMs: (attempt.transfer.freezeMs ?? 0) + restoreMs,
      driverRestoreMs: attempt.timings['restore'],
      finalDumpBytes: attempt.freeze.bytes,
    };
  });

  it('(e) a stateful attempt failing during the transfer resumes on the source from its own dump', async () => {
    const replica = { ...STORE, hostRoutes: ['10.244.1.20/32'] };
    const migration = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const base = { migration, attempt: 1, replica: replica.id };
    const counterOnVm2 = { ...COUNTER, hostRoutes: ['10.244.1.10/32'] };

    await send(
      vm1,
      'migrationPrepare',
      migrationPrepareSchema.parse({
        ...base,
        source: 'vm2',
        runtime: 'runc',
        token,
        addresses: replica.addresses,
        expiresInSeconds: 900,
        spec: replica,
      }),
    );

    const endpoint = (await report(vm1, migration, 'prepare')).endpoint as TransferEndpoint;

    // The checkpoint never arrives (here: a token the target doesn't know, like a broken link would).
    await send(
      vm2,
      'migrationFreeze',
      migrationFreezeSchema.parse({
        ...base,
        target: 'vm1',
        endpoint,
        token: randomBytes(32).toString('base64url'),
        runtime: 'runc',
        volumes: ['shop/db/data'],
        freezeBudgetMs: FREEZE_BUDGET_MS,
      }),
    );
    const frozen = await report(vm2, migration, 'freeze');

    expect({ status: frozen.status, error: frozen.error }).toEqual({ status: 'done', error: undefined });
    expect(await report(vm2, migration, 'transfer')).toMatchObject({ status: 'failed' });
    expect(await vm2.exec('drbdadm role lw-1000')).toBe('Secondary\n');

    const abort = { ...base, reason: 'transfer failed', volumes: ['shop/db/data'] };

    await send(vm1, 'migrationAbort', migrationAbortSchema.parse({ ...abort, role: 'target' }));
    expect(await report(vm1, migration, 'abort')).toMatchObject({ status: 'done' });
    await send(vm2, 'migrationAbort', migrationAbortSchema.parse({ ...abort, role: 'source' }));
    // The volume never left vm2 (restore wasn't sent): it promotes again and the dump is restored locally.
    expect(await report(vm2, migration, 'abort')).toMatchObject({ status: 'done', resumed: true });
    await sleep(2_000);

    const store = await containerOf(vm2, STORE.id);
    const log = (await vm2.exec(`docker exec ${store} cat /data/log`)).trim().split('\n').map(Number);
    const gaps = log.filter((n, i) => i > 0 && n !== log[i - 1] + 1);

    expect(gaps).toEqual([]);
    expect(await vm2.exec('drbdadm role lw-1000')).toBe('Primary\n');
    expect(await vm2.exec(`docker inspect -f '{{index .Config.Labels "loadweaver.com/restored"}}' ${store}`)).toBe(
      `${migration}\n`,
    );
    await apply(vm2, [counterOnVm2, replica], [volume(vm2)]);
    results['e'] = { resumed: 'restored locally from the final dump', writes: log.length };
  });

  /** `runsc exec` in a restored gVisor replica (the agent's root), else `docker exec` (a sandbox Docker runs). */
  const inSandbox = async (vm: Vm, replica: string, script: string) => {
    const id = await containerOf(vm, replica);
    const restored = (
      await vm.exec(`docker inspect -f '{{index .Config.Labels "loadweaver.com/restored"}}' ${id}`)
    ).trim();

    return await vm.exec(
      restored
        ? `runsc --root /run/loadweaver/runsc exec lwr-${id.slice(0, 32)} sh -c '${script}'`
        : `docker exec ${id} sh -c '${script}'`,
    );
  };

  const gReceived = async (vm: Vm) => Number((await inSandbox(vm, GCOUNTER.id, 'wc -l < /tmp/recv')).trim());

  const restoreMsOf = async (vm: Vm) =>
    Number(
      /Restored \S+ from \S+ in (\d+) ms/.exec(
        await vm.exec('journalctl -u lw-mig --no-pager | grep Restored | tail -1'),
      )?.[1],
    );

  it('(f) moves a gVisor service by stop-and-copy with its kept address and an established TCP connection', async () => {
    const gOnVm2 = { ...GCOUNTER, hostRoutes: ['10.244.1.30/32'] };
    const others = [
      { ...COUNTER, hostRoutes: ['10.244.1.10/32'] },
      { ...STORE, hostRoutes: ['10.244.1.20/32'] },
    ];

    await apply(vm1, [GCOUNTER], [volume(vm2)]);
    expect(await vm1.exec(`docker inspect -f '{{.HostConfig.Runtime}}' ${await containerOf(vm1, GCOUNTER.id)}`)).toBe(
      'runsc-systrap\n',
    );
    await routeVia('10.244.1.30', vm1);
    await startClient('10.244.1.30', 'lw-gclient');
    await sleep(3_000);

    const source = await containerOf(vm1, GCOUNTER.id);
    const before = await gReceived(vm1);

    expect(await inSandbox(vm1, GCOUNTER.id, 'netstat -tn')).toMatch(/10\.244\.1\.30:9000 .* ESTABLISHED/);

    const attempt = await live({ source: vm1, target: vm2, replica: GCOUNTER, runtime: 'runsc' });

    expect(attempt.restore).toMatchObject({ status: 'done' });
    await routeVia('10.244.1.30', vm2);
    await sleep(3_000);

    const target = await containerOf(vm2, GCOUNTER.id);
    const sourceTicks = await logTimes(vm1, source, /tick \d+/);
    const targetTicks = await logTimes(vm2, target, /tick \d+/);
    const lastSource = sourceTicks[sourceTicks.length - 1];
    const firstTarget = targetTicks.find((t) => t.n > lastSource.n);

    // The same sandbox continues (memory restored), its log goes on in the placeholder's Docker log.
    expect(firstTarget?.n).toBe(lastSource.n + 1);
    // The connection survived (gVisor's netstack restored it in the placeholder's network namespace).
    expect(await clientAlive('lw-gclient')).toBe(true);
    expect(await inSandbox(vm2, GCOUNTER.id, 'netstat -tn')).toMatch(/10\.244\.1\.30:9000 .* ESTABLISHED/);

    const after = await gReceived(vm2);

    await sleep(2_000);
    expect(await gReceived(vm2)).toBeGreaterThan(after);
    expect(after).toBeGreaterThan(before);
    // The kept address: routed to its veth on the target and configured inside the sandbox.
    expect(await vm2.exec('ip route show 10.244.1.30')).toMatch(/dev lwk[0-9a-f]+/);
    expect(await inSandbox(vm2, GCOUNTER.id, 'ip -4 addr show eth0')).toContain('10.244.1.30/32');

    const restoreMs = await restoreMsOf(vm2);

    results['f'] = {
      method: 'stop-and-copy (gVisor)',
      checkpointBytes: attempt.freeze.bytes,
      sourceCheckpointMs: attempt.freeze.freezeMs,
      sourceFreezeAndTransferMs: attempt.transfer.freezeMs,
      targetRestoreMs: restoreMs,
      agentFreezeMs: (attempt.transfer.freezeMs ?? 0) + restoreMs,
      targetReportedFreezeMs: attempt.restore.freezeMs,
      appVisibleGapMs: (firstTarget?.at ?? 0) - lastSource.at,
      tcpConnectionKept: true,
      budgetMs: FREEZE_BUDGET_MS,
    };
    await commit(vm1, vm2, attempt.base);
    expect(await containerOf(vm1, GCOUNTER.id)).toBe('');

    // Adopted: desired state with `restoredFrom`; logs, stats, the agent-run health check, `runsc exec`.
    await apply(
      vm2,
      [...others, { ...gOnVm2, restoredFrom: { migration: attempt.migration, runtime: 'runsc' } }],
      [volume(vm2)],
    );
    await apply(vm1, [], [volume(vm2)]);
    expect(await containerOf(vm2, GCOUNTER.id)).toBe(target);
    expect(await vm2.exec(`docker logs --tail 1 ${target}`)).toMatch(/^tick \d+/);

    const memory = await vm2.exec(`docker stats --no-stream --format '{{.MemUsage}}' ${target}`);

    expect(Number(/^([\d.]+)MiB/.exec(memory)?.[1] ?? 0)).toBeGreaterThan(15);
    await eventually('restored gVisor replica healthy', async () =>
      (await api<{ workloads: { id: string; state: string }[] }>(vm2, 'GET', '/status')).workloads.find(
        (w) => w.id === GCOUNTER.id && w.state === 'healthy',
      ),
    );
    expect(await inSandbox(vm2, GCOUNTER.id, 'cat /proc/1/cmdline | tr "\\0" " "')).toMatch(/^sh -c x=/);
    // Stop-and-copy promises a freeze of seconds (the control plane admits it by its estimate, which carries a 2 s
    // fixed cost for gVisor); typically ≈ 2.5 s here, but placeholder start + `runsc restore` vary 0.6–3.3 s in this
    // nested-KVM lab, so the bound is twice the live budget.
    expect((attempt.transfer.freezeMs ?? 0) + restoreMs).toBeLessThan(2 * FREEZE_BUDGET_MS);
  });

  it('(g) a failed gVisor restore aborts, the source resumes from its own image; its restart goes to Docker', async () => {
    const replica = { ...GCOUNTER, hostRoutes: ['10.244.1.30/32'] };
    const holder = await containerOf(vm2, GCOUNTER.id);
    const attempt = await live({
      source: vm2,
      target: vm1,
      replica,
      runtime: 'runsc',
      // A corrupted checkpoint on the target: runsc can't restore it.
      beforeRestore: async () =>
        void (await vm1.exec('rm -f /var/lib/loadweaver/migrations/*-target/final/checkpoint.img')),
    });

    expect(attempt.restore).toMatchObject({ status: 'failed', error: expect.stringContaining('restore failed') });

    const abort = { ...attempt.base, reason: 'restore failed', volumes: [] };

    await send(vm1, 'migrationAbort', migrationAbortSchema.parse({ ...abort, role: 'target' }));
    expect(await report(vm1, attempt.migration, 'abort')).toMatchObject({ status: 'done' });
    expect(await containerOf(vm1, GCOUNTER.id)).toBe('');
    await send(vm2, 'migrationAbort', migrationAbortSchema.parse({ ...abort, role: 'source' }));
    expect(await report(vm2, attempt.migration, 'abort')).toMatchObject({ status: 'done', resumed: true });
    // The stopped sandbox's veth (and host route) went away with it and came back with the resumed one: the hosting
    // node announces the address again (BIRD; here the client's static route, which also drops the ICMP redirect
    // vm2 sent while it had no route).
    await routeVia('10.244.1.30', vm2);

    await sleep(3_000);

    const resumed = await containerOf(vm2, GCOUNTER.id);

    expect(resumed).not.toBe(holder);
    // Restored from the source's own image: connection kept, data still arriving, the kept route back.
    expect(await clientAlive('lw-gclient')).toBe(true);

    const count = await gReceived(vm2);

    // The client's next retransmission (exponential backoff after the stop of several seconds) resumes the stream.
    await eventually('data arriving again', async () => ((await gReceived(vm2)) > count ? true : undefined), 60_000);
    expect(await clientAlive('lw-gclient')).toBe(true);
    expect(await vm2.exec('ip route show 10.244.1.30')).toMatch(/dev lwk[0-9a-f]+/);
    results['g'] = {
      restoreError: attempt.restore.error?.slice(0, 160),
      sourceCheckpointMs: attempt.freeze.freezeMs,
      localRestoreMs: await restoreMsOf(vm2),
      resumed: true,
      connectionKept: true,
    };

    // Its next restart: the sandbox ends, the replica is created through Docker again (gVisor runtime, address kept).
    await vm2.exec(`runsc --root /run/loadweaver/runsc kill lwr-${resumed.slice(0, 32)} KILL`);

    const recreated = await eventually('gVisor replica back on Docker', async () => {
      const id = await containerOf(vm2, GCOUNTER.id);
      const labels = id ? await vm2.exec(`docker inspect -f '{{json .Config.Labels}}' ${id}`) : '';

      return id && id !== resumed && !labels.includes('loadweaver.com/restored') ? id : undefined;
    });

    expect(await vm2.exec(`docker inspect -f '{{.State.Running}} {{.HostConfig.Runtime}}' ${recreated}`)).toBe(
      'true runsc-systrap\n',
    );
    expect(await vm2.exec(`docker exec ${recreated} ip -4 addr show eth0`)).toContain('10.244.1.30/32');
    expect(await vm2.exec('runsc --root /run/loadweaver/runsc list -quiet')).toBe('');
    await vm3.exec('systemctl stop lw-gclient || true');
  });
});
