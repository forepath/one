import { FrameProtocolError, clampTerminalDimension } from './frame';

/** Workload configuration the launcher hands to the guest agent once it said hello. */
export interface BootConfig {
  /** Workload argv (the worker image's original entrypoint + container command). */
  argv: string[];
  /** Container environment (`KEY=VALUE`) the workload and exec sessions start from. */
  env: string[];
  /** Container working directory. */
  workdir: string;
  /** Workload user (`name`, `uid` or `uid:gid`); empty for root. */
  user: string;
  /** Container hostname, applied to the guest. */
  hostname: string;
  /** Container `/etc/hosts` content (Docker-managed), written to the guest's `/etc/hosts`. */
  hosts: string;
  /** `search` / `options` of the container's resolver configuration; the guest's nameserver is the user-mode DNS. */
  dnsSearch: string;
  dnsOptions: string;
  /** Guest loopback ports relayed to the container's loopback (e.g. the egress guard's explicit proxy). */
  loopbackPorts: number[];
  /**
   * Generic mode (additive, protocol 1): the image root the guest agent runs the workload in (chroot + own mount and
   * PID namespaces). Absent for bundled images, whose root is the guest's own root.
   */
  rootDir?: string;
  /** Signal that stops the workload (image `StopSignal`); default `SIGTERM`. */
  stopSignal?: StopSignal;
  /** Name servers of the guest resolver; default the user-mode network's DNS (bundled mode). */
  dnsServers?: string[];
  /** Report `STATS` every n seconds (0 / absent: never). */
  statsIntervalSeconds?: number;
}

/** Guest accounting the guest agent reports with `STATS` (bytes, ratio 0..1, load average). */
export interface GuestStats {
  memTotal: number;
  memAvailable: number;
  cpuSteal: number;
  load1: number;
}

export interface ExecRequest {
  argv: string[];
  /** Exec-specific environment (`KEY=VALUE`), applied on top of the workload environment. */
  env: string[];
  /** `name`, `uid`, `name:group` or `uid:gid`; empty for root. */
  user: string;
  /** Absolute working directory; empty for the workload's working directory. */
  workdir: string;
  tty: boolean;
  cols: number;
  rows: number;
}

export interface ExecExit {
  /** Exit code; for signal deaths `128 + signal number` (shell convention, like `docker exec`). */
  code: number;
  signal: string | null;
}

const ENV_ENTRY = /^[A-Za-z_][A-Za-z0-9_.-]*=/;
const USER_SPEC = /^(?:[A-Za-z_][A-Za-z0-9_.-]{0,31}|\d{1,10})(?::(?:[A-Za-z_][A-Za-z0-9_.-]{0,31}|\d{1,10}))?$/;
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252}[A-Za-z0-9])?$/;
const MAX_ARGV = 4096;
const RESOLVER_LIST = /^[A-Za-z0-9 ._:-]{0,512}$/;
const MAX_HOSTS_FILE = 32 * 1024;
const MAX_ENV = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== 'string')) {
    throw new FrameProtocolError(`Invalid ${field}`);
  }

  if (value.some((entry: string) => entry.includes('\0'))) {
    throw new FrameProtocolError(`Invalid ${field}: NUL byte`);
  }

  return value as string[];
}

function envList(value: unknown, field: string): string[] {
  const entries = stringArray(value, field, MAX_ENV);

  if (entries.some((entry) => !ENV_ENTRY.test(entry))) {
    throw new FrameProtocolError(`Invalid ${field}: entries must be KEY=VALUE`);
  }

  return entries;
}

export function isValidUserSpec(user: string): boolean {
  return user === '' || USER_SPEC.test(user);
}

function userSpec(value: unknown): string {
  const user = value === undefined || value === null ? '' : value;

  if (typeof user !== 'string' || !isValidUserSpec(user)) {
    throw new FrameProtocolError('Invalid user');
  }

  return user;
}

function workdir(value: unknown, allowEmpty: boolean): string {
  const dir = value === undefined || value === null ? '' : value;

  if (typeof dir !== 'string' || dir.includes('\0') || (dir === '' ? !allowEmpty : !dir.startsWith('/'))) {
    throw new FrameProtocolError('Invalid working directory');
  }

  return dir;
}

