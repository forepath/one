import { withinOneMinor } from '@forepath/loadweaver/shared/util-release';

/** Baked in at build time (webpack DefinePlugin: the release's `VERSION`); undefined in tests and `tsc` builds. */
declare const LOADWEAVER_CLI_VERSION: string | undefined;

export const VERSION = typeof LOADWEAVER_CLI_VERSION === 'string' ? LOADWEAVER_CLI_VERSION : '0.0.0-dev';

let warned = false;

/**
 * The CLI warns (once per run, on stderr) when it is more than one release line behind the control plane it talks to
 * (3.26: clients older than N-1). The control plane names its version in `X-Loadweaver-Version`.
 */
export function checkClusterVersion(
  cluster: string | null,
  warn: (line: string) => void = (l) => process.stderr.write(`${l}\n`),
  cli: string = VERSION,
): void {
  if (warned || !cluster || cli.endsWith('-dev')) return;

  if (!withinOneMinor(cli, cluster)) {
    warned = true;
    warn(`loadweaver: this CLI (${cli}) is more than one release behind the control plane (${cluster}); update it`);
  }
}

/** For tests. */
export function resetVersionWarning(): void {
  warned = false;
}
