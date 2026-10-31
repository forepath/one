import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GVISOR_DEFAULT_RELEASE,
  GVISOR_DEFAULT_RELEASE_SHA512,
  GVISOR_HOST_SCRIPT_EXIT_CODES,
  GVISOR_RUNTIMES,
  buildGvisorHostScript,
  buildGvisorInstallScript,
} from './gvisor-install.script';
import { parseGvisorHostReport } from './gvisor-runtime.utils';

const HOST_SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../../../../../apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh',
);

function bashSyntaxOk(script: string): boolean {
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf-8' });

  return result.status === 0;
}

interface KvmScenario {
  /** `/proc/cpuinfo` fixture content. */
  cpuinfo: string;
  /** Whether `/dev/kvm` exists before the script runs. */
  devicePresent?: boolean;
  /** Whether `modprobe` succeeds (and makes `/dev/kvm` appear). */
  modprobeOk?: boolean;
  /** Whether `modprobe` only succeeds after the extra modules package was installed. */
  modprobeNeedsExtraModules?: boolean;
  /** Exit code of `docker run` (smoke tests). */
  dockerRunRc?: number;
  /** Runtimes registered before the script runs. */
  registered?: string[];
  /** Extra environment for the script (e.g. GVISOR_KVM=0). */
  env?: Record<string, string>;
  /** Bash to run after sourcing the functions (default: `agenstra_kvm_install`). */
  command?: string;
}

interface KvmScenarioResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Runtimes registered afterwards (stub daemon.json, one runtime per line). */
  registered: string[];
  /** Recorded stub calls (`runsc ...`, `modprobe ...`, `apt-get ...`). */
  calls: string[];
  /** Content of the persisted modules-load file, if written. */
  modulesLoad: string | null;
}

/**
 * Runs the real KVM functions of the generated host script against fixtures: Docker, runsc, modprobe,
 * apt-get, systemctl and udevadm are stubbed; the stub daemon.json holds one registered runtime per line
 * so backup / rollback of daemon.json behave like on a real host.
 */
