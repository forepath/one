import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GVISOR_RUNTIMES } from '@forepath/shared/backend/util-container-runtime';

import { CommandError } from './command-runner';
import {
  cpuFlagsHash,
  gvisorRuntimeProblem,
  IsolationProbeService,
  kvmUsable,
  sandboxProbeOf,
  START_FAILURE_THRESHOLD,
  type IsolationReport,
  type ProbeHost,
} from './isolation-probe.service';
import { isProbeContainer, PROBE_LABEL } from './managed-containers';

const SYSTRAP = GVISOR_RUNTIMES.systrap.runtime;
const KVM = GVISOR_RUNTIMES.kvm.runtime;
const FACTS_OK = { cpu: 'yes', device: 'present', module: 'loaded', nested: 'no', hypervisor: 'no' };
const FACTS_NO_KVM = { cpu: 'no', device: 'absent', module: 'absent', nested: 'unknown', hypervisor: 'yes' };
const CPUINFO = 'processor\t: 0\nflags\t\t: fpu vmx sse2 avx\nprocessor\t: 1\nflags\t\t: fpu vmx sse2 avx\n';

interface Scenario {
  dockerDown?: boolean;
  runtimes?: Record<string, { path?: string; runtimeArgs?: string[] }>;
  facts?: Record<string, string> | null;
  /** Images present locally (by reference); `pull` fails for the others unless `pullOk`. */
  images?: string[];
  pullOk?: boolean;
  /** Output of `dmesg` per runtime (default: gVisor's boot line). */
  dmesg?: Record<string, string>;
  /** Runtimes whose smoke container fails (`timeout`: killed by the runner's timeout). */
  failing?: Record<string, 'error' | 'timeout'>;
  leftovers?: string[];
}

const ALL_RUNTIMES = {
  runc: { path: 'runc' },
  [SYSTRAP]: { path: '/usr/local/bin/runsc', runtimeArgs: ['--platform=systrap'] },
  [GVISOR_RUNTIMES.systrap.sharedNetnsRuntime]: {
    path: 'runsc',
    runtimeArgs: ['--platform=systrap', '--network=host'],
  },
  [KVM]: { path: '/usr/local/bin/runsc', runtimeArgs: ['--platform=kvm'] },
};

function fakeCommands(scenario: Scenario) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run = jest.fn(async (cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args: [...args] });

    if (cmd === 'env') {
      const command = args[3];

      if (command === 'check' || command === 'install-kvm' || command === 'uninstall-kvm')
        return {
          stdout:
            scenario.facts === null
              ? ''
              : `[agenstra-gvisor] noise\n${JSON.stringify({
                  runtime: SYSTRAP,
                  sharedNetnsRuntime: 'x',
                  release: '1',
                  standard: 'ready',
                  sandboxed: 'registered',
                  kvm: scenario.facts ?? FACTS_OK,
                })}\n`,
          stderr: '',
        };
    }

    if (cmd !== 'docker') throw new Error(`unexpected ${cmd}`);

    if (scenario.dockerDown) throw new CommandError('docker', args, 1, 'Cannot connect to the Docker daemon');

    if (args[0] === 'info')
      return {
        stdout: JSON.stringify({ ServerVersion: '29', Runtimes: scenario.runtimes ?? ALL_RUNTIMES }),
        stderr: '',
      };

    if (args[0] === 'image' && args[1] === 'inspect') {
      if ((scenario.images ?? ['*']).some((i) => i === '*' || i === args[4]))
        return {
          stdout: args[3]?.includes('Labels')
            ? JSON.stringify({
                'io.forepath.microvm.migration': 'generic,vm',
                'io.forepath.microvm.qemu-version': '1:10.0.13+ds-0+deb13u1',
                'io.forepath.microvm.virtiofsd-version': '1.13.2-1+deb13u1',
              })
            : 'sha256:1',
          stderr: '',
        };

      throw new CommandError('docker', args, 1, 'No such image');
    }

    if (args[0] === 'pull') {
      if (scenario.pullOk) return { stdout: '', stderr: '' };

      throw new CommandError('docker', args, 1, 'pull access denied');
    }

    if (args[0] === 'ps') return { stdout: (scenario.leftovers ?? []).join('\n'), stderr: '' };

    if (args[0] === 'rm') return { stdout: '', stderr: '' };

    if (args[0] === 'run') {
      const runtime = args[args.indexOf('--runtime') + 1];
      const failure = scenario.failing?.[runtime];

      if (failure === 'timeout') throw new CommandError('docker', args, null, 'killed');

      if (failure) throw new CommandError('docker', args, 125, 'OCI runtime create failed');

      const entrypoint = args[args.indexOf('--entrypoint') + 1];

      return {
        stdout: entrypoint === 'dmesg' ? (scenario.dmesg?.[runtime] ?? '[    0.000000] Starting gVisor...\n') : '',
        stderr: '',
      };
    }

    throw new Error(`unexpected docker ${args.join(' ')}`);
  });

  return {
    calls,
    run,
    json: jest.fn(async (cmd: string, args: readonly string[]) => JSON.parse((await run(cmd, args)).stdout || 'null')),
    available: jest.fn(async () => true),
  };
}

