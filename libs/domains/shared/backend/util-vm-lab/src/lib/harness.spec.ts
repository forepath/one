import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentHash } from './images';
import {
  acquireVmLabLock,
  formatLockOwner,
  heavyLockHeldByAncestors,
  lockHolderState,
  type LockOwner,
  parseLockOwner,
  readLockOwner,
  releaseLock,
  tryCreateLock,
  VM_LAB_LOCK_TOKEN_ENV,
} from './locks';
import { LabRecorder, formatMeasurement } from './measure';
import { assertHostMemory, parseMemAvailableMb, planLabMemory } from './memory';
import {
  cpuVirtualizationFlag,
  nestedDecision,
  type NestedReport,
  nestedParameterOn,
  nestedVerdict,
  readNestedReport,
  writeNestedReport,
} from './nested';
import { labCpuModel, switchVmAddress, switchVmQemuArgs } from './qemu-args';
import { SpikeRecorder, spikeBanner, spikeResult } from './spike';

const OWNER: LockOwner = {
  token: 'abc123',
  pid: 4242,
  host: 'lab-host',
  label: 'vm-lab',
  started: '2026-10-23T10:00:00Z',
};

describe('lab locks', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vm-lab-locks-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[VM_LAB_LOCK_TOKEN_ENV];
  });

  it('round-trips the owner record and rejects garbage', () => {
    expect(parseLockOwner(formatLockOwner(OWNER))).toEqual(OWNER);
    expect(parseLockOwner('held by someone\n')).toBeNull();
    expect(parseLockOwner('token=x\npid=-1\n')).toBeNull();
  });

  it('classifies the holder: own token, live, stale (same host, pid gone), other host', () => {
    const context = { host: 'lab-host', alive: (pid: number) => pid === 4242 };

    expect(lockHolderState(OWNER, { ...context, token: 'abc123' })).toBe('own');
    expect(lockHolderState(OWNER, context)).toBe('live');
    expect(lockHolderState({ ...OWNER, pid: 1111 }, context)).toBe('stale');
    expect(lockHolderState({ ...OWNER, host: 'other' }, context)).toBe('unknown');
    expect(lockHolderState(null, context)).toBe('unknown');
  });

  it('creates the lock atomically (noclobber) and only its owner removes it', () => {
    const path = join(dir, 'vmlab.lock');

    expect(tryCreateLock(path, OWNER)).toBe(true);
    expect(tryCreateLock(path, { ...OWNER, token: 'other' })).toBe(false);
    expect(readLockOwner(path)?.token).toBe('abc123');
    expect(releaseLock(path, 'other')).toBe(false);
    expect(readFileSync(path, 'utf8')).toContain('token=abc123');
    expect(releaseLock(path, 'abc123')).toBe(true);
    expect(readLockOwner(path)).toBeNull();
  });

  it('acquires, joins a parent hold by token and refuses a live or stale foreign lock', async () => {
    const path = join(dir, 'vmlab.lock');
    const lock = await acquireVmLabLock({ path, label: 'test' });

    expect(lock.owned).toBe(true);
    expect(process.env[VM_LAB_LOCK_TOKEN_ENV]).toBe(lock.token);

    // A second acquisition in the same process (or a child with the token) joins the hold.
    const joined = await acquireVmLabLock({ path, label: 'test' });

    expect(joined.owned).toBe(false);
    joined.release();
    expect(readLockOwner(path)?.token).toBe(lock.token);
    lock.release();
    expect(readLockOwner(path)).toBeNull();

    writeFileSync(path, formatLockOwner({ ...OWNER, host: hostname(), pid: process.pid }));
    await expect(acquireVmLabLock({ path, label: 'test' })).rejects.toThrow(/one VM lab at a time/);

    writeFileSync(path, formatLockOwner({ ...OWNER, host: hostname(), pid: 2 ** 22 + 7 }));
    await expect(acquireVmLabLock({ path, label: 'test' })).rejects.toThrow(/no longer runs[\s\S]*remove it by hand/);
    expect(readLockOwner(path)?.pid).toBe(2 ** 22 + 7);
  });

  it('detects that a parent already holds the heavy lock (flock or the lock script)', () => {
    expect(
      heavyLockHeldByAncestors([
        { pid: 10, argv: ['node', 'jest'] },
        { pid: 9, argv: ['flock', '-w', '3600', '/tmp/lw-3a.lock', 'npx', 'nx'] },
      ]),
    ).toBe(true);
    expect(heavyLockHeldByAncestors([{ pid: 9, argv: ['bash', '/tmp/lw-3a-lock.sh', 'npx', 'jest'] }])).toBe(true);
    expect(heavyLockHeldByAncestors([{ pid: 9, argv: ['/usr/bin/flock', '/tmp/other.lock', 'x'] }])).toBe(false);
    expect(heavyLockHeldByAncestors([])).toBe(false);
  });
});