function runKvmScenario(scenario: KvmScenario): KvmScenarioResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenstra-kvm-'));

  try {
    const prefix = path.join(dir, 'prefix');
    const release = path.join(prefix, 'release');

    fs.mkdirSync(release, { recursive: true });
    fs.symlinkSync(release, path.join(prefix, 'current'));
    fs.mkdirSync(path.join(dir, 'modules-load.d'));
    fs.mkdirSync(path.join(dir, 'sys'));
    fs.writeFileSync(path.join(dir, 'cpuinfo'), scenario.cpuinfo);
    fs.writeFileSync(path.join(dir, 'modules'), '');
    fs.writeFileSync(path.join(dir, 'calls'), '');
    fs.writeFileSync(path.join(dir, 'daemon.json'), (scenario.registered ?? []).map((name) => `${name}\n`).join(''));
    // runsc stub: install/uninstall add/remove the runtime line in the stub daemon.json.
    fs.writeFileSync(
      path.join(release, 'runsc'),
      [
        '#!/usr/bin/env bash',
        `echo "runsc $*" >>"${dir}/calls"`,
        'name="${2#--runtime=}"',
        `case "$1" in`,
        `  install) echo "$name" >>"${dir}/daemon.json" ;;`,
        `  uninstall) grep -vx "$name" "${dir}/daemon.json" >"${dir}/daemon.tmp"; mv "${dir}/daemon.tmp" "${dir}/daemon.json" ;;`,
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const functions = buildGvisorHostScript().replace(/\nmain "\$@"\n$/, '\n');
    const harness = `
source "${dir}/functions.sh"
AGENSTRA_GVISOR_PREFIX="${prefix}"
AGENSTRA_DOCKER_DAEMON_JSON="${dir}/daemon.json"
AGENSTRA_DOCKER_DAEMON_BACKUP="${dir}/daemon.json.bak"
AGENSTRA_DOCKER_DAEMON_KVM_BACKUP="${dir}/daemon.json.kvm.bak"
AGENSTRA_KVM_CPUINFO="${dir}/cpuinfo"
AGENSTRA_KVM_PROC_MODULES="${dir}/modules"
AGENSTRA_KVM_SYSFS_MODULES="${dir}/sys"
AGENSTRA_KVM_MODULES_LOAD_DIR="${dir}/modules-load.d"
AGENSTRA_KVM_DEVICE_PATH="${scenario.devicePresent ? '/dev/null' : `${dir}/no-kvm`}"
EXTRA_MODULES=0
agenstra_gvisor_arch() { echo x86_64; }
sleep() { :; }
udevadm() { :; }
systemctl() { echo "systemctl $*" >>"${dir}/calls"; }
modprobe() {
  echo "modprobe $*" >>"${dir}/calls"
  if [ "${scenario.modprobeOk ? '1' : '0'}" = "1" ] || { [ "${scenario.modprobeNeedsExtraModules ? '1' : '0'}" = "1" ] && [ "$EXTRA_MODULES" = "1" ]; }; then
    AGENSTRA_KVM_DEVICE_PATH=/dev/null
    return 0
  fi
  return 1
}
apt-get() { echo "apt-get $*" >>"${dir}/calls"; EXTRA_MODULES=1; }
modinfo() {
  if [ "${scenario.modprobeNeedsExtraModules ? '1' : '0'}" = "1" ] && [ "$EXTRA_MODULES" != "1" ]; then
    return 1
  fi
  return 0
}
docker() {
  case "$1" in
    info)
      if [ "\${2:-}" = "--format" ]; then
        printf '{"runc":{}'; while IFS= read -r name; do [ -n "$name" ] && printf ',"%s":{}' "$name"; done <"${dir}/daemon.json"; printf '}'
      fi
      return 0 ;;
    image) return 0 ;;
    run) echo "docker $*" >>"${dir}/calls"; return ${scenario.dockerRunRc ?? 0} ;;
  esac
  return 0
}
${scenario.command ?? 'agenstra_kvm_install'}
`;

    fs.writeFileSync(path.join(dir, 'functions.sh'), functions);
    const result = spawnSync('bash', ['-c', harness], {
      encoding: 'utf-8',
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...(scenario.env ?? {}) },
    });
    const modulesLoadPath = path.join(dir, 'modules-load.d', 'agenstra-kvm.conf');

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      registered: fs
        .readFileSync(path.join(dir, 'daemon.json'), 'utf-8')
        .split('\n')
        .filter((line) => line.length > 0),
      calls: fs
        .readFileSync(path.join(dir, 'calls'), 'utf-8')
        .split('\n')
        .filter((line) => line.length > 0),
      modulesLoad: fs.existsSync(modulesLoadPath) ? fs.readFileSync(modulesLoadPath, 'utf-8') : null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const INTEL_CPU = 'processor\t: 0\nflags\t\t: fpu vme de pse vmx sse sse2\n';
const INTEL_CPU_IN_VM = 'processor\t: 0\nflags\t\t: fpu vme vmx sse hypervisor\n';
const NO_VIRT_CPU = 'processor\t: 0\nflags\t\t: fpu vme de pse sse sse2 hypervisor\n';
const SYSTRAP_RUNTIMES = [GVISOR_RUNTIMES.systrap.runtime, GVISOR_RUNTIMES.systrap.sharedNetnsRuntime];
const KVM_RUNTIMES = [GVISOR_RUNTIMES.kvm.runtime, GVISOR_RUNTIMES.kvm.sharedNetnsRuntime];

describe('gVisor install scripts', () => {
  it('pins the release and verifies the archive checksum', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain(`GVISOR_RELEASE:-${GVISOR_DEFAULT_RELEASE}`);
    expect(script).toContain(GVISOR_DEFAULT_RELEASE_SHA512.x86_64);
    expect(script).toContain(GVISOR_DEFAULT_RELEASE_SHA512.aarch64);
    expect(script).toContain('sha512sum -c -');
    // gvisor.tar.bz2 needs bzip2, which minimal cloud images (e.g. Ubuntu 22.04 cloud images) lack.
    expect(script).toContain('agenstra_apt_install bzip2');
    // Package installs wait for the dpkg lock (first-boot upgrades) and refresh the index once.
    expect(script).toContain('DPkg::Lock::Timeout=180');
    expect(script).toContain('https://storage.googleapis.com/gvisor/releases/release/');
  });

  it('registers the systrap runtime without changing the default runtime', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain('install --runtime="$AGENSTRA_GVISOR_RUNTIME" -- --platform=systrap');
    expect(script).toContain('AGENSTRA_GVISOR_RUNTIME="runsc-systrap"');
    // Egress-guarded workers share the guard's namespace: kernel network stack instead of Netstack.
    expect(script).toContain('AGENSTRA_GVISOR_HOSTNET_RUNTIME="runsc-systrap-hostnet"');
    expect(script).toContain('--platform=systrap --network=host');
    expect(script).not.toContain('default-runtime');
  });

  it('verifies runc and gVisor and rolls back on failure', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain('docker run --rm --runtime=runc');
    expect(script).toContain('docker run --rm --runtime="$AGENSTRA_GVISOR_RUNTIME"');
    expect(script).toContain('agenstra_gvisor_rollback');
    expect(script).toContain('uninstall --runtime="$AGENSTRA_GVISOR_RUNTIME"');
    expect(script).toContain('uninstall --runtime="$AGENSTRA_GVISOR_HOSTNET_RUNTIME"');
    // The previous release stays active on rollback; new releases are staged before activation.
    expect(script).toContain('ln -sfn "$AGENSTRA_GVISOR_PREVIOUS"');
    expect(script).toContain('.staging-XXXXXX');
  });

  it('only restarts Docker on fresh cloud-init hosts, never from the standalone script', () => {
    expect(buildGvisorInstallScript()).toContain('AGENSTRA_DOCKER_RESTART_ALLOWED="1"');
    expect(buildGvisorHostScript()).toContain('AGENSTRA_DOCKER_RESTART_ALLOWED="0"');
  });

  it('never aborts the surrounding cloud-init script on gVisor failures', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain('if ( agenstra_prepare_gvisor ); then');
    expect(script).toContain('environments use standard Docker (runc)');
    expect(bashSyntaxOk(`#!/bin/bash\nset -euo pipefail\n${script}`)).toBe(true);
  });

  it('requires an explicit checksum for non-default releases', () => {
    const script = buildGvisorInstallScript({ release: '20250915.0' });

    expect(script).toContain('AGENSTRA_GVISOR_SHA512_X86_64=""');
    expect(script).toContain('set GVISOR_SHA512');
  });

  it('rejects unsafe options', () => {
    expect(() => buildGvisorInstallScript({ release: 'latest; rm -rf /' })).toThrow();
    expect(() => buildGvisorInstallScript({ runtimeName: 'runsc --x' })).toThrow();
    expect(() => buildGvisorInstallScript({ sharedNetnsRuntimeName: 'runsc-systrap' })).toThrow();
    expect(() => buildGvisorInstallScript({ release: '20250915.0', sha512: { x86_64: 'abc' } })).toThrow();
    expect(() => buildGvisorInstallScript({ verifyImage: 'img;reboot' })).toThrow();
  });

  it('generates a valid standalone host script with check/install/uninstall', () => {
    const script = buildGvisorHostScript();

    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(script).toContain('check|install|uninstall|install-kvm|uninstall-kvm');
    expect(script).toContain('E_DOCKER_BASELINE_UNAVAILABLE');
    expect(bashSyntaxOk(script)).toBe(true);
  });

  it('registers the KVM runtime pair next to the systrap pair (sandboxed-kvm level)', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain('AGENSTRA_GVISOR_KVM_RUNTIME="runsc-kvm"');
    expect(script).toContain('AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME="runsc-kvm-hostnet"');
    expect(script).toContain('install --runtime="$AGENSTRA_GVISOR_KVM_RUNTIME" -- --platform=kvm');
    expect(script).toContain('--platform=kvm --network=host');
    // KVM is only attempted on top of a working systrap installation and never fails the systrap level.
    expect(script).toContain('agenstra_gvisor_install || return 1\nif agenstra_kvm_install; then');
    expect(script).toContain('the sandboxed-kvm level stays unavailable');
    // No hypervisor stack is installed: gVisor's KVM platform only needs /dev/kvm.
    expect(script).not.toMatch(/apt-get install[^\n]*(libvirt|qemu)/);
    expect(bashSyntaxOk(`#!/bin/bash\nset -euo pipefail\n${script}`)).toBe(true);
  });

  it('keeps the cloud-init block compact (user data is size limited, 32 KiB on Hetzner Cloud)', () => {
    const script = buildGvisorInstallScript();

    // Margin for the provider user data (Hetzner rejects more than 32768 characters after base64); the provider
    // specs check the complete user data against the real limits.
    expect(Buffer.byteLength(script, 'utf-8')).toBeLessThan(15 * 1024);
    // Comment-only lines and indentation are dropped from the embedded functions.
    expect(script).not.toMatch(/^\s*# gVisor requires/m);
    expect(bashSyntaxOk(`#!/bin/bash\nset -euo pipefail\n${script}`)).toBe(true);
  });

  it('prepares KVM in the cloud-init block before (and independently of) the gVisor installation', () => {
    const script = buildGvisorInstallScript();
    const prepare = script.indexOf('agenstra_kvm_prepare_host || true');

    expect(prepare).toBeGreaterThan(-1);
    expect(prepare).toBeLessThan(script.indexOf('agenstra_gvisor_install || return 1'));
  });

  it('can opt out of the KVM platform', () => {
    expect(buildGvisorInstallScript()).toContain('GVISOR_KVM:-1');
    expect(buildGvisorInstallScript({ kvm: false })).toContain('GVISOR_KVM:-0');
  });

  it('can keep the KVM preparation from installing packages (kvmApt: false)', () => {
    expect(buildGvisorInstallScript()).toContain('AGENSTRA_KVM_APT:-1');
    expect(buildGvisorInstallScript({ kvmApt: false })).toContain('AGENSTRA_KVM_APT:-0');
    expect(buildGvisorHostScript({ kvmApt: false })).toContain('AGENSTRA_KVM_APT:-0');
    expect(bashSyntaxOk(buildGvisorHostScript({ kvmApt: false }))).toBe(true);
  });

  it('rejects KVM runtime names that collide with other runtimes', () => {
    expect(() => buildGvisorInstallScript({ kvmRuntimeName: 'runsc-systrap' })).toThrow();
    expect(() => buildGvisorInstallScript({ kvmSharedNetnsRuntimeName: 'runsc-kvm' })).toThrow();
    expect(() => buildGvisorInstallScript({ kvmRuntimeName: 'runsc kvm' })).toThrow();
    expect(() =>
      buildGvisorInstallScript({ kvmRuntimeName: 'my-kvm', kvmSharedNetnsRuntimeName: 'my-kvm-net' }),
    ).not.toThrow();
  });

  it('exposes the runtime catalog', () => {
    expect(GVISOR_RUNTIMES.systrap).toEqual({
      platform: 'systrap',
      runtime: 'runsc-systrap',
      sharedNetnsRuntime: 'runsc-systrap-hostnet',
    });
    expect(GVISOR_RUNTIMES.kvm).toEqual({
      platform: 'kvm',
      runtime: 'runsc-kvm',
      sharedNetnsRuntime: 'runsc-kvm-hostnet',
    });
  });

  describe('KVM preparation (behaviour)', () => {
    it('skips hosts without hardware virtualization and registers nothing', () => {
      const result = runKvmScenario({ cpuinfo: NO_VIRT_CPU, registered: SYSTRAP_RUNTIMES });

      expect(result.status).toBe(1);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
      expect(result.calls.filter((call) => call.startsWith('runsc install'))).toEqual([]);
      expect(result.calls.filter((call) => call.startsWith('modprobe'))).toEqual([]);
      expect(result.stderr).toContain('No hardware virtualization');
    });

    it('loads and persists the KVM modules, then registers both KVM runtimes', () => {
      const result = runKvmScenario({ cpuinfo: INTEL_CPU, modprobeOk: true, registered: SYSTRAP_RUNTIMES });

      expect(result.status).toBe(0);
      expect(result.calls).toEqual(
        expect.arrayContaining([
          'modprobe kvm',
          'modprobe kvm_intel',
          'runsc install --runtime=runsc-kvm -- --platform=kvm',
          'runsc install --runtime=runsc-kvm-hostnet -- --platform=kvm --network=host',
        ]),
      );
      expect(result.registered).toEqual([...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES]);
      expect(result.modulesLoad).toBe('kvm\nkvm_intel\n');
      // Smoke tests run both KVM runtimes without network.
      expect(result.calls).toEqual(
        expect.arrayContaining([
          'docker run --rm --runtime=runsc-kvm --network=none hello-world',
          'docker run --rm --runtime=runsc-kvm-hostnet --network=none hello-world',
        ]),
      );
    });

    it('uses an existing /dev/kvm without loading modules', () => {
      const result = runKvmScenario({ cpuinfo: INTEL_CPU_IN_VM, devicePresent: true, registered: SYSTRAP_RUNTIMES });

      expect(result.status).toBe(0);
      expect(result.calls.filter((call) => call.startsWith('modprobe'))).toEqual([]);
      expect(result.registered).toEqual([...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES]);
    });

    it('installs the extra kernel modules only when the KVM module is missing', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        modprobeNeedsExtraModules: true,
        registered: SYSTRAP_RUNTIMES,
      });

      expect(result.status).toBe(0);
      expect(result.calls.some((call) => /^apt-get install .*linux-modules-extra-/.test(call))).toBe(true);
      expect(result.registered).toEqual([...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES]);
    });

    it('never installs the extra kernel modules with AGENSTRA_KVM_APT=0 (pinned package sources)', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        modprobeNeedsExtraModules: true,
        registered: SYSTRAP_RUNTIMES,
        env: { AGENSTRA_KVM_APT: '0' },
      });

      expect(result.status).toBe(1);
      expect(result.calls.filter((call) => call.startsWith('apt-get'))).toEqual([]);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
    });

    it('gives up when the KVM modules cannot be loaded (no package install for existing modules)', () => {
      const result = runKvmScenario({ cpuinfo: INTEL_CPU, registered: SYSTRAP_RUNTIMES });

      expect(result.status).toBe(1);
      expect(result.calls.filter((call) => call.startsWith('apt-get'))).toEqual([]);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
      expect(result.modulesLoad).toBeNull();
    });

    it('rolls back only the KVM runtimes when the smoke test fails', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        devicePresent: true,
        dockerRunRc: 1,
        registered: SYSTRAP_RUNTIMES,
      });

      expect(result.status).toBe(1);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
      expect(result.stderr).toContain('Rolling back the gVisor KVM runtime registration');
      expect(result.calls.filter((call) => call.startsWith('runsc uninstall --runtime=runsc-systrap'))).toEqual([]);
    });

    it('removes stale KVM runtimes when KVM is no longer available', () => {
      const result = runKvmScenario({ cpuinfo: NO_VIRT_CPU, registered: [...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES] });

      expect(result.status).toBe(1);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
    });

    it('honours GVISOR_KVM=0', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        devicePresent: true,
        registered: SYSTRAP_RUNTIMES,
        env: { GVISOR_KVM: '0' },
      });

      expect(result.status).toBe(1);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
      expect(result.stderr).toContain('GVISOR_KVM=0');
    });

    it('cleans up a partial KVM registration when KVM is unavailable', () => {
      const result = runKvmScenario({
        cpuinfo: NO_VIRT_CPU,
        registered: [...SYSTRAP_RUNTIMES, GVISOR_RUNTIMES.kvm.runtime],
      });

      expect(result.status).toBe(1);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
    });

    it('unregisters previously registered KVM runtimes with GVISOR_KVM=0', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        devicePresent: true,
        registered: [...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES],
        env: { GVISOR_KVM: '0' },
      });

      expect(result.status).toBe(1);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
    });

    it('reports the KVM facts and state with check --json', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU_IN_VM,
        devicePresent: true,
        registered: [...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES],
        command: 'main check --json',
      });

      expect(result.status).toBe(0);
      expect(parseGvisorHostReport(result.stdout)).toEqual({
        runtime: 'runsc-systrap',
        sharedNetnsRuntime: 'runsc-systrap-hostnet',
        release: GVISOR_DEFAULT_RELEASE,
        standard: 'ready',
        sandboxed: 'registered',
        kvmRuntime: 'runsc-kvm',
        kvmSharedNetnsRuntime: 'runsc-kvm-hostnet',
        sandboxedKvm: 'registered',
        kvm: { cpu: 'yes', device: 'present', module: 'absent', nested: 'unknown', hypervisor: 'yes' },
      });
    });

    it('keeps the check exit code tied to the systrap runtimes', () => {
      const withoutKvm = runKvmScenario({
        cpuinfo: NO_VIRT_CPU,
        registered: SYSTRAP_RUNTIMES,
        command: 'main check --json',
      });

      expect(withoutKvm.status).toBe(0);
      expect(parseGvisorHostReport(withoutKvm.stdout)?.sandboxedKvm).toBe('unsupported');

      const kvmOnly = runKvmScenario({
        cpuinfo: INTEL_CPU,
        devicePresent: true,
        registered: KVM_RUNTIMES,
        command: 'main check',
      });

      expect(kvmOnly.status).toBe(43);
      expect(kvmOnly.stdout).toContain('Sandboxed KVM (runsc-kvm, runsc-kvm-hostnet): registered');
    });

    it('uninstall removes the KVM runtimes too but keeps the persisted KVM modules (microvm level)', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        devicePresent: true,
        registered: [...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES],
        command: `id() { echo 0; }; echo kvm > "$AGENSTRA_KVM_MODULES_LOAD_DIR/agenstra-kvm.conf"; main uninstall; test -e "$AGENSTRA_KVM_MODULES_LOAD_DIR/agenstra-kvm.conf"`,
      });

      expect(result.status).toBe(0);
      expect(result.registered).toEqual([]);
    });

    it('prepares /dev/kvm independently of the gVisor KVM runtimes (GVISOR_KVM=0)', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        modprobeOk: true,
        registered: SYSTRAP_RUNTIMES,
        env: { GVISOR_KVM: '0' },
        command: 'agenstra_kvm_prepare_host',
      });

      expect(result.status).toBe(0);
      expect(result.calls).toEqual(expect.arrayContaining(['modprobe kvm', 'modprobe kvm_intel']));
      expect(result.modulesLoad).toBe('kvm\nkvm_intel\n');
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
    });

    it('skips the host KVM preparation entirely with AGENSTRA_KVM=0', () => {
      const prepare = runKvmScenario({
        cpuinfo: INTEL_CPU,
        modprobeOk: true,
        env: { AGENSTRA_KVM: '0' },
        command: 'agenstra_kvm_prepare_host',
      });
      const install = runKvmScenario({
        cpuinfo: INTEL_CPU,
        modprobeOk: true,
        registered: SYSTRAP_RUNTIMES,
        env: { AGENSTRA_KVM: '0' },
      });

      expect(prepare.status).toBe(1);
      expect(prepare.stderr).toContain('AGENSTRA_KVM=0');
      expect(install.status).toBe(1);
      expect([...prepare.calls, ...install.calls].some((call) => call.startsWith('modprobe'))).toBe(false);
      expect(install.registered).toEqual(SYSTRAP_RUNTIMES);
    });

    it('uninstall-kvm removes only the KVM runtimes (node opted out of KVM)', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        devicePresent: true,
        registered: [...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES],
        command: 'id() { echo 0; }; main uninstall-kvm --json',
      });

      expect(result.status).toBe(0);
      expect(result.registered).toEqual(SYSTRAP_RUNTIMES);
      expect(result.calls.filter((call) => call.startsWith('runsc install'))).toEqual([]);
      expect(parseGvisorHostReport(result.stdout)).toMatchObject({
        sandboxed: 'registered',
        sandboxedKvm: 'not-registered',
      });
    });

    it('install-kvm registers the KVM runtimes on the installed release without downloading anything', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        modprobeOk: true,
        registered: SYSTRAP_RUNTIMES,
        command:
          'id() { echo 0; }; curl() { echo "curl $*" >>"$AGENSTRA_KVM_MODULES_LOAD_DIR/../calls"; return 1; }; main install-kvm --json',
      });

      expect(result.status).toBe(0);
      expect(result.registered).toEqual([...SYSTRAP_RUNTIMES, ...KVM_RUNTIMES]);
      expect(result.calls.some((call) => call.startsWith('curl'))).toBe(false);
      expect(parseGvisorHostReport(result.stdout)).toMatchObject({ sandboxedKvm: 'ready' });
    });

    it('install prepares /dev/kvm even where gVisor cannot be installed', () => {
      const result = runKvmScenario({
        cpuinfo: INTEL_CPU,
        modprobeOk: true,
        command: 'id() { echo 0; }; agenstra_gvisor_kernel_supported() { return 1; }; main install',
      });

      expect(result.status).toBe(GVISOR_HOST_SCRIPT_EXIT_CODES.GVISOR_UNSUPPORTED_HOST);
      expect(result.calls).toEqual(expect.arrayContaining(['modprobe kvm', 'modprobe kvm_intel']));
      expect(result.modulesLoad).toBe('kvm\nkvm_intel\n');
    });
  });

  it('keeps the committed host script in sync with the generator', () => {
    expect(fs.readFileSync(HOST_SCRIPT_PATH, 'utf-8')).toBe(buildGvisorHostScript());
  });
});
