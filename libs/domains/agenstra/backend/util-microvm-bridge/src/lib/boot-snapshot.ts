import { MICROVM_INTERNAL_ENV_PREFIX } from './constants';
import { BootConfig, parseBootConfig } from './messages';

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