function port(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new FrameProtocolError('Invalid port');
  }

  return value;
}

export function parseBootConfig(value: unknown): BootConfig {
  if (!isRecord(value)) {
    throw new FrameProtocolError('Invalid boot configuration');
  }

  const argv = stringArray(value['argv'], 'argv', MAX_ARGV);

  if (!argv.length || !argv[0]) {
    throw new FrameProtocolError('Invalid argv: empty');
  }

  const hostname = typeof value['hostname'] === 'string' ? value['hostname'] : '';

  if (hostname && !HOSTNAME.test(hostname)) {
    throw new FrameProtocolError('Invalid hostname');
  }

  const loopbackPorts = Array.isArray(value['loopbackPorts']) ? value['loopbackPorts'].map(port) : [];
  const hosts = typeof value['hosts'] === 'string' ? value['hosts'] : '';
  const dnsSearch = typeof value['dnsSearch'] === 'string' ? value['dnsSearch'].trim() : '';
  const dnsOptions = typeof value['dnsOptions'] === 'string' ? value['dnsOptions'].trim() : '';

  if (hosts.length > MAX_HOSTS_FILE || hosts.includes('\0')) {
    throw new FrameProtocolError('Invalid hosts file');
  }

  if (!RESOLVER_LIST.test(dnsSearch) || !RESOLVER_LIST.test(dnsOptions)) {
    throw new FrameProtocolError('Invalid resolver configuration');
  }

  return {
    argv,
    env: envList(value['env'] ?? [], 'env'),
    workdir: workdir(value['workdir'] || '/', false),
    user: userSpec(value['user']),
    hostname,
    hosts,
    dnsSearch,
    dnsOptions,
    loopbackPorts: [...new Set(loopbackPorts)],
    ...genericFields(value),
  };
}

/** Signals a workload may declare as its stop signal (image `StopSignal`, normalised to `SIG*` names). */
export const STOP_SIGNALS = [
  'SIGTERM',
  'SIGINT',
  'SIGQUIT',
  'SIGHUP',
  'SIGUSR1',
  'SIGUSR2',
  'SIGWINCH',
  'SIGPWR',
  'SIGKILL',
] as const;
export type StopSignal = (typeof STOP_SIGNALS)[number];

/** Normalises a Docker `StopSignal` (`SIGTERM`, `TERM`, `15`); null when it is not one of {@link STOP_SIGNALS}. */
export function normalizeStopSignal(value: string): StopSignal | null {
  const trimmed = value.trim().toUpperCase();
  const byNumber: Readonly<Record<string, StopSignal>> = {
    '1': 'SIGHUP',
    '2': 'SIGINT',
    '3': 'SIGQUIT',
    '9': 'SIGKILL',
    '10': 'SIGUSR1',
    '12': 'SIGUSR2',
    '15': 'SIGTERM',
    '28': 'SIGWINCH',
    '30': 'SIGPWR',
  };
  const name = byNumber[trimmed] ?? (trimmed.startsWith('SIG') ? trimmed : `SIG${trimmed}`);

  return (STOP_SIGNALS as readonly string[]).includes(name) ? (name as StopSignal) : null;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/** True for an IPv4 or IPv6 literal (no zone, no prefix). */
export function isIpLiteral(value: string): boolean {
  return IPV4.test(value) || (value.includes(':') && IPV6.test(value));
}

function genericFields(value: Record<string, unknown>): Partial<BootConfig> {
  const fields: Partial<BootConfig> = {};
  const rootDir = value['rootDir'];

  if (rootDir !== undefined && rootDir !== null && rootDir !== '') {
    if (
      typeof rootDir !== 'string' ||
      !rootDir.startsWith('/') ||
      rootDir === '/' ||
      rootDir.includes('\0') ||
      rootDir.split('/').some((part) => part === '..' || part === '.')
    ) {
      throw new FrameProtocolError('Invalid root directory');
    }

    fields.rootDir = rootDir.replace(/\/+$/, '');
  }

  if (value['stopSignal'] !== undefined && value['stopSignal'] !== null && value['stopSignal'] !== '') {
    const signal = typeof value['stopSignal'] === 'string' ? normalizeStopSignal(value['stopSignal']) : null;

    if (!signal) {
      throw new FrameProtocolError('Invalid stop signal');
    }

    fields.stopSignal = signal;
  }

  if (value['dnsServers'] !== undefined && value['dnsServers'] !== null) {
    const servers = stringArray(value['dnsServers'], 'dnsServers', 8);

    if (servers.some((server) => !isIpLiteral(server))) {
      throw new FrameProtocolError('Invalid dnsServers');
    }

    fields.dnsServers = servers;
  }

  if (value['statsIntervalSeconds'] !== undefined && value['statsIntervalSeconds'] !== null) {
    const interval = value['statsIntervalSeconds'];

    if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 0 || interval > 3600) {
      throw new FrameProtocolError('Invalid statsIntervalSeconds');
    }

    if (interval > 0) {
      fields.statsIntervalSeconds = interval;
    }
  }

  return fields;
}

