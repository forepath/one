import * as path from 'path';

import {
  buildGvisorInstallScript,
  type GvisorHostReport,
  parseGvisorHostReport,
} from '@forepath/shared/backend/util-container-runtime';

import type { LabVm } from './vm';

/** Repository root (this file: libs/domains/agenstra/backend/feature-isolation-lab/src/integration/harness). */
export const REPO_ROOT = path.resolve(__dirname, '../../../../../../../..');
/** The committed standalone host script (exactly what operators run on self-hosted agent managers). */
export const HOST_SCRIPT_PATH = path.join(REPO_ROOT, 'apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh');
const GUEST_HOST_SCRIPT = '/usr/local/sbin/agenstra-gvisor.sh';

/**
 * Whether scenarios needing KVM inside the lab VM may be skipped (with a visible warning) when the lab
 * host cannot expose nested virtualization. By default a missing /dev/kvm fails the run: KVM scenarios
 * never pass silently.
 */
export const ALLOW_NO_KVM = process.env['ISOLATION_LAB_ALLOW_NO_KVM'] === '1';

/**
 * Run the provider cloud-init gVisor block exactly as provisioning embeds it (after Docker, inside a
 * `set -euo pipefail` script). Returns the script output; throws when the surrounding script fails.
 */
export async function runProvisioningPreparation(vm: LabVm): Promise<string> {
  await vm.writeFile(
    '/root/agenstra-prepare.sh',
    `#!/bin/bash\nset -euo pipefail\n${buildGvisorInstallScript()}\necho AGENSTRA_PREPARATION_DONE\n`,
    '0700',
  );

  const output = await vm.execOrThrow('bash /root/agenstra-prepare.sh 2>&1', { sudo: true, timeoutMs: 20 * 60_000 });

  if (!output.includes('AGENSTRA_PREPARATION_DONE')) {
    throw new Error(`Provisioning preparation did not complete:\n${output.slice(-3000)}`);
  }

  return output;
}

/** Copy the committed host script into the VM and run it; returns the exit code and parsed report. */
export async function runHostScript(
  vm: LabVm,
  command: 'check' | 'install' | 'uninstall',
): Promise<{ code: number | null; report: GvisorHostReport | null; output: string }> {
  await vm.copyIn(HOST_SCRIPT_PATH, GUEST_HOST_SCRIPT, '0755');

  const result = await vm.exec(`${GUEST_HOST_SCRIPT} ${command} --json`, { sudo: true, timeoutMs: 20 * 60_000 });

  return { code: result.code, report: parseGvisorHostReport(result.stdout), output: result.stdout + result.stderr };
}

/** Registered Docker runtimes of the VM with their arguments (`docker info`). */
export async function labDockerRuntimes(vm: LabVm): Promise<Record<string, string[]>> {
  const raw = await vm.execOrThrow(`docker info --format '{{json .Runtimes}}'`);
  const runtimes = JSON.parse(raw) as Record<string, { runtimeArgs?: string[] } | null>;

  return Object.fromEntries(Object.entries(runtimes).map(([name, value]) => [name, value?.runtimeArgs ?? []]));
}

/** Whether the VM exposes a usable /dev/kvm (nested virtualization of the lab host). */
export async function labKvmAvailable(vm: LabVm): Promise<boolean> {
  const result = await vm.exec('test -c /dev/kvm');

  return result.code === 0;
}

/** Whether the VM's CPU exposes hardware virtualization (nested virtualization of the lab host). */
export async function labVirtualizationExposed(vm: LabVm): Promise<boolean> {
  const result = await vm.exec(`grep -Eqw 'vmx|svm' /proc/cpuinfo`);

  return result.code === 0;
}

/**
 * Guard for KVM scenarios: fails (default) or warns and returns `false` (ISOLATION_LAB_ALLOW_NO_KVM=1)
 * when the VM's CPU exposes no hardware virtualization. Checked on the CPU flags (not /dev/kvm), so it
 * does not depend on the KVM module being loaded before the host preparation ran.
 */
export async function requireLabKvm(vm: LabVm, scenario: string): Promise<boolean> {
  if (await labVirtualizationExposed(vm)) {
    return true;
  }

  const message = `${scenario}: the lab VM exposes no hardware virtualization (the lab host does not expose nested virtualization)`;

  if (!ALLOW_NO_KVM) {
    throw new Error(`${message}. Set ISOLATION_LAB_ALLOW_NO_KVM=1 to skip KVM scenarios explicitly.`);
  }

  console.warn(`SKIPPED (explicit): ${message}`);

  return false;
}