function hostOf(overrides: { boot?: string; openable?: boolean; tun?: boolean } = {}): ProbeHost {
  return {
    readText: async (path) =>
      path === '/proc/cpuinfo' ? CPUINFO : path.endsWith('boot_id') ? `${overrides.boot ?? 'boot-1'}\n` : '',
    openable: async () => overrides.openable ?? true,
    exists: async () => overrides.tun ?? true,
    now: () => new Date('2026-10-23T10:00:00.000Z'),
  };
}

describe('isolation probes (3.1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lw-isolation-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A state store double: its files in memory, the host script below `dir`. */
  function stateOf(initial: { isolation?: unknown; applied?: unknown } = {}) {
    let isolation = initial.isolation ?? null;

    return {
      dir,
      isolationState: jest.fn(async () => isolation),
      saveIsolationState: jest.fn(async (value: unknown) => {
        isolation = JSON.parse(JSON.stringify(value));
      }),
      appliedState: jest.fn(async () => initial.applied ?? null),
      get saved() {
        return isolation as { host?: { kvm: string; probeNonce?: string }; report?: IsolationReport } | null;
      },
    };
  }

  function service(
    scenario: Scenario = {},
    options: {
      host?: ProbeHost;
      state?: ReturnType<typeof stateOf>;
      launcher?: string | null;
      microvmProbe?: { run: jest.Mock };
    } = {},
  ) {
    const commands = fakeCommands(scenario);
    const state = options.state ?? stateOf();
    const probes = new IsolationProbeService(commands as never, state as never, options.microvmProbe as never);

    probes.host = options.host ?? hostOf();
    probes.launcher = () =>
      options.launcher === undefined ? 'ghcr.io/forepath/microvm-launcher@sha256:' + 'a'.repeat(64) : options.launcher;

    return { probes, commands, state };
  }

  afterEach(() => jest.useRealTimers());

  it('reports every level ready from real checks: runtime args, KVM facts and smoke containers', async () => {
    const { probes, commands } = service();
    const report = await probes.probe();

    expect(report.runtimes).toEqual(['runc', 'sandboxed', 'sandboxed-kvm', 'microvm']);
    expect(report.levels.runc).toEqual({ state: 'ready', checkedAt: '2026-10-23T10:00:00.000Z' });
    expect(report.kvm).toEqual({ ...FACTS_OK, usable: true, optOut: false });
    expect(report.cpuFlagsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.bootId).toBe('boot-1');

    const runs = commands.calls.filter((c) => c.cmd === 'docker' && c.args[0] === 'run');

    // runc, systrap and kvm: never the -hostnet variants, never networked, 64 MiB, labelled as probes.
    expect(runs.map((r) => r.args[r.args.indexOf('--runtime') + 1])).toEqual(['runc', SYSTRAP, KVM]);

    for (const r of runs) {
      expect(r.args).toEqual(expect.arrayContaining(['--rm', '--label', `${PROBE_LABEL}=1`, '--network', 'none']));
      expect(r.args[r.args.indexOf('--memory') + 1]).toBe('64m');
    }

    // The KVM facts come from the shared host script, read-only, never installing packages.
    const check = commands.calls.find((c) => c.cmd === 'env');

    expect(check?.args).toEqual([
      'AGENSTRA_KVM_APT=0',
      'bash',
      join(dir, 'isolation', 'gvisor-host.sh'),
      'check',
      '--json',
    ]);
    expect(readFileSync(join(dir, 'isolation', 'gvisor-host.sh'), 'utf8')).toContain('AGENSTRA_KVM_APT:-0');
  });

  it('never matches names: unregistered and misconfigured gVisor runtimes are unsupported', async () => {
    const misconfigured = await service({
      runtimes: {
        [SYSTRAP]: { runtimeArgs: ['--platform=systrap', '--network=host'] },
        [KVM]: { runtimeArgs: ['--platform=systrap'] },
      },
    }).probes.probe();

    expect(misconfigured.levels.sandboxed).toMatchObject({
      state: 'unsupported',
      reasonCode: 'E_RUNTIME_MISCONFIGURED',
    });
    expect(misconfigured.levels['sandboxed-kvm']).toMatchObject({
      state: 'unsupported',
      reasonCode: 'E_RUNTIME_MISCONFIGURED',
    });
    expect(misconfigured.runtimes).toEqual(['runc', 'microvm']);

    // A runsc-* runtime under another name doesn't count.
    const missing = await service({ runtimes: { 'runsc-custom': { runtimeArgs: [] } } }).probes.probe();

    expect(missing.levels.sandboxed).toMatchObject({ state: 'unsupported', reasonCode: 'E_RUNTIME_NOT_REGISTERED' });
    expect(missing.levels['sandboxed-kvm']).toMatchObject({ reasonCode: 'E_RUNTIME_NOT_REGISTERED' });
  });

  it('fails a level whose container did not run on gVisor, or failed / timed out (removed afterwards)', async () => {
    const { probes, commands } = service({
      dmesg: { [SYSTRAP]: 'Linux version 6.8.0\n' },
      failing: { [KVM]: 'timeout' },
    });
    const report = await probes.probe();

    expect(report.levels.sandboxed).toMatchObject({ state: 'probe-failed', reasonCode: 'E_PROBE_RUNTIME_MISMATCH' });
    expect(report.levels['sandboxed-kvm']).toMatchObject({ state: 'probe-failed', reasonCode: 'E_PROBE_TIMEOUT' });
    expect(report.runtimes).toEqual(['runc', 'microvm']);

    const kvmRun = commands.calls.find((c) => c.args[0] === 'run' && c.args.includes(KVM));
    const name = kvmRun?.args[kvmRun.args.indexOf('--name') + 1];

    expect(name).toMatch(/^lw-probe-sandboxed-kvm-[0-9a-f]{8}$/);
    expect(commands.calls).toContainEqual({ cmd: 'docker', args: ['rm', '-f', name] });

    const start = await service({ failing: { [SYSTRAP]: 'error' } }).probes.probe();

    expect(start.levels.sandboxed).toMatchObject({ state: 'probe-failed', reasonCode: 'E_PROBE_START_FAILED' });
  });

  it('withholds the KVM levels without usable KVM (absent device, or one that does not open)', async () => {
    const absent = await service({ facts: FACTS_NO_KVM }).probes.probe();

    expect(absent.kvm).toMatchObject({ usable: false, optOut: false, cpu: 'no' });
    expect(absent.levels['sandboxed-kvm']).toMatchObject({ state: 'unsupported', reasonCode: 'E_KVM_UNAVAILABLE' });
    expect(absent.levels.microvm).toMatchObject({ state: 'unsupported', reasonCode: 'E_KVM_UNAVAILABLE' });
    expect(absent.levels['sandboxed-kvm']?.reason).toContain('device=absent');
    expect(absent.runtimes).toEqual(['runc', 'sandboxed']);

    const closed = await service({}, { host: hostOf({ openable: false }) }).probes.probe();

    expect(closed.kvm?.usable).toBe(false);
    expect(closed.runtimes).toEqual(['runc', 'sandboxed']);

    // No smoke container for a KVM runtime without KVM.
    const { probes, commands } = service({ facts: FACTS_NO_KVM });

    await probes.probe();
    expect(commands.calls.some((c) => c.args[0] === 'run' && c.args.includes(KVM))).toBe(false);
  });

  it('honours the node spec opt-out: KVM levels disabled by admin, whatever the facts', async () => {
    const state = stateOf({ isolation: { host: { kvm: 'disabled' } } });
    const report = await service({}, { state }).probes.probe();

    expect(report.kvm).toMatchObject({ usable: true, optOut: true });
    expect(report.levels['sandboxed-kvm']).toMatchObject({
      state: 'disabled-by-admin',
      reasonCode: 'E_DISABLED_BY_ADMIN',
    });
    expect(report.levels.microvm).toMatchObject({ state: 'disabled-by-admin' });
    expect(report.runtimes).toEqual(['runc', 'sandboxed']);

    // Before the first host settings, the last applied desired state's opt-out counts.
    const applied = stateOf({ applied: { host: { kvm: 'disabled' } } });

    expect((await service({}, { state: applied }).probes.probe()).kvm?.optOut).toBe(true);
  });

  it('readies microVMs only with /dev/net/tun and the pinned launcher image on the node', async () => {
    expect((await service({}, { launcher: null }).probes.probe()).levels.microvm).toMatchObject({
      state: 'unsupported',
      reasonCode: 'E_MICROVM_IMAGE_UNSUPPORTED',
    });
    expect((await service({}, { host: hostOf({ tun: false }) }).probes.probe()).levels.microvm).toMatchObject({
      state: 'unsupported',
      reason: expect.stringContaining('/dev/net/tun'),
    });

    const absent = await service({ images: ['docker.io/library/alpine:3.22@sha256:x'], pullOk: true }).probes.probe();

    expect(absent.levels.microvm).toMatchObject({ state: 'unsupported', reasonCode: 'E_PROBE_IMAGE_UNAVAILABLE' });
  });

  it('readies microVMs only when the boot probe passes, and reports the launcher / unpack cache facts (M7.2)', async () => {
    const passing = { run: jest.fn(async () => ({ ok: true, unpackCache: true, thinPool: true })) };
    const ready = await service({}, { microvmProbe: passing }).probes.probe();

    expect(passing.run).toHaveBeenCalledWith(expect.stringContaining('microvm-launcher'), expect.any(String));
    expect(ready.levels.microvm).toMatchObject({ state: 'ready' });
    expect(ready.microvm).toMatchObject({ unpackCache: true, thinPool: true });
    expect(typeof ready.microvm?.launcherDigest).toBe('string');
    expect(ready.microvm?.migration).toMatchObject({ generic: true, modes: ['generic', 'vm'] });

    const failing = {
      run: jest.fn(async () => ({
        ok: false,
        reasonCode: 'E_MICROVM_BOOT_FAILED',
        reason: 'the guest address does not answer ICMP (tap networking)',
        unpackCache: true,
        thinPool: false,
      })),
    };
    const failed = await service({}, { microvmProbe: failing }).probes.probe();

    expect(failed.levels.microvm).toMatchObject({ state: 'unsupported', reasonCode: 'E_MICROVM_BOOT_FAILED' });
    expect(failed.runtimes).not.toContain('microvm');
  });

  it('reports nothing ready when Docker does not answer, and only the runc floor without the probe image', async () => {
    const down = await service({ dockerDown: true }).probes.probe();

    expect(down.runtimes).toEqual([]);
    expect(down.levels.runc).toMatchObject({ state: 'probe-failed', reasonCode: 'E_DOCKER_BASELINE_UNAVAILABLE' });

    const noImage = await service({ images: [], pullOk: false }).probes.probe();

    expect(noImage.levels.runc).toMatchObject({ state: 'ready', reasonCode: 'E_PROBE_IMAGE_UNAVAILABLE' });
    expect(noImage.levels.sandboxed).toMatchObject({ state: 'probe-failed', reasonCode: 'E_PROBE_IMAGE_UNAVAILABLE' });
    expect(noImage.runtimes).toEqual(['runc']);

    const runcFails = await service({ failing: { runc: 'error' } }).probes.probe();

    expect(runcFails.levels.runc).toMatchObject({ state: 'probe-failed', reasonCode: 'E_RUNC_PROBE_FAILED' });
    expect(runcFails.levels.sandboxed).toMatchObject({ state: 'probe-failed', reasonCode: 'E_RUNC_PROBE_FAILED' });
    expect(runcFails.runtimes).toEqual([]);
  });

  it('removes probe containers a previous agent left behind; they are never drift', async () => {
    const { probes, commands } = service({ leftovers: ['0123456789ab'] });

    await probes.probe();
    expect(commands.calls).toContainEqual({ cmd: 'docker', args: ['rm', '-f', '0123456789ab'] });
    expect(isProbeContainer({ [PROBE_LABEL]: '1' })).toBe(true);
    expect(isProbeContainer({ 'loadweaver.com/managed': 'true' })).toBe(false);
  });

  it('answers with the same boot’s stored result at once, never with one from before a reboot', async () => {
    const stored = await service().probes.probe();
    const sameBoot = service({}, { state: stateOf({ isolation: { report: stored } }) });

    expect(await sameBoot.probes.current()).toEqual(stored);
    // A fresh probe runs meanwhile (no Docker run before the answer).
    await sameBoot.probes.reprobe('flush');

    const rebooted = service(
      { facts: FACTS_NO_KVM },
      { state: stateOf({ isolation: { report: stored } }), host: hostOf({ boot: 'boot-2' }) },
    );
    const fresh = await rebooted.probes.current();

    expect(fresh.bootId).toBe('boot-2');
    expect(fresh.kvm?.usable).toBe(false);
    rebooted.probes.onApplicationShutdown();
    sameBoot.probes.onApplicationShutdown();
  });

  it('applies the KVM opt-out and probe nonces of the desired state through the host script', async () => {
    const { probes, commands, state } = service();
    const changed = jest.fn();

    probes.onChange(changed);
    await probes.current();
    commands.calls.length = 0;

    // Nothing changes: no script, no probe.
    await probes.applyHost(undefined);
    await probes.applyHost({ kvm: 'auto' });
    expect(commands.calls).toEqual([]);

    await probes.applyHost({ kvm: 'disabled' });
    expect(commands.calls[0]).toEqual({
      cmd: 'env',
      args: ['AGENSTRA_KVM_APT=0', 'bash', join(dir, 'isolation', 'gvisor-host.sh'), 'uninstall-kvm', '--json'],
    });
    expect(state.saved?.host).toEqual({ kvm: 'disabled' });
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as IsolationReport).runtimes).toEqual(['runc', 'sandboxed']);
    // Opted out: no KVM smoke container any more.
    expect(commands.calls.some((c) => c.args[0] === 'run' && c.args.includes(KVM))).toBe(false);

    commands.calls.length = 0;
    await probes.applyHost({ kvm: 'auto', probeNonce: 'n1' });
    expect(commands.calls[0].args[3]).toBe('install-kvm');
    expect(changed).toHaveBeenCalledTimes(2);

    commands.calls.length = 0;
    await probes.applyHost({ kvm: 'auto', probeNonce: 'n2' });
    expect(commands.calls.some((c) => c.args[3] === 'install-kvm' || c.args[3] === 'uninstall-kvm')).toBe(false);
    expect(commands.calls.some((c) => c.args[0] === 'run')).toBe(true);
    // Same result: no fresh hello.
    expect(changed).toHaveBeenCalledTimes(2);
    expect(await probes.kvmPlan()).toEqual({ optOut: false, capable: true });
    probes.onApplicationShutdown();
  });

  it('re-probes after repeated workload start failures on a level', async () => {
    const { probes, commands } = service();

    await probes.current();

    const before = commands.calls.length;

    for (let i = 1; i < START_FAILURE_THRESHOLD; i++) probes.recordStartFailure('sandboxed');

    probes.recordStartSuccess('sandboxed');
    probes.recordStartFailure('sandboxed');
    expect(commands.calls.length).toBe(before);

    for (let i = 1; i < START_FAILURE_THRESHOLD; i++) probes.recordStartFailure('sandboxed');

    await probes.reprobe('flush');
    expect(commands.calls.filter((c) => c.args[0] === 'run').length).toBeGreaterThanOrEqual(6 + 3);
    probes.onApplicationShutdown();
  });

  it('checks the gVisor runtime arguments per platform', () => {
    expect(gvisorRuntimeProblem('systrap', { [SYSTRAP]: { runtimeArgs: [] } })).toBeNull();
    expect(gvisorRuntimeProblem('systrap', { [SYSTRAP]: { runtimeArgs: ['--platform', 'systrap'] } })).toBeNull();
    expect(gvisorRuntimeProblem('systrap', { [SYSTRAP]: { runtimeArgs: ['--platform=kvm'] } })).toContain(
      '--platform=kvm',
    );
    expect(gvisorRuntimeProblem('kvm', { [KVM]: { runtimeArgs: [] } })).toContain('(default)');
    expect(gvisorRuntimeProblem('kvm', { [KVM]: { runtimeArgs: ['--platform=kvm', '--network=none'] } })).toContain(
      '--network=none',
    );
    expect(gvisorRuntimeProblem('kvm', {})).toBeNull();
  });

  it('derives the KVM verdict, the CPU flags hash and the v1 sandbox probe', () => {
    expect(kvmUsable(FACTS_OK as never, true)).toBe(true);
    // arm64: KVM built into the kernel (no module listed), CPU flag check unknown.
    expect(kvmUsable({ ...FACTS_OK, cpu: 'unknown', module: 'absent' } as never, true)).toBe(true);
    expect(kvmUsable(FACTS_OK as never, false)).toBe(false);
    expect(kvmUsable(FACTS_NO_KVM as never, true)).toBe(false);

    // Order and duplicates don't matter; another flag does.
    expect(cpuFlagsHash('flags : sse2 vmx fpu vmx')).toBe(cpuFlagsHash('flags\t: fpu sse2 vmx\n'));
    expect(cpuFlagsHash('flags : fpu sse2')).not.toBe(cpuFlagsHash('flags : fpu sse2 vmx'));
    expect(cpuFlagsHash('Features\t: fp asimd aes')).toMatch(/^[0-9a-f]{64}$/);
    expect(cpuFlagsHash('')).toBeUndefined();

    const at = '2026-10-23T10:00:00.000Z';

    expect(sandboxProbeOf({ state: 'ready', checkedAt: at })).toBe('ready');
    expect(sandboxProbeOf({ state: 'unsupported', checkedAt: at })).toBe('missing');
    expect(sandboxProbeOf({ state: 'probe-failed', checkedAt: at })).toBe('failed');
    expect(sandboxProbeOf(undefined)).toBe('unknown');
  });
});
