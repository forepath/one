import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { imageArchiveName, imageArchiveStem, labCacheDir, loadedImageMarker } from './cache';
import { failOnTerminal, LabCases, persistGuard, stallGuard } from './cases';
import {
  forgetKeptLab,
  keepDecision,
  keptLabFile,
  labKeepEnabled,
  readKeptLab,
  writeKeptLab,
  type KeptLabState,
} from './keep';
import { FatalWait } from './process';
import { switchLabFingerprint, type SwitchLabConfig } from './switch-lab';
import { userNetVmFingerprint, type UserNetVmConfig } from './user-net-vm';

describe('lab cache', () => {
  it('lives outside /tmp unless VM_LAB_CACHE_DIR says otherwise', () => {
    expect(labCacheDir({ HOME: '/home/u' } as NodeJS.ProcessEnv)).not.toMatch(/^\/tmp/);
    expect(labCacheDir({ VM_LAB_CACHE_DIR: '/data/lab-cache' } as NodeJS.ProcessEnv)).toBe('/data/lab-cache');
  });

  it('records loaded images by reference in the guest', () => {
    expect(loadedImageMarker('loadweaver-control-plane-api:dr-lab')).toBe(
      '/var/lib/vm-lab/images/loadweaver-control-plane-api_dr-lab.id',
    );
  });

  it('names image archives by tag and image ID', () => {
    expect(imageArchiveStem('registry.forenet.internal/forepath/microvm-launcher:test')).toBe(
      'registry.forenet.internal_forepath_microvm-launcher_test',
    );
    expect(imageArchiveName('loadweaver-control-plane-api:dr-lab', 'sha256:b1989ff799de0123456789abcdef')).toBe(
      'loadweaver-control-plane-api_dr-lab--b1989ff799de0123.tar',
    );
  });
});

