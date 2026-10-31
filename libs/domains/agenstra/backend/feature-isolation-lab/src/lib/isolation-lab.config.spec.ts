import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GVISOR_RUNTIMES } from '@forepath/shared/backend/util-container-runtime';

import {
  buildIsolationLabGoldenUserData,
  buildIsolationLabMicrovmScenarios,
  buildIsolationLabQemuArgs,
  buildIsolationLabRunUserData,
  buildIsolationLabScenarios,
  expectedLabRuntime,
  ISOLATION_LAB_UBUNTU_IMAGE,
} from './isolation-lab.config';

describe('isolation lab configuration', () => {
  it('expects the kernel network stack variant wherever Netstack would bypass the guard or embedded DNS', () => {
    expect(expectedLabRuntime('standard', 'guard')).toBe('runc');
    expect(expectedLabRuntime('sandboxed', 'bridge')).toBe(GVISOR_RUNTIMES.systrap.runtime);
    expect(expectedLabRuntime('sandboxed', 'agent-network')).toBe(GVISOR_RUNTIMES.systrap.sharedNetnsRuntime);
    expect(expectedLabRuntime('sandboxed', 'guard')).toBe(GVISOR_RUNTIMES.systrap.sharedNetnsRuntime);
    expect(expectedLabRuntime('sandboxed-kvm', 'bridge')).toBe(GVISOR_RUNTIMES.kvm.runtime);
    expect(expectedLabRuntime('sandboxed-kvm', 'agent-network')).toBe(GVISOR_RUNTIMES.kvm.sharedNetnsRuntime);
    expect(expectedLabRuntime('sandboxed-kvm', 'guard')).toBe(GVISOR_RUNTIMES.kvm.sharedNetnsRuntime);
  });

  it('covers every level x topology x guard mode', () => {
    const scenarios = buildIsolationLabScenarios();

    expect(scenarios).toHaveLength(3 * (2 + 4));
    expect(scenarios.filter((scenario) => scenario.topology === 'guard').map((scenario) => scenario.mode)).toEqual([
      'off',
      'monitor',
      'enforce',
      'offline',
      'off',
      'monitor',
      'enforce',
      'offline',
      'off',
      'monitor',
      'enforce',
      'offline',
    ]);
    expect(buildIsolationLabScenarios(['sandboxed-kvm']).every((scenario) => scenario.level === 'sandboxed-kvm')).toBe(
      true,
    );
  });

  it('covers every topology and guard mode for the microvm level', () => {
    expect(buildIsolationLabMicrovmScenarios()).toEqual([
      { topology: 'bridge' },
      { topology: 'agent-network' },
      { topology: 'guard', mode: 'off' },
      { topology: 'guard', mode: 'monitor' },
      { topology: 'guard', mode: 'enforce' },
      { topology: 'guard', mode: 'offline' },
    ]);
  });

  it('builds QEMU arguments with or without nested virtualization', () => {
    const base = {
      diskPath: '/run/disk.qcow2',
      seedPath: '/run/seed.img',
      serialPath: '/run/serial.log',
      sshPort: 2222,
    };
    const nested = buildIsolationLabQemuArgs(base);
    const plain = buildIsolationLabQemuArgs({ ...base, exposeVirtualization: false, memoryMb: 2048, cpus: 1 });

    expect(nested).toEqual(expect.arrayContaining(['-cpu', 'host', '-m', '3072', '-smp', '2']));
    // Guest SSH is only forwarded to the VM container's loopback.
    expect(nested).toContain('user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22');
    expect(nested).toEqual(expect.arrayContaining(['-serial', 'file:/run/serial.log', '-display', 'none']));
    expect(plain).toEqual(expect.arrayContaining(['-cpu', 'host,-vmx,-svm', '-m', '2048', '-smp', '1']));
    expect(() => buildIsolationLabQemuArgs({ ...base, memoryMb: 64 })).toThrow();
    expect(() => buildIsolationLabQemuArgs({ ...base, sshPort: 22 })).toThrow();
  });

  it('prepares the golden image like the providers (Docker via get.docker.com, no gVisor)', () => {
    const userData = buildIsolationLabGoldenUserData();

    expect(userData.startsWith('#cloud-config\n')).toBe(true);
    expect(userData).toContain('curl -fsSL https://get.docker.com | sh');
    expect(userData).not.toContain('runsc');
    expect(userData).toContain('power_state:');
  });

  it('builds per-run cloud-init and rejects unsafe values', () => {
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample lab@run';

    expect(buildIsolationLabRunUserData({ hostname: 'vm-kvm', sshPublicKey: key })).toContain(`      - ${key}`);
    expect(() => buildIsolationLabRunUserData({ hostname: 'vm;reboot', sshPublicKey: key })).toThrow();
    expect(() =>
      buildIsolationLabRunUserData({ hostname: 'vm', sshPublicKey: 'ssh-ed25519 AAA\nruncmd: [x]' }),
    ).toThrow();
  });

  it('pins the Ubuntu cloud image', () => {
    expect(ISOLATION_LAB_UBUNTU_IMAGE.url).toContain(`release-${ISOLATION_LAB_UBUNTU_IMAGE.release}`);
    expect(ISOLATION_LAB_UBUNTU_IMAGE.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('takes the lab locks once per run in a global setup, so every spec file joins them', () => {
    // Without it the first spec's lock (own Jest environment) made every later spec file fail with
    // "/tmp/lw-vmlab.lock is held by io.agenstra.isolation-lab (pid <own pid>)".
    const root = join(__dirname, '..', '..');
    const config = readFileSync(join(root, 'jest.isolation-lab.config.cts'), 'utf8');

    for (const [key, file] of [
      ['globalSetup', 'global-setup.ts'],
      ['globalTeardown', 'global-teardown.ts'],
    ]) {
      expect(config).toContain(`${key}: '<rootDir>/src/integration/harness/${file}'`);
      expect(existsSync(join(root, 'src', 'integration', 'harness', file))).toBe(true);
    }

    expect(readFileSync(join(root, 'src', 'integration', 'harness', 'global-setup.ts'), 'utf8')).toContain(
      'vmLabGlobalSetup(',
    );
  });
});