describe('memory budget', () => {
  it('sums guest + overhead per VM and the switch, within the 7 GiB guard', () => {
    const plan = planLabMemory([
      { name: 'vm1', memoryMb: 2560 },
      { name: 'vm2', memoryMb: 2560 },
    ]);

    expect(plan.totalMb).toBe(2 * (2560 + 700) + 128);
    expect(plan.maxMb).toBe(7168);
  });

  it('refuses a lab above the guard and VMs without an explicit size', () => {
    expect(() =>
      planLabMemory([
        { name: 'vm1', memoryMb: 3072 },
        { name: 'vm2', memoryMb: 3072 },
      ]),
    ).toThrow(/7672 MiB, more than the 7168 MiB guard \(vm1 3072\+700/);
    expect(() => planLabMemory([{ name: 'vm1', memoryMb: 0 }])).toThrow(/explicit guest memory/);
    expect(planLabMemory([{ name: 'a', memoryMb: 3072, overheadMb: 768 }], { switchMb: 0 }).totalMb).toBe(3840);
  });

  it('reads MemAvailable and checks the host with a margin', () => {
    expect(parseMemAvailableMb('MemTotal: 24000000 kB\nMemAvailable:   16777216 kB\n')).toBe(16384);
    expect(parseMemAvailableMb('MemTotal: 1 kB\n')).toBeNull();
    expect(() => assertHostMemory(7000, { availableMb: 7500, env: {} })).toThrow(/only 7500 MiB are available/);
    expect(() => assertHostMemory(7000, { availableMb: 9000, env: {} })).not.toThrow();
    expect(() => assertHostMemory(7000, { availableMb: 10, env: { VM_LAB_SKIP_MEMORY_CHECK: '1' } })).not.toThrow();
    expect(() => assertHostMemory(7000, { availableMb: null, env: {} })).not.toThrow();
  });
});

describe('nested virtualization', () => {
  it('reads vmx / svm and the nested parameter', () => {
    expect(cpuVirtualizationFlag('processor: 0\nflags\t\t: fpu vme vmx sse\n')).toBe('vmx');
    expect(cpuVirtualizationFlag('flags : fpu svm\n')).toBe('svm');
    expect(cpuVirtualizationFlag('flags : fpu sse hypervisor\n')).toBeNull();
    expect(nestedParameterOn('Y\n')).toBe(true);
    expect(nestedParameterOn('1')).toBe(true);
    expect(nestedParameterOn('N')).toBe(false);
    expect(nestedParameterOn(null)).toBeNull();
  });

  it('decides available / unavailable / unknown with reasons', () => {
    expect(nestedVerdict({ hostKvm: true, cpuVirtualization: 'vmx', nestedParameter: 'Y' }).verdict).toBe('available');
    expect(nestedVerdict({ hostKvm: true, cpuVirtualization: 'vmx', nestedParameter: null }).verdict).toBe('unknown');

    const off = nestedVerdict({ hostKvm: true, cpuVirtualization: null, nestedParameter: 'N' });

    expect(off.verdict).toBe('unavailable');
    expect(off.reasons.join(' ')).toMatch(/nestedVirtualization=true/);
    expect(off.reasons.join(' ')).toMatch(/nested parameter is N/);
    expect(nestedVerdict({ hostKvm: false, cpuVirtualization: 'svm', nestedParameter: '1' }).reasons[0]).toMatch(
      /\/dev\/kvm/,
    );
  });

  it('skips specs needing nesting with the reason, or fails them with VM_LAB_REQUIRE_NESTED=1', () => {
    const report: NestedReport = {
      verdict: 'unavailable',
      hostKvm: true,
      cpuVirtualization: null,
      nestedParameter: 'N',
      reasons: ['no vmx'],
      checkedAt: '',
    };

    expect(nestedDecision(null, 'x', {})).toEqual({ run: true, reason: '' });
    expect(nestedDecision({ ...report, verdict: 'unknown' }, 'x', {}).run).toBe(true);
    expect(nestedDecision(report, 'microVMs', {})).toEqual({
      run: false,
      reason: 'microVMs: nested KVM unavailable on this lab host — no vmx',
    });
    expect(() => nestedDecision(report, 'microVMs', { VM_LAB_REQUIRE_NESTED: '1' })).toThrow(/VM_LAB_REQUIRE_NESTED/);
  });

  it('writes and reads the preflight report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vm-lab-nested-'));
    const path = join(dir, 'sub', 'report.json');
    const report: NestedReport = {
      verdict: 'available',
      hostKvm: true,
      cpuVirtualization: 'vmx',
      nestedParameter: 'Y',
      reasons: [],
      checkedAt: 'now',
    };

    try {
      expect(readNestedReport(path)).toBeNull();
      writeNestedReport(report, path);
      expect(readNestedReport(path)).toEqual(report);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QEMU arguments', () => {
  it('exposes vmx / svm only to nested VMs', () => {
    expect(labCpuModel(true)).toBe('host');
    expect(labCpuModel(false)).toBe('host,-vmx,-svm');
    expect(labCpuModel(true, ['-avx2'])).toBe('host,-avx2');
    expect(() => labCpuModel(true, ['avx2; rm'])).toThrow(/invalid CPU flag/);

    const args = switchVmQemuArgs({
      memoryMb: 2048,
      cpus: 2,
      nested: false,
      tapIndex: 1,
      mac: '52:54:00:77:01:02',
      dataDisk: true,
    });

    expect(args.slice(0, 4)).toEqual(['qemu-system-x86_64', '-enable-kvm', '-cpu', 'host,-vmx,-svm']);
    expect(args).toContain('file=data.qcow2,if=virtio,cache=none,aio=native,discard=unmap');
    expect(args).toContain('tap,id=n0,ifname=tap-1,script=no,downscript=no');
    expect(() =>
      switchVmQemuArgs({
        memoryMb: 100,
        cpus: 2,
        nested: true,
        tapIndex: 0,
        mac: '52:54:00:77:01:01',
        dataDisk: false,
      }),
    ).toThrow();
  });

  it('keeps the M6 addressing (10.77.<site>.11+, MAC by site and VM index)', () => {
    expect(switchVmAddress('10.77', 0, 0, 0)).toEqual({ ip: '10.77.1.11', mac: '52:54:00:77:01:01' });
    expect(switchVmAddress('10.77', 1, 1, 3)).toEqual({ ip: '10.77.2.12', mac: '52:54:00:77:02:04' });
  });
});

describe('measurements and spikes', () => {
  it('formats measurements against a budget and collects verdicts', () => {
    const lines: string[] = [];
    const recorder = new LabRecorder('suite', (line) => lines.push(line));

    recorder.measure('freeze', 0.8, 's', 3);
    recorder.measure('boot', 12, 's', 10);
    recorder.verdict('connection kept', true);
    expect(formatMeasurement({ name: 'boot', value: 12, unit: 's', budget: 10 })).toBe(
      'boot = 12 s (budget 10 s: OVER)',
    );
    expect(lines.join('\n')).toContain('freeze = 0.80 s (budget 3 s: within)');
    expect(recorder.summary()).toContain('PASS connection kept');
  });

  it('prints the spike banner and the fallback when a spike fails', () => {
    const lines: string[] = [];
    const spike = new SpikeRecorder(
      { id: 'S1', title: 'tap', validates: 'managed=no taps', ifFails: 'pass the tap fd' },
      (line) => lines.push(line),
    );

    expect(lines[0]).toBe(spikeBanner(spike.spike));
    expect(spikeResult(spike)).toBe('NO VERDICT');
    spike.verdict('tap opened', false, 'EPERM');
    expect(spikeResult(spike)).toBe('FAIL');
    expect(spike.summary()).toMatch(/spike S1 result: FAIL\n→ pass the tap fd/);
  });

  it('hashes content for tags and volume names', () => {
    expect(contentHash('a', 'b')).toHaveLength(12);
    expect(contentHash('a', 'b')).not.toBe(contentHash('ab'));
  });
});
