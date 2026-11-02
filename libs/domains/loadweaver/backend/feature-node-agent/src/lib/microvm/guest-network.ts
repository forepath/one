import { createHash } from 'node:crypto';

import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  MICROVM_TAP_PREFIX,
  MICROVM_VMM_UID,
  type MicrovmNetConfig,
} from '@forepath/shared/backend/util-microvm-bridge';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';

/**
 * Tap networking of generic microVMs and full VMs (3.35, M7.2 / M7.3): the guest owns the workload IP. The node
 * agent creates one tap per guest NIC in the launcher's network namespace (QEMU needs no NET_ADMIN), takes the
 * container interface's own L3 presence away, and redirects frames between the interface and the tap with tc
 * (mirred, the Kata pattern). Frames from the guest only pass with its MAC and addresses (tc ingress runs before
 * netfilter in that namespace, so anti-spoofing must happen in tc); the host's subnet anti-spoofing and the kept
 * veths' table still apply behind it.
 *
 * Guests address themselves statically (`net.json` → kernel command line, or cloud-init for full VMs): `<v4>/32` via
 * the link-local gateway `169.254.1.1` (on-link) and `<v6>/128` via `fe80::1`, which the pod bridge and every kept
 * veth own. A migrated guest's routes never change.
 *
 * NICs: a generic microVM has one (`eth0` ↔ `lwtap0`); a full VM one per `vm.nics[]`, the first on the workload's
 * network (`eth0`), each further one on its own container interface (a kept-address network endpoint) ↔ `lwtap<n>`.
 */

/** Container interface name prefix Docker gives endpoints inside the namespace. */
const CONTAINER_INTERFACE = /^eth\d{1,2}$/;
const DEFAULT_MTU = 1500;

export interface GuestNic {
  index: number;
  tap: string;
  mac: string;
  /** The NIC's workload addresses (v4 and / or v6). */
  addresses: string[];
}

/** A generic microVM's guest MAC: QEMU's prefix 52:54:00 + 3 bytes of sha256(workload id) (stable across restarts). */
export function microvmMac(workloadId: string): string {
  const hex = createHash('sha256').update(workloadId).digest('hex');

  return `52:54:00:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`;
}

