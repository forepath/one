import { FrameProtocolError } from './frame';
import { MICROVM_GENERIC_GUEST_ROOT, MICROVM_INTERNAL_ENV_PREFIX } from './constants';
import { BootConfig, isIpLiteral, normalizeStopSignal, parseBootConfig } from './messages';

/**
 * Variables that describe the launcher process rather than the workload: Docker/runc runtime defaults of the
 * launcher root and shell bookkeeping. The guest gets the worker image's own values for these.
 */
const LAUNCHER_ONLY_ENV = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD', 'PATH', 'HOME', 'HOSTNAME', 'TERM']);

export interface BootSnapshotInput {
  /** Environment of the worker image (`env -0` captured at image build time). */
  workerEnv: string[];
  /** Working directory of the worker image. */
  workerWorkdir: string;
  /** The launcher's environment: the image's launcher settings plus everything the agent manager set. */
  containerEnv: NodeJS.ProcessEnv;
  hostname: string;
  hosts: string;
  resolvConf: string;
  argv: string[];
  user: string;
  loopbackPorts: number[];
}

/** Parses NUL-separated `KEY=VALUE` entries (`env -0`), dropping malformed ones. */
export function parseEnvSnapshot(content: string): string[] {
  return content.split('\0').filter((entry) => /^[A-Za-z_][A-Za-z0-9_.-]*=/.test(entry));
}

function resolverDirective(resolvConf: string, directive: 'search' | 'options'): string {
  const line = resolvConf
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${directive} `) || entry.startsWith(`${directive}\t`));

  return line ? line.slice(directive.length).trim().replace(/\s+/g, ' ') : '';
}

/**
 * Builds the guest workload's start configuration: the worker image's environment, overlaid with what the agent
 * manager set on the container (launcher settings `AGENSTRA_MICROVM_*` and launcher-root runtime defaults are not
 * handed to the guest), plus the container's identity (hostname, hosts, resolver search/options).
 */
export function readBootSnapshot(input: BootSnapshotInput): BootConfig {
  const env = new Map<string, string>();

  for (const entry of input.workerEnv) {
    const separator = entry.indexOf('=');
    const name = entry.slice(0, separator);

    if (!['_', 'SHLVL', 'PWD', 'OLDPWD', 'HOSTNAME'].includes(name)) {
      env.set(name, entry.slice(separator + 1));
    }
  }

  for (const [name, value] of Object.entries(input.containerEnv)) {
    if (
      value !== undefined &&
      !name.startsWith(MICROVM_INTERNAL_ENV_PREFIX) &&
      !LAUNCHER_ONLY_ENV.has(name) &&
      /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)
    ) {
      env.set(name, value);
    }
  }

  return parseBootConfig({
    argv: input.argv,
    env: [...env].map(([name, value]) => `${name}=${value}`),
    workdir: input.workerWorkdir || '/',
    user: input.user,
    hostname: input.hostname,
    hosts: input.hosts,
    dnsSearch: resolverDirective(input.resolvConf, 'search'),
    dnsOptions: resolverDirective(input.resolvConf, 'options'),
    loopbackPorts: input.loopbackPorts,
  });
}

/**
 * The workload process of a generic microVM (`/run/loadweaver/vm/boot-process.json`, written by the node agent from
 * `spec.microvm.process`: the image config merged with the compose overrides).
 */
export interface GenericBootProcess {
  entrypoint: string[];
  cmd: string[];
  env: string[];
  user: string;
  workingDir: string;
  stopSignal: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new FrameProtocolError(`Invalid boot process: ${field}`);
  }

  return value as string[];
}

/** Validates the boot process file (shape only; `parseBootConfig` validates the values). */
export function parseGenericBootProcess(value: unknown): GenericBootProcess {
  if (!isRecord(value)) {
    throw new FrameProtocolError('Invalid boot process');
  }

  const text = (field: string): string => {
    const entry = value[field];

    if (entry !== undefined && entry !== null && typeof entry !== 'string') {
      throw new FrameProtocolError(`Invalid boot process: ${field}`);
    }

    return (entry as string | undefined) ?? '';
  };
  const stopSignal = text('stopSignal');

  if (stopSignal && !normalizeStopSignal(stopSignal)) {
    throw new FrameProtocolError('Invalid boot process: stopSignal');
  }

  return {
    entrypoint: strings(value['entrypoint'], 'entrypoint'),
    cmd: strings(value['cmd'], 'cmd'),
    env: strings(value['env'], 'env'),
    user: text('user'),
    workingDir: text('workingDir'),
    stopSignal: stopSignal ? (normalizeStopSignal(stopSignal) as string) : '',
  };
}

/** `nameserver` entries of a resolver configuration that a guest with its own IP can reach (no loopback). */
export function reachableNameservers(resolvConf: string): string[] {
  return resolvConf
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[0] === 'nameserver' && fields[1] && isIpLiteral(fields[1]))
    .map((fields) => fields[1])
    .filter((server) => !server.startsWith('127.') && server !== '::1')
    .slice(0, 8);
}

export interface GenericBootSnapshotInput {
  process: GenericBootProcess;
  hostname: string;
  hosts: string;
  resolvConf: string;
  rootDir?: string;
}

/**
 * Boot configuration of a generic microVM: the workload process from the node agent's boot process file (the image's
 * environment, not the launcher's), the container's identity (hostname, hosts, resolver with the node's DNS servers)
 * and the image root the guest agent chroots the workload into. No loopback relays: the guest owns the workload IP.
 */
export function readGenericBootSnapshot(input: GenericBootSnapshotInput): BootConfig {
  const argv = [...input.process.entrypoint, ...input.process.cmd];

  return parseBootConfig({
    argv,
    env: input.process.env,
    workdir: input.process.workingDir || '/',
    user: input.process.user,
    hostname: input.hostname,
    hosts: input.hosts,
    dnsSearch: resolverDirective(input.resolvConf, 'search'),
    dnsOptions: resolverDirective(input.resolvConf, 'options'),
    dnsServers: reachableNameservers(input.resolvConf),
    loopbackPorts: [],
    rootDir: input.rootDir ?? MICROVM_GENERIC_GUEST_ROOT,
    ...(input.process.stopSignal ? { stopSignal: input.process.stopSignal } : {}),
  });
}
