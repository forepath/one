import { MICROVM_TAP_GATEWAY_V4, MICROVM_TAP_GATEWAY_V6, MICROVM_TAP_PREFIX } from './constants';
import { isIpLiteral } from './messages';

/**
 * Configuration files the node agent writes into the launcher's run directory (`/run/loadweaver/vm`) and the
 * launcher scripts turn into kernel command lines and libvirt domains. Everything is validated here, so the scripts
 * never interpolate unchecked values into XML or command lines.
 */
export class LauncherConfigError extends Error {}

const MAC = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/;
const TAP = new RegExp(`^${MICROVM_TAP_PREFIX}\\d{1,2}$`);
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const BLOCK_DEVICE = /^\/dev\/drbd\d{1,6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mac(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.toLowerCase() : '';

  // Unicast, not all-zero.
  if (!MAC.test(text) || (parseInt(text.slice(0, 2), 16) & 1) === 1 || text === '00:00:00:00:00:00') {
    throw new LauncherConfigError(`invalid ${field}`);
  }

  return text;
}

function mtu(value: unknown): number {
  if (value === undefined || value === null) {
    return 1500;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1280 || value > 9000) {
    throw new LauncherConfigError('invalid mtu');
  }

  return value;
}

function address(value: unknown, family: 4 | 6): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string' || !isIpLiteral(value) || value.includes(':') !== (family === 6)) {
    throw new LauncherConfigError(`invalid ipv${family}`);
  }

  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new LauncherConfigError(`invalid ${field}`);
  }

  return value;
}

/** Guest addressing of a generic microVM (`net.json`): one NIC, static, link-local gateways. */
export interface MicrovmNetConfig {
  mac: string;
  mtu: number;
  ipv4?: string;
  ipv6?: string;
}

export function parseMicrovmNetConfig(value: unknown): MicrovmNetConfig {
  if (!isRecord(value)) {
    throw new LauncherConfigError('invalid network configuration');
  }

  const config: MicrovmNetConfig = { mac: mac(value['mac'], 'mac'), mtu: mtu(value['mtu']) };
  const ipv4 = address(value['ipv4'], 4);
  const ipv6 = address(value['ipv6'], 6);

  if (!ipv4 && !ipv6) {
    throw new LauncherConfigError('the guest needs an IPv4 or IPv6 address');
  }

  return { ...config, ...(ipv4 ? { ipv4 } : {}), ...(ipv6 ? { ipv6 } : {}) };
}

/** Kernel command line parameters `initramfs-init-generic` applies with busybox `ip`. */
export function renderGuestNetCmdline(net: MicrovmNetConfig): string {
  const parts = [`lw.mac=${net.mac}`, `lw.mtu=${net.mtu}`];

  if (net.ipv4) {
    parts.push(`lw.ip4=${net.ipv4}/32`, `lw.gw4=${MICROVM_TAP_GATEWAY_V4}`);
  }

  if (net.ipv6) {
    parts.push(`lw.ip6=${net.ipv6}/128`, `lw.gw6=${MICROVM_TAP_GATEWAY_V6}`);
  }

  return parts.join(' ');
}

