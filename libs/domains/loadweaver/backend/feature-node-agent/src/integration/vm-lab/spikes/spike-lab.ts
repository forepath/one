import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SpikeRecorder, type SpikeDefinition } from '@forepath/shared/backend/util-vm-lab';

import { startVmLab, type Vm, type VmLab, type VmSpec } from '../vm-lab';
import {
  IMAGE_HINTS,
  LAUNCHER_IMAGE,
  loadImages,
  log,
  type NodeDriver,
  requireImages,
  requireNested,
  startLabRegistry,
  startNodeDriver,
  trustLabRegistry,
  labCertificates,
} from '../m7/m7-lab';

/**
 * Shared setup of the M7 spikes (S1–S10, "Risks and spikes" of the M7 design): lab VMs with nested KVM, the launcher
 * of this tree loaded, the M7 node driver started (the spikes exercise the real launcher / agent paths and measure).
 * Every spike prints what it validates and what to change when it fails (`SpikeRecorder`), its PASS / FAIL verdicts
 * and measurements, and writes them to the results directory.
 */

export interface SpikeLab {
  lab: VmLab;
  vms: Vm[];
  drivers: NodeDriver[];
  /** All VMs have usable nested KVM (else the spike's KVM parts are skipped with the reason). */
  nested: boolean;
  registry?: { host: string; ca: string };
}

export async function startSpikeLab(
  rec: SpikeRecorder,
  options: {
    vms: VmSpec[];
    packages?: string[];
    driver?: boolean;
    registry?: boolean;
    certs?: boolean;
    storage?: boolean;
  },
): Promise<SpikeLab> {
  if (options.driver !== false) await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE] });

  const lab = await rec.time('lab up', () => startVmLab({ vms: options.vms, packages: options.packages, log }));
  const vms = options.vms.map((v) => lab.vms[v.name]);

  for (const vm of vms) rec.measure(`${vm.name} boot to ssh (lab VM)`, vm.bootSeconds, 's');

  let nested = true;

  for (const vm of vms.filter((_, i) => options.vms[i].nested !== false))
    nested = (await requireNested(vm, `spike ${rec.spike.id}`)) && nested;

  rec.note('nested KVM in the lab VMs', nested);

  if (!nested || options.driver === false) return { lab, vms, drivers: [], nested };

  await Promise.all(vms.map((vm) => rec.time(`${vm.name} launcher load`, () => loadImages(vm, [LAUNCHER_IMAGE]))));

  const registry = options.registry ? await startLabRegistry(vms[0]) : undefined;

  if (registry) for (const vm of vms.slice(1)) await trustLabRegistry(vm, registry.host, registry.ca);

  const certs = options.certs ? await labCertificates(vms) : {};
  const drivers = await Promise.all(
    vms.map((vm) =>
      startNodeDriver(vm, {
        storage: options.storage ?? true,
        labCa: registry?.ca,
        certs: certs[vm.name],
        peers: vms.filter((p) => p !== vm),
      }),
    ),
  );

  return { lab, vms, drivers, nested, registry };
}

/** A spike's recorder (prints the banner now). */
export function spikeRecorder(spike: SpikeDefinition): SpikeRecorder {
  return new SpikeRecorder(spike);
}

/** Memory facts of a container (cgroup v2): current / peak bytes and the limit. */
export async function containerMemory(
  vm: Vm,
  container: string,
): Promise<{ current: number; peak: number; limit: number }> {
  const out = await vm.exec(
    [
      `pid=$(docker inspect -f '{{.State.Pid}}' ${container})`,
      'cg=/sys/fs/cgroup$(cut -d: -f3 /proc/$pid/cgroup | head -n1)',
      'echo "$(cat $cg/memory.current) $(cat $cg/memory.peak 2>/dev/null || echo 0) $(cat $cg/memory.max)"',
    ].join('\n'),
  );
  const [current, peak, limit] = out.trim().split(' ');

  return { current: Number(current), peak: Number(peak), limit: limit === 'max' ? Infinity : Number(limit) };
}

/**
 * Stops the spike's lab after writing diagnostics of every VM (driver journal, containers, launcher logs, the launcher
 * run dir's domain XML / libvirt + QEMU logs) to `$VM_LAB_RESULTS_DIR/<spike>-diagnostics-<vm>.log` — a first run of
 * a spike that fails needs them, and the lab is gone afterwards.
 */
export async function stopSpikeLab(rec: SpikeRecorder, s: SpikeLab | undefined): Promise<void> {
  if (!s) return;

  const dir = process.env['VM_LAB_RESULTS_DIR'] ?? join(tmpdir(), 'vm-lab', 'results');

  mkdirSync(dir, { recursive: true });

  for (const vm of s.vms) {
    const text = await vm
      .exec(
        [
          'echo "== docker ps -a"; docker ps -a --format "{{.ID}} {{.Names}} {{.Image}} {{.Status}}" 2>&1',
          'echo "== lw-m7 journal"; journalctl -u lw-m7 --no-pager -n 300 2>&1 | cut -c1-600',
          'for c in $(docker ps -aq --filter label=loadweaver.com/workload); do',
          '  echo "== container $c $(docker inspect -f "{{.Name}} {{.State.Status}} {{.State.ExitCode}} oom={{.State.OOMKilled}}" $c)"',
          '  docker logs --tail 80 $c 2>&1 | cut -c1-400',
          '  pid=$(docker inspect -f "{{.State.Pid}}" $c)',
          '  if [ "$pid" != 0 ]; then',
          '    r=/proc/$pid/root/dev/shm/agenstra-microvm/vmm',
          '    for f in $r/log/libvirt/qemu/*.log $r/cache/libvirt/qemu/log/*.log $r/.cache/libvirt/qemu/log/*.log; do [ -f "$f" ] && { echo "-- $f"; tail -n 40 "$f"; }; done',
          '    ls -la $r 2>&1 | head -30',
          '  fi',
          'done',
          'echo "== dmesg"; dmesg 2>/dev/null | tail -n 40',
        ].join('\n'),
        { allowFailure: true, timeoutMs: 120_000 },
      )
      .catch((error: unknown) => `diagnostics failed: ${String(error)}`);
    const file = join(dir, `spike-${rec.spike.id}-diagnostics-${vm.name}.log`);

    writeFileSync(file, text);
    process.stderr.write(`[vm-lab] spike-${rec.spike.id}: diagnostics of ${vm.name} in ${file}\n`);
  }

  await s.lab.stop();
}
