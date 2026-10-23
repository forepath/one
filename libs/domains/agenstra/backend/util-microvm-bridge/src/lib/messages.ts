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
