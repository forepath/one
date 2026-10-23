import { readFileSync } from 'node:fs';

/**
 * Memory budget of a lab run (WSL protection): every VM gets an explicit guest size; its container gets the guest +
 * the QEMU overhead; the whole lab (VM containers + switch) stays within `maxMemoryMb` (default 7 GiB), and the host
 * must have that much available plus a margin before anything starts.
 */

export const DEFAULT_LAB_MAX_MEMORY_MB = 7168;
/** QEMU itself next to the guest RAM (Loadweaver's measured value; Agenstra's single VMs use 768). */
export const DEFAULT_VM_OVERHEAD_MB = 700;
export const DEFAULT_SWITCH_MEMORY_MB = 128;
/** What the host keeps free next to a lab (the light agent's unit tests, the IDE, WSL itself). */
export const DEFAULT_HOST_MARGIN_MB = 1024;

export interface MemoryPlanVm {
  name: string;
  memoryMb: number;
  overheadMb?: number;
}

export interface MemoryPlan {
  vms: { name: string; guestMb: number; containerMb: number }[];
  switchMb: number;
  totalMb: number;
  maxMb: number;
}

/** The lab's memory plan; throws (with every VM's share) when it doesn't fit the guard. */
export function planLabMemory(
  vms: readonly MemoryPlanVm[],
  options: { maxMemoryMb?: number; switchMb?: number; overheadMb?: number } = {},
): MemoryPlan {
  const maxMb = options.maxMemoryMb ?? DEFAULT_LAB_MAX_MEMORY_MB;
  const switchMb = options.switchMb ?? DEFAULT_SWITCH_MEMORY_MB;
  const plan = vms.map((vm) => {
    if (!Number.isInteger(vm.memoryMb) || vm.memoryMb < 256)
      throw new Error(`VM ${vm.name}: explicit guest memory ≥ 256 MiB expected, got ${vm.memoryMb}`);

    return {
      name: vm.name,
      guestMb: vm.memoryMb,
      containerMb: vm.memoryMb + (vm.overheadMb ?? options.overheadMb ?? DEFAULT_VM_OVERHEAD_MB),
    };
  });
  const totalMb = plan.reduce((sum, vm) => sum + vm.containerMb, switchMb);

  if (totalMb > maxMb)
    throw new Error(
      `lab needs ${totalMb} MiB, more than the ${maxMb} MiB guard (${plan
        .map((vm) => `${vm.name} ${vm.guestMb}+${vm.containerMb - vm.guestMb}`)
        .join(', ')}, switch ${switchMb})`,
    );

  return { vms: plan, switchMb, totalMb, maxMb };
}

/** `MemAvailable` of `/proc/meminfo` in MiB (null when missing). */
export function parseMemAvailableMb(meminfo: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);

  return match ? Math.floor(Number(match[1]) / 1024) : null;
}

export function hostMemAvailableMb(): number | null {
  try {
    return parseMemAvailableMb(readFileSync('/proc/meminfo', 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Refuses to start a lab the host can't hold: `neededMb` + margin must be available now (`VM_LAB_SKIP_MEMORY_CHECK=1`
 * skips the check, e.g. on a host without /proc/meminfo).
 */
export function assertHostMemory(
  neededMb: number,
  options: { availableMb?: number | null; marginMb?: number; env?: NodeJS.ProcessEnv } = {},
): void {
  const env = options.env ?? process.env;

  if (env['VM_LAB_SKIP_MEMORY_CHECK'] === '1') return;

  const available = options.availableMb === undefined ? hostMemAvailableMb() : options.availableMb;
  const margin = options.marginMb ?? DEFAULT_HOST_MARGIN_MB;

  if (available === null) return;

  if (available < neededMb + margin)
    throw new Error(
      `the lab needs ${neededMb} MiB + ${margin} MiB margin, but only ${available} MiB are available ` +
        `(free memory first; VM_LAB_SKIP_MEMORY_CHECK=1 skips this check)`,
    );
}