/** The guest's IPv6 link-local address from its MAC (EUI-64), used for neighbour discovery / router solicitation. */
export function eui64LinkLocal(mac: string): string {
  const b = mac.split(':').map((x) => parseInt(x, 16));

  if (b.length !== 6 || b.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error(`invalid MAC ${mac}`);

  const words = [((b[0] ^ 0x02) << 8) | b[1], (b[2] << 8) | 0xff, 0xfe00 | b[3], (b[4] << 8) | b[5]];

  return `fe80::${words.map((w) => w.toString(16)).join(':')}`;
}

/** Whether the workload runs a guest that owns its IP through taps (generic microVM or full VM). */
export function usesTapNetworking(spec: Pick<WorkloadSpec, 'microvm' | 'vm'>): boolean {
  return !!spec.vm || spec.microvm?.mode === 'generic';
}

/**
 * The IPv4 address the container side of a full VM's further NIC (`index` ≥ 1) carries until the tap is attached
 * (then flushed): a link-local placeholder per slot, never the guest's address — that one lies in the pod network's
 * subnet as often as not, and Docker refuses to program an address inside a route of another interface ("conflicts
 * with existing route", G5), depending on the order it attaches the networks. The real addresses reach the kept
 * plugin as endpoint driver options (`KEPT_NIC_ADDRESSES_OPTION`).
 */
export function extraNicCarrierV4(index: number): string {
  return `169.254.2.${index}`;
}

/** The addresses the NIC's container interface carries before the attach (what {@link linksForNics} looks for). */
export function nicCarrierAddresses(nic: Pick<GuestNic, 'index' | 'addresses'>): string[] {
  if (nic.index === 0) return nic.addresses;

  return nic.addresses.map((a) => (a.includes(':') ? a : extraNicCarrierV4(nic.index)));
}

/** The guest NICs of a workload; none for containers and bundled microVMs (their own user-mode networking). */
export function guestNics(spec: Pick<WorkloadSpec, 'id' | 'addresses' | 'microvm' | 'vm'>): GuestNic[] {
  if (spec.vm)
    return spec.vm.nics.map((nic, index) => ({
      index,
      tap: `${MICROVM_TAP_PREFIX}${index}`,
      mac: nic.mac,
      addresses: index === 0 ? spec.addresses : nic.addresses,
    }));

  if (spec.microvm?.mode === 'generic')
    return [{ index: 0, tap: `${MICROVM_TAP_PREFIX}0`, mac: microvmMac(spec.id), addresses: spec.addresses }];

  return [];
}

/** `net.json` of a generic microVM (`{mac, mtu, ipv4?, ipv6?}`, the launcher's contract). */
export function guestNetConfig(nic: GuestNic, mtu: number): MicrovmNetConfig {
  const v4 = nic.addresses.find((a) => !a.includes(':'));
  const v6 = nic.addresses.find((a) => a.includes(':'));

  return { mac: nic.mac, mtu, ...(v4 ? { ipv4: v4 } : {}), ...(v6 ? { ipv6: v6 } : {}) };
}

/** The MTU of a Docker network's endpoints (`com.docker.network.driver.mtu`, Docker's default 1500). */
export async function networkMtu(docker: Docker, network: string): Promise<number> {
  const info = (await docker
    .getNetwork(network)
    .inspect()
    .catch(() => null)) as { Options?: Record<string, string> } | null;
  const mtu = Number(info?.Options?.['com.docker.network.driver.mtu']);

  return Number.isInteger(mtu) && mtu >= 576 && mtu <= 65_535 ? mtu : DEFAULT_MTU;
}

export interface NamespaceLink {
  ifname: string;
  mtu: number;
  addresses: string[];
}

/** Commands for the whole namespace (once): the launcher answers no ARP for anything (its interfaces lose L3). */
export function renderNamespaceCommands(): string[][] {
  return [['sysctl', '-q', '-w', 'net.ipv4.conf.all.arp_ignore=8']];
}

/**
 * Commands (run inside the launcher's network namespace) that connect one guest NIC: the container interface takes
 * the guest's MAC, a tap owned by the VMM user, the interface's addresses removed, and the tc redirects with
 * anti-spoofing from the tap: only the guest's MAC with its addresses (IPv4, ARP, IPv6, its EUI-64 link-local, DAD
 * from `::`); everything else is dropped.
 */
export function renderGuestNetworkCommands(nic: GuestNic, link: NamespaceLink, queues: number): string[][] {
  const { ifname } = link;
  const tap = nic.tap;
  const v4 = nic.addresses.find((a) => !a.includes(':'));
  const v6 = nic.addresses.find((a) => a.includes(':'));
  const redirect = ['action', 'mirred', 'egress', 'redirect', 'dev', ifname];
  const filter = (prio: number, protocol: string, ...match: string[]) => [
    'tc',
    'filter',
    'add',
    'dev',
    tap,
    'parent',
    'ffff:',
    'prio',
    String(prio),
    'protocol',
    protocol,
    'flower',
    'src_mac',
    nic.mac,
    ...match,
    ...redirect,
  ];

  return [
    ['ip', 'link', 'set', 'dev', ifname, 'address', nic.mac],
    [
      'ip',
      'tuntap',
      'add',
      'dev',
      tap,
      'mode',
      'tap',
      // Owner only (spike S1): the kernel lets a non-root process attach to a tap when *both* the owner and a set
      // group match its credentials; the launcher image's agenstra-vmm group is a system gid (not 10930), so a group
      // here makes the session libvirt's TUNSETIFF fail with EPERM.
      'user',
      String(MICROVM_VMM_UID),
      ...(queues > 1 ? ['multi_queue'] : []),
    ],
    ['ip', 'link', 'set', 'dev', tap, 'mtu', String(link.mtu), 'up'],
    // The launcher has no network of its own: exec goes over virtio-serial.
    ['ip', 'addr', 'flush', 'dev', ifname],
    ['sysctl', '-q', '-w', `net.ipv6.conf.${ifname}.disable_ipv6=1`],
    ['tc', 'qdisc', 'add', 'dev', ifname, 'ingress'],
    ['tc', 'qdisc', 'add', 'dev', tap, 'ingress'],
    // Everything arriving for the guest goes to the tap.
    [
      'tc',
      'filter',
      'add',
      'dev',
      ifname,
      'parent',
      'ffff:',
      'prio',
      '1',
      'matchall',
      'action',
      'mirred',
      'egress',
      'redirect',
      'dev',
      tap,
    ],
    ...(v4 ? [filter(10, 'ip', 'src_ip', v4), filter(11, 'arp', 'arp_sip', v4, 'arp_sha', nic.mac)] : []),
    ...(v6 ? [filter(12, 'ipv6', 'src_ip', v6)] : []),
    filter(13, 'ipv6', 'src_ip', eui64LinkLocal(nic.mac)),
    filter(14, 'ipv6', 'src_ip', '::', 'ip_proto', 'icmpv6'),
    ['tc', 'filter', 'add', 'dev', tap, 'parent', 'ffff:', 'prio', '99', 'matchall', 'action', 'drop'],
  ];
}

interface IpAddrJson {
  ifname?: string;
  mtu?: number;
  addr_info?: { local?: string }[];
}

/** Maps every NIC to the container interface that carries its (carrier) address. */
export function linksForNics(nics: readonly GuestNic[], links: readonly IpAddrJson[]): Map<number, NamespaceLink> {
  const result = new Map<number, NamespaceLink>();

  for (const nic of nics) {
    const link = links.find(
      (l) =>
        !!l.ifname &&
        CONTAINER_INTERFACE.test(l.ifname) &&
        (l.addr_info ?? []).some((a) => !!a.local && nicCarrierAddresses(nic).includes(a.local)),
    );

    if (!link?.ifname)
      throw new Error(`no container interface carries ${nicCarrierAddresses(nic).join(' / ')} (NIC ${nic.index})`);

    result.set(nic.index, {
      ifname: link.ifname,
      mtu: link.mtu && link.mtu >= 576 ? link.mtu : DEFAULT_MTU,
      addresses: (link.addr_info ?? []).flatMap((a) => (a.local ? [a.local] : [])),
    });
  }

  return result;
}

@Injectable()
export class GuestNetwork {
  private readonly logger = new Logger(GuestNetwork.name);
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly commands: CommandRunner,
    @Inject(DOCKER) private readonly docker: Docker,
  ) {}

  private ns(pid: number, argv: string[]): Promise<unknown> {
    const [command, ...args] = argv;

    return this.commands.run('nsenter', ['-t', String(pid), '-n', '--', command, ...args]);
  }

  /**
   * Connects the guest NICs of a started launcher (after `start()` and on every Docker `start` event: each start
   * has a fresh network namespace). Idempotent: a namespace that already has the taps is left alone. Returns false
   * when the workload has no tap networking or the container doesn't run.
   */
  async attach(containerId: string, spec: Pick<WorkloadSpec, 'id' | 'addresses' | 'microvm' | 'vm'>): Promise<boolean> {
    // One attach per container at a time: the apply and the Docker `start` event both attach a fresh launcher, and
    // two concurrent `ip tuntap add` in one namespace fail with EBUSY (spike S1); the second call then sees the taps.
    const previous = this.inFlight.get(containerId) ?? Promise.resolve(false);
    const current = previous.catch(() => false).then(() => this.attachNow(containerId, spec));

    this.inFlight.set(containerId, current);

    try {
      return await current;
    } finally {
      if (this.inFlight.get(containerId) === current) this.inFlight.delete(containerId);
    }
  }

  private async attachNow(
    containerId: string,
    spec: Pick<WorkloadSpec, 'id' | 'addresses' | 'microvm' | 'vm'>,
  ): Promise<boolean> {
    const nics = guestNics(spec);

    if (nics.length === 0) return false;

    const info = await this.docker.getContainer(containerId).inspect();
    const pid = info.State?.Pid;

    if (!info.State?.Running || !pid) return false;

    const { stdout } = await this.commands.run('nsenter', ['-t', String(pid), '-n', '--', 'ip', '-j', 'addr', 'show']);
    const links = JSON.parse(stdout || '[]') as IpAddrJson[];

    if (links.some((l) => l.ifname === nics[0].tap)) return true;

    const byNic = linksForNics(nics, links);
    const queues = Math.min(spec.vm?.vcpus ?? spec.microvm?.vcpus ?? 1, 8);

    for (const argv of renderNamespaceCommands()) await this.ns(pid, argv);

    for (const nic of nics)
      for (const argv of renderGuestNetworkCommands(nic, byNic.get(nic.index) as NamespaceLink, queues))
        await this.ns(pid, argv);

    this.logger.log(`Connected ${nics.length} guest NIC(s) of ${spec.id} (${nics.map((n) => n.tap).join(', ')})`);

    return true;
  }
}
