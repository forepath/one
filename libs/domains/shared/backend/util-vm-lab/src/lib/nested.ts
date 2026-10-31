import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { run } from './process';

/**
 * Nested virtualization (M7.6): microVMs and full VMs run *inside* lab VMs (Hyper-V → WSL kernel → lab VM →
 * microVM: three levels). A lab VM only has `/dev/kvm` when the host's KVM allows nesting and the VM's CPU shows
 * vmx / svm (`-cpu host`). The harness checks it twice:
 * - preflight (global setup, cheap, no VM): `/dev/kvm` reachable from a container, vmx / svm in the host CPU flags,
 *   the KVM module's `nested` parameter — written to a report file the spec files read synchronously;
 * - per VM after boot (`[ -c /dev/kvm ]` + vmx / svm in the guest), definitive.
 * Without nesting, specs that need it are skipped with the reason (the combined gate decides whether that is
 * acceptable; `VM_LAB_REQUIRE_NESTED=1` turns the skip into a failure). Spike S5 measures the costs.
 */

export type NestedVerdict = 'available' | 'unavailable' | 'unknown';

export interface NestedReport {
  verdict: NestedVerdict;
  /** `/dev/kvm` passes into a container (`--device /dev/kvm`). */
  hostKvm: boolean;
  /** The host CPU (as the container sees it) shows `vmx` or `svm`. */
  cpuVirtualization: 'vmx' | 'svm' | null;
  /** `kvm_intel` / `kvm_amd` `nested` parameter (`Y` / `1` = on), null when unreadable. */
  nestedParameter: string | null;
  reasons: string[];
  checkedAt: string;
}

/** `vmx` / `svm` from `/proc/cpuinfo` (first `flags` line), null when neither is there. */
export function cpuVirtualizationFlag(cpuinfo: string): 'vmx' | 'svm' | null {
  const flags = /^flags\s*:\s*(.*)$/m.exec(cpuinfo)?.[1]?.split(/\s+/) ?? [];

  if (flags.includes('vmx')) return 'vmx';

  if (flags.includes('svm')) return 'svm';

  return null;
}

/** Whether a KVM `nested` module parameter value means "on" (`Y`, `1`). */
export function nestedParameterOn(value: string | null): boolean | null {
  if (value === null) return null;

  const v = value.trim();

  if (v === 'Y' || v === '1') return true;

  if (v === 'N' || v === '0') return false;

  return null;
}

/** The preflight verdict from the three host facts. */
export function nestedVerdict(facts: {
  hostKvm: boolean;
  cpuVirtualization: 'vmx' | 'svm' | null;
  nestedParameter: string | null;
}): { verdict: NestedVerdict; reasons: string[] } {
  const reasons: string[] = [];

  if (!facts.hostKvm) reasons.push('/dev/kvm is not available to containers (no KVM on the lab host at all)');

  if (!facts.cpuVirtualization)
    reasons.push(
      'the host CPU shows no vmx / svm (WSL2: set nestedVirtualization=true in .wslconfig; Docker Desktop VM: enable nested virtualization)',
    );

  const nested = nestedParameterOn(facts.nestedParameter);

  if (nested === false) reasons.push(`the KVM module's nested parameter is ${facts.nestedParameter?.trim()}`);

  if (reasons.length > 0) return { verdict: 'unavailable', reasons };

  if (nested === null) return { verdict: 'unknown', reasons: ['the KVM nested parameter is unreadable'] };

  return { verdict: 'available', reasons: [] };
}

/** Facts of the lab host, read through a throw-away container of `image` (any image with `sh`). */
export async function probeHostNested(image: string): Promise<NestedReport> {
  const hostKvm =
    (await run('docker', ['run', '--rm', '--device', '/dev/kvm', image, 'test', '-c', '/dev/kvm'])).code === 0;
  const cpuinfo = await run('docker', ['run', '--rm', image, 'cat', '/proc/cpuinfo']);
  const nested = await run('docker', [
    'run',
    '--rm',
    image,
    'sh',
    '-c',
    'cat /sys/module/kvm_intel/parameters/nested 2>/dev/null || cat /sys/module/kvm_amd/parameters/nested 2>/dev/null',
  ]);
  const facts = {
    hostKvm,
    cpuVirtualization: cpuVirtualizationFlag(cpuinfo.stdout),
    nestedParameter: nested.code === 0 && nested.stdout.trim() ? nested.stdout.trim() : null,
  };

  return { ...facts, ...nestedVerdict(facts), checkedAt: new Date().toISOString() };
}

/** The check inside a booted lab VM (`exec` runs a bash script as root and resolves with its exit code). */
export const GUEST_NESTED_SCRIPT = `
flag=$(grep -Eow 'vmx|svm' /proc/cpuinfo | head -n1 || true)
[ -n "$flag" ] || { echo "no vmx/svm in the lab VM's CPU"; exit 3; }
modprobe kvm_intel 2>/dev/null || modprobe kvm_amd 2>/dev/null || true
[ -c /dev/kvm ] || { echo "no /dev/kvm in the lab VM ($flag visible, KVM module not loadable)"; exit 4; }
echo "nested KVM ok ($flag)"
`;

export const NESTED_REPORT_ENV = 'VM_LAB_NESTED_REPORT';

/** Where the preflight report lives (shared by global setup and the spec files of one run). */
export function nestedReportPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[NESTED_REPORT_ENV] ?? join(tmpdir(), 'vm-lab', 'nested-report.json');
}

export function writeNestedReport(report: NestedReport, path = nestedReportPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

export function readNestedReport(path = nestedReportPath()): NestedReport | null {
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as NestedReport;
  } catch {
    return null;
  }
}

export interface NestedDecision {
  run: boolean;
  /** Printed when skipped; thrown when nesting is required. */
  reason: string;
}

/**
 * Whether specs needing nested KVM run: yes when available (or unknown — the per-VM check decides then); otherwise
 * skipped with the reason, or failed with `VM_LAB_REQUIRE_NESTED=1`.
 */
export function nestedDecision(
  report: NestedReport | null,
  scenario: string,
  env: NodeJS.ProcessEnv = process.env,
): NestedDecision {
  if (!report || report.verdict !== 'unavailable') return { run: true, reason: '' };

  const reason = `${scenario}: nested KVM unavailable on this lab host — ${report.reasons.join('; ')}`;

  if (env['VM_LAB_REQUIRE_NESTED'] === '1') throw new Error(`${reason} (VM_LAB_REQUIRE_NESTED=1)`);

  return { run: false, reason };
}
