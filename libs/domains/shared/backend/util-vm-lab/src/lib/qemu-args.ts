/**
 * Pure QEMU argument builders of the lab VMs (unit-tested; the harness only adds paths and names).
 */

/**
 * CPU model of a lab VM: `host` exposes vmx / svm (nested KVM inside the VM: microVMs, full VMs, gVisor's KVM
 * platform); `host,-vmx,-svm` simulates an ordinary cloud VM without nested virtualization.
 */
export function labCpuModel(nested: boolean, cpuFlags: readonly string[] = []): string {
  for (const flag of cpuFlags)
    if (!/^[+-][a-z0-9_.]{1,32}$/.test(flag)) throw new Error(`invalid CPU flag ${flag} (expected +name / -name)`);

  return [nested ? 'host' : 'host,-vmx,-svm', ...cpuFlags].join(',');
}

export interface SwitchVmQemuOptions {
  memoryMb: number;
  cpus: number;
  nested: boolean;
  /** Extra CPU flags (`-avx2`): a node with another CPU (live-migration CPU checks). */
  cpuFlags?: readonly string[];
  tapIndex: number;
  mac: string;
  dataDisk: boolean;
}

/** QEMU arguments of a VM on the lab switch (tap on the site bridge, disks in the run volume at the cwd). */
export function switchVmQemuArgs(options: SwitchVmQemuOptions): string[] {
  if (!Number.isInteger(options.memoryMb) || options.memoryMb < 256)
    throw new Error(`invalid lab VM memory ${options.memoryMb}`);

  if (!Number.isInteger(options.cpus) || options.cpus < 1 || options.cpus > 16)
    throw new Error(`invalid lab VM cpus ${options.cpus}`);

  if (!/^52:54:00(:[0-9a-f]{2}){3}$/.test(options.mac)) throw new Error(`invalid lab VM MAC ${options.mac}`);

  return [
    'qemu-system-x86_64',
    '-enable-kvm',
    '-cpu',
    labCpuModel(options.nested, options.cpuFlags),
    '-smp',
    String(options.cpus),
    '-m',
    String(options.memoryMb),
    '-nographic',
    '-drive',
    'file=disk.qcow2,if=virtio,cache=none,aio=native,discard=unmap',
    ...(options.dataDisk ? ['-drive', 'file=data.qcow2,if=virtio,cache=none,aio=native,discard=unmap'] : []),
    '-drive',
    'file=seed.img,if=virtio,format=raw,readonly=on',
    '-netdev',
    `tap,id=n0,ifname=tap-${options.tapIndex},script=no,downscript=no`,
    '-device',
    `virtio-net-pci,netdev=n0,mac=${options.mac}`,
    '-device',
    'virtio-rng-pci',
  ];
}

/** Address and MAC of the k-th VM (declaration order) in its site (`<prefix>.<site>.11`, `.12`, …). */
export function switchVmAddress(
  subnetPrefix: string,
  siteIndex: number,
  hostIndex: number,
  vmIndex: number,
): { ip: string; mac: string } {
  return {
    ip: `${subnetPrefix}.${siteIndex + 1}.${11 + hostIndex}`,
    mac: `52:54:00:77:${(siteIndex + 1).toString(16).padStart(2, '0')}:${(vmIndex + 1).toString(16).padStart(2, '0')}`,
  };
}
