import './register-paths';

import { vmLabGlobalSetup } from '@forepath/shared/backend/util-vm-lab';

import { ISOLATION_LAB_LABEL } from '../../lib/isolation-lab.config';

/** Largest lab VM container of the run: the microvm spec's 5 GiB guest + 768 MiB QEMU overhead. */
export const ISOLATION_LAB_PEAK_MEMORY_MB = 5120 + 768;

/**
 * Takes the heavy and VM-lab locks once for the whole run. Every spec file runs in its own Jest environment (own
 * `globalThis` / `process.env` copy), so a lock taken by the first spec's `startLabVm` was invisible to the next
 * file, which then found `/tmp/lw-vmlab.lock` held by its own process and failed. Taken here, the token reaches every
 * spec file through the environment and their `startLabVm` calls join this hold.
 */
export default async function globalSetup(): Promise<void> {
  const log = (line: string) => process.stderr.write(`[isolation-lab] ${line}\n`);

  await vmLabGlobalSetup({ label: ISOLATION_LAB_LABEL, peakMemoryMb: ISOLATION_LAB_PEAK_MEMORY_MB, log });
}
