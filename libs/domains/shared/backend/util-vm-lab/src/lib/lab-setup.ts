import { ensureLabLocks, releaseLabLocks } from './locks';
import { assertHostMemory } from './memory';
import { type NestedReport, probeHostNested, writeNestedReport } from './nested';

/**
 * Jest global setup / teardown building blocks of a VM lab run: the locks (heavy + VM lab), the host memory check for
 * the largest spec of the run and the nested-virtualization preflight report the spec files read synchronously.
 */
export async function vmLabGlobalSetup(options: {
  label: string;
  /** Largest lab of the run (MiB of all its containers): checked against the host's available memory now. */
  peakMemoryMb: number;
  /** Image for the preflight containers (the lab's QEMU image). */
  preflightImage?: string;
  log?: (line: string) => void;
}): Promise<NestedReport | null> {
  const log = options.log ?? ((line: string) => process.stderr.write(`[vm-lab] ${line}\n`));

  assertHostMemory(options.peakMemoryMb);
  await ensureLabLocks({ label: options.label, log });

  if (!options.preflightImage) return null;

  const report = await probeHostNested(options.preflightImage);

  writeNestedReport(report);
  log(
    report.verdict === 'available'
      ? `nested virtualization available (${report.cpuVirtualization}, nested=${report.nestedParameter})`
      : `nested virtualization ${report.verdict}: ${report.reasons.join('; ')} — specs needing nested KVM are skipped (VM_LAB_REQUIRE_NESTED=1 fails them)`,
  );

  return report;
}

export async function vmLabGlobalTeardown(): Promise<void> {
  await releaseLabLocks();
}