/** A full VM as the launcher boots it (`vm.json`, written by the node agent from `spec.vm`). */
export interface VmLaunchConfig {
  uid: string;
  firmware: 'uefi' | 'bios';
  cpuModel: 'host-model' | 'host-passthrough';
  vcpus: number;
  memoryMiB: number;
  graphics: boolean;
  /** qemu-guest-agent channel (fsfreeze for consistent snapshots). */
  guestAgent: boolean;
  disks: { name: string; device: string; cache: 'none' | 'writeback'; boot: boolean }[];
  nics: { name: string; mac: string; tap: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseVmLaunchConfig(value: unknown): VmLaunchConfig {
  if (!isRecord(value)) {
    throw new LauncherConfigError('invalid VM configuration');
  }

  const uid = typeof value['uid'] === 'string' ? value['uid'].toLowerCase() : '';

  if (!UUID.test(uid)) {
    throw new LauncherConfigError('invalid uid');
  }

  const firmware = value['firmware'] ?? 'uefi';
  const cpuModel = value['cpuModel'] ?? 'host-model';

  if (firmware !== 'uefi' && firmware !== 'bios') {
    throw new LauncherConfigError('invalid firmware');
  }

  if (cpuModel !== 'host-model' && cpuModel !== 'host-passthrough') {
    throw new LauncherConfigError('invalid cpuModel');
  }

  if (!Array.isArray(value['disks']) || !value['disks'].length || value['disks'].length > 8) {
    throw new LauncherConfigError('a VM needs 1 to 8 disks');
  }

  const disks = value['disks'].map((disk: unknown) => {
    if (!isRecord(disk) || typeof disk['name'] !== 'string' || !NAME.test(disk['name'])) {
      throw new LauncherConfigError('invalid disk name');
    }

    if (typeof disk['device'] !== 'string' || !BLOCK_DEVICE.test(disk['device'])) {
      throw new LauncherConfigError(`invalid device of disk ${disk['name']}`);
    }

    const cache = disk['cache'] ?? 'none';

    if (cache !== 'none' && cache !== 'writeback') {
      throw new LauncherConfigError(`invalid cache of disk ${disk['name']}`);
    }

    return { name: disk['name'], device: disk['device'], cache, boot: disk['boot'] === true } as const;
  });

  if (disks.filter((disk) => disk.boot).length !== 1) {
    throw new LauncherConfigError('exactly one disk must be the boot disk');
  }

  if (new Set(disks.map((disk) => disk.name)).size !== disks.length) {
    throw new LauncherConfigError('disk names must be unique');
  }

  if (new Set(disks.map((disk) => disk.device)).size !== disks.length) {
    throw new LauncherConfigError('disk devices must be unique');
  }

  if (!Array.isArray(value['nics']) || !value['nics'].length || value['nics'].length > 8) {
    throw new LauncherConfigError('a VM needs 1 to 8 NICs');
  }

  const nics = value['nics'].map((nic: unknown) => {
    if (!isRecord(nic) || typeof nic['name'] !== 'string' || !NAME.test(nic['name'])) {
      throw new LauncherConfigError('invalid NIC name');
    }

    if (typeof nic['tap'] !== 'string' || !TAP.test(nic['tap'])) {
      throw new LauncherConfigError(`invalid tap of NIC ${nic['name']}`);
    }

    return { name: nic['name'], mac: mac(nic['mac'], `mac of NIC ${nic['name']}`), tap: nic['tap'] };
  });

  for (const key of ['name', 'mac', 'tap'] as const) {
    if (new Set(nics.map((nic) => nic[key])).size !== nics.length) {
      throw new LauncherConfigError(`NIC ${key}s must be unique`);
    }
  }

  return {
    uid,
    firmware,
    cpuModel,
    vcpus: integer(value['vcpus'], 'vcpus', 1, 64),
    memoryMiB: integer(value['memoryMiB'], 'memoryMiB', 256, 1_048_576),
    graphics: value['graphics'] === true,
    guestAgent: value['guestAgent'] !== false,
    disks: [...disks.filter((disk) => disk.boot), ...disks.filter((disk) => !disk.boot)],
    nics,
  };
}

export type LauncherArch = 'x86_64' | 'aarch64';

/** Machine, console and firmware per architecture (Debian `ovmf` / `qemu-efi-aarch64` in the launcher image). */
export const VM_PLATFORM: Readonly<
  Record<LauncherArch, { machine: string; uefiCode: string; uefiVars: string; bios: boolean }>
> = {
  x86_64: {
    machine: 'q35',
    uefiCode: '/usr/share/OVMF/OVMF_CODE_4M.fd',
    uefiVars: '/usr/share/OVMF/OVMF_VARS_4M.fd',
    bios: true,
  },
  aarch64: {
    machine: 'virt',
    uefiCode: '/usr/share/AAVMF/AAVMF_CODE.fd',
    uefiVars: '/usr/share/AAVMF/AAVMF_VARS.fd',
    bios: false,
  },
};

export const VM_DOMAIN_NAME = 'lw-vm';

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

/**
 * libvirt domain of a full VM: DRBD block disks as virtio-blk (boot disk first), one tap per NIC (pre-created by
 * the node agent, `managed='no'`), the cloud-init seed as a read-only virtio-blk disk after the data disks (a vfat
 * CIDATA image can't be mounted from a CD-ROM: 2048-byte sectors, "FAT-fs: logical sector size too small for device"
 * — cloud-init then falls back to DataSourceNone; G5), serial console and (with
 * `graphics`) VNC on UNIX sockets in the run directory, and the qemu-guest-agent channel.
 */
export function renderVmDomainXml(options: {
  config: VmLaunchConfig;
  arch: LauncherArch;
  runDir: string;
  seedImage?: string;
}): string {
  const { config, arch, runDir } = options;
  const platform = VM_PLATFORM[arch];

  if (config.firmware === 'bios' && !platform.bios) {
    throw new LauncherConfigError(`BIOS firmware is not available on ${arch}`);
  }

  const dir = xml(runDir);
  const os =
    config.firmware === 'uefi'
      ? [
          `    <type arch='${arch}' machine='${platform.machine}'>hvm</type>`,
          `    <loader readonly='yes' type='pflash'>${platform.uefiCode}</loader>`,
          `    <nvram template='${platform.uefiVars}'>${dir}/nvram.fd</nvram>`,
          `    <boot dev='hd'/>`,
        ]
      : [`    <type arch='${arch}' machine='${platform.machine}'>hvm</type>`, `    <boot dev='hd'/>`];
  const disks = config.disks.map((disk, index) => {
    const driver =
      disk.cache === 'none'
        ? `<driver name='qemu' type='raw' cache='none' io='native' discard='unmap'/>`
        : `<driver name='qemu' type='raw' cache='writeback' io='threads' discard='unmap'/>`;

    return `    <disk type='block' device='disk'>${driver}<source dev='${disk.device}'/><target dev='vd${String.fromCharCode(97 + index)}' bus='virtio'/><serial>${xml(disk.name)}</serial></disk>`;
  });
  const nics = config.nics.map(
    (nic) =>
      `    <interface type='ethernet'><mac address='${nic.mac}'/><target dev='${nic.tap}' managed='no'/><model type='virtio'/>${config.vcpus > 1 ? `<driver queues='${Math.min(config.vcpus, 8)}'/>` : ''}</interface>`,
  );
  const devices = [
    `    <emulator>/usr/bin/qemu-system-${arch}</emulator>`,
    ...disks,
    ...(options.seedImage
      ? [
          `    <disk type='file' device='disk'><driver name='qemu' type='raw'/><source file='${xml(options.seedImage)}'/><target dev='vd${String.fromCharCode(97 + config.disks.length)}' bus='virtio'/><readonly/><serial>cidata</serial></disk>`,
        ]
      : []),
    ...nics,
    `    <serial type='unix'><source mode='bind' path='${dir}/console.sock'/><target port='0'/></serial>`,
    ...(config.guestAgent
      ? [
          `    <channel type='unix'><source mode='bind' path='${dir}/qga.sock'/><target type='virtio' name='org.qemu.guest_agent.0'/></channel>`,
        ]
      : []),
    ...(config.graphics
      ? [
          `    <graphics type='vnc' socket='${dir}/vnc.sock'/>`,
          `    <video><model type='virtio' heads='1' primary='yes'/></video>`,
          `    <input type='tablet' bus='usb'/>`,
          `    <input type='keyboard' bus='usb'/>`,
          ...(arch === 'aarch64' ? [`    <controller type='usb' model='qemu-xhci'/>`] : []),
        ]
      : []),
    `    <memballoon model='virtio'/>`,
    `    <rng model='virtio'><backend model='random'>/dev/urandom</backend></rng>`,
  ];

  return [
    `<domain type='kvm'>`,
    `  <name>${VM_DOMAIN_NAME}</name>`,
    `  <uuid>${config.uid}</uuid>`,
    `  <memory unit='MiB'>${config.memoryMiB}</memory>`,
    `  <vcpu>${config.vcpus}</vcpu>`,
    `  <os>`,
    ...os,
    `  </os>`,
    `  <features><acpi/>${arch === 'x86_64' ? '<apic/>' : "<gic version='host'/>"}</features>`,
    `  <cpu mode='${config.cpuModel}'/>`,
    `  <clock offset='utc'/>`,
    `  <on_poweroff>destroy</on_poweroff>`,
    `  <on_reboot>restart</on_reboot>`,
    `  <on_crash>destroy</on_crash>`,
    `  <devices>`,
    ...devices,
    `  </devices>`,
    `</domain>`,
    '',
  ].join('\n');
}