/** Validates a `STATS` message (numbers are clamped; anything else is a protocol error). */
export function parseGuestStats(value: unknown): GuestStats {
  if (!isRecord(value)) {
    throw new FrameProtocolError('Invalid stats message');
  }

  const number = (field: string, max: number): number => {
    const entry = value[field];

    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new FrameProtocolError(`Invalid stats message: ${field}`);
    }

    return Math.min(Math.max(entry, 0), max);
  };
  const memTotal = number('memTotal', Number.MAX_SAFE_INTEGER);

  return {
    memTotal,
    memAvailable: Math.min(number('memAvailable', Number.MAX_SAFE_INTEGER), memTotal),
    cpuSteal: number('cpuSteal', 1),
    load1: number('load1', 1_000_000),
  };
}

export function parseExecRequest(value: unknown): ExecRequest {
  if (!isRecord(value)) {
    throw new FrameProtocolError('Invalid exec request');
  }

  const argv = stringArray(value['argv'], 'argv', MAX_ARGV);

  if (!argv.length || !argv[0]) {
    throw new FrameProtocolError('Invalid argv: empty');
  }

  return {
    argv,
    env: envList(value['env'] ?? [], 'env'),
    user: userSpec(value['user']),
    workdir: workdir(value['workdir'], true),
    tty: value['tty'] === true,
    cols: clampTerminalDimension(typeof value['cols'] === 'number' ? value['cols'] : 80),
    rows: clampTerminalDimension(typeof value['rows'] === 'number' ? value['rows'] : 24),
  };
}

export function parseOpenTcp(value: unknown): { port: number } {
  if (!isRecord(value)) {
    throw new FrameProtocolError('Invalid TCP request');
  }

  return { port: port(value['port']) };
}

export function parseExecExit(value: unknown): ExecExit {
  if (!isRecord(value) || typeof value['code'] !== 'number' || !Number.isInteger(value['code'])) {
    throw new FrameProtocolError('Invalid exit message');
  }

  return {
    code: Math.min(Math.max(value['code'], 0), 255),
    signal: typeof value['signal'] === 'string' ? value['signal'] : null,
  };
}

export function parseErrorMessage(value: unknown): string {
  if (isRecord(value) && typeof value['message'] === 'string') {
    return value['message'].slice(0, 4096);
  }

  return 'Unknown bridge error';
}

/** Signals an exec client may forward (anything else is dropped). */
export const FORWARDABLE_SIGNALS = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGQUIT',
  'SIGKILL',
  'SIGUSR1',
  'SIGUSR2',
  'SIGWINCH',
] as const;
export type ForwardableSignal = (typeof FORWARDABLE_SIGNALS)[number];

export function parseSignal(payload: Buffer): ForwardableSignal | null {
  const name = payload.toString('utf8');

  return (FORWARDABLE_SIGNALS as readonly string[]).includes(name) ? (name as ForwardableSignal) : null;
}