describe('keep-alive', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vm-lab-keep-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is opt-in (LW_LAB_KEEP=1 only)', () => {
    expect(labKeepEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(labKeepEnabled({ LW_LAB_KEEP: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(labKeepEnabled({ LW_LAB_KEEP: '1' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('writes, reads and forgets the state of a key', () => {
    expect(readKeptLab('m7-vm-api', dir)).toBeNull();
    writeKeptLab('m7-vm-api', 'fp1', { runId: 'r1' }, dir);
    expect(readKeptLab<{ runId: string }>('m7-vm-api', dir)).toMatchObject({
      key: 'm7-vm-api',
      fingerprint: 'fp1',
      data: { runId: 'r1' },
    });
    forgetKeptLab('m7-vm-api', dir);
    expect(readKeptLab('m7-vm-api', dir)).toBeNull();
  });

  it('refuses keys that are not file-name safe', () => {
    expect(() => keptLabFile('../etc', dir)).toThrow(/invalid lab keep key/);
  });

  it('attaches only with keep on, the same fingerprint and everything running', () => {
    const state: KeptLabState<unknown> = { key: 'k', fingerprint: 'a', createdAt: '', data: {} };

    expect(keepDecision({ keep: true, state: null, fingerprint: 'a', running: false })).toBe('boot');
    expect(keepDecision({ keep: true, state, fingerprint: 'a', running: true })).toBe('attach');
    expect(keepDecision({ keep: true, state, fingerprint: 'b', running: true })).toBe('replace');
    expect(keepDecision({ keep: true, state, fingerprint: 'a', running: false })).toBe('replace');
    // A run without keep never re-uses a kept lab: it removes it and boots cold.
    expect(keepDecision({ keep: false, state, fingerprint: 'a', running: true })).toBe('replace');
  });

  it('fingerprints a switch lab by its VM specs, golden and image', () => {
    const config: SwitchLabConfig = {
      prefix: 'lw-vmlab',
      label: 'l',
      runLabel: 'r',
      qemuImage: 'q:1',
      goldenVolume: 'g1',
      defaultMemoryMb: 1536,
    };
    const vms = [{ name: 'vm1', site: 'a', memoryMb: 3072 }];
    const base = switchLabFingerprint(config, { vms });

    expect(switchLabFingerprint(config, { vms, log: () => undefined })).toBe(base);
    expect(switchLabFingerprint(config, { vms: [{ ...vms[0], memoryMb: 4096 }] })).not.toBe(base);
    expect(switchLabFingerprint({ ...config, goldenVolume: 'g2' }, { vms })).not.toBe(base);
  });

  it('fingerprints a user-network VM without its per-run ssh key', () => {
    const config: UserNetVmConfig = {
      prefix: 'p',
      label: 'l',
      qemuImage: 'q',
      goldenVolume: 'g',
      diskGb: 30,
      overheadMb: 768,
      sshPort: 2222,
      qemuArgs: (paths) => ['-drive', paths.diskPath],
      userData: (key) => `#cloud-config\nkey: ${key}\n`,
      readiness: { script: 'true', stdout: '' },
      bootTimeoutMs: 1000,
    };

    expect(userNetVmFingerprint(config, 'microvm', 5120)).toBe(userNetVmFingerprint(config, 'microvm', 5120));
    expect(userNetVmFingerprint(config, 'microvm', 4096)).not.toBe(userNetVmFingerprint(config, 'microvm', 5120));
  });
});

describe('fail-fast helpers', () => {
  it('fails a case at once when a case it requires failed in this run', async () => {
    const cases = new LabCases();

    await expect(cases.run('a', [], () => Promise.reject(new Error('boom')))()).rejects.toThrow('boom');
    await expect(cases.run('b', ['a'], () => Promise.resolve())()).rejects.toThrow(
      /\(b\) not run: it needs \(a\), which failed/,
    );
    expect(cases.hasFailed('b')).toBe(true);
  });

  it('runs a case whose prerequisite passed or did not run (focused runs)', async () => {
    const cases = new LabCases();
    const body = jest.fn(() => Promise.resolve());

    await cases.run('a', [], () => Promise.resolve())();
    await cases.run('c', ['a', 'x'], body)();
    expect(body).toHaveBeenCalled();
    expect(cases.hasPassed('c')).toBe(true);
  });

  it('ends a wait when the progress stalls', () => {
    let now = 0;
    const guard = stallGuard('import', 60_000, () => now);

    guard({ status: 'running', bytes: 1 });
    now = 50_000;
    guard({ status: 'running', bytes: 1 });
    now = 55_000;
    guard({ status: 'running', bytes: 2 });
    now = 110_000;
    guard({ status: 'running', bytes: 2 });
    now = 116_000;
    expect(() => guard({ status: 'running', bytes: 2 })).toThrow(FatalWait);
  });

  it('ends a wait when a bad state persists, not when it recovers', () => {
    let now = 0;
    const guard = persistGuard('vm db', () => now);

    guard('Failed', true, 120_000);
    now = 100_000;
    guard('Failed', false, 120_000);
    now = 150_000;
    guard('Failed', true, 120_000);
    now = 260_000;
    guard('Failed', true, 120_000);
    now = 271_000;
    expect(() => guard('Failed', true, 120_000, () => 'crashed')).toThrow(/vm db: Failed for 120 s — crashed/);
  });

  it('records named steps like cases', async () => {
    const cases = new LabCases();

    await cases.step('a-push', () => Promise.resolve());
    await expect(cases.step('a-import', () => Promise.reject(new Error('stalled')))).rejects.toThrow('stalled');
    expect(cases.hasPassed('a-push')).toBe(true);
    expect(cases.hasFailed('a-import')).toBe(true);
  });

  it('fails on terminal states only', () => {
    expect(() => failOnTerminal('vm db', 'Running', /^(Failed|Error)/)).not.toThrow();
    expect(() => failOnTerminal('vm db', 'Failed', /^(Failed|Error)/, () => 'import failed')).toThrow(
      /vm db: ended in Failed — import failed/,
    );
  });
});
