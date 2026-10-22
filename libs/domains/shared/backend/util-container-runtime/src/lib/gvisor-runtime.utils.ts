/** Platform and network mode a gVisor Docker runtime was registered with (from its `runtimeArgs`). */
export interface GvisorRuntimeArgs {
  /** `--platform` value (`systrap`, `kvm`, ...); `null` when not set (gVisor's default platform). */
  platform: string | null;
  /** `--network` value (`host`, `none`, `sandbox`); `null` when not set (Netstack). */
  network: string | null;
}

function flagValue(args: readonly string[], flag: string): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === `--${flag}` || arg === `-${flag}`) {
      const next = args[index + 1];

      return typeof next === 'string' && !next.startsWith('-') ? next : null;
    }

    for (const prefix of [`--${flag}=`, `-${flag}=`]) {
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length) || null;
      }
    }
  }

  return null;
}

/** Parse the `runtimeArgs` Docker reports for a runtime (`docker info` -> `Runtimes.<name>.runtimeArgs`). */
export function parseGvisorRuntimeArgs(runtimeArgs: readonly unknown[] | null | undefined): GvisorRuntimeArgs {
  const args = Array.isArray(runtimeArgs) ? runtimeArgs.filter((arg): arg is string => typeof arg === 'string') : [];

  return { platform: flagValue(args, 'platform'), network: flagValue(args, 'network') };
}

/** KVM facts reported by the host script (`check --json` -> `kvm`). */
export interface GvisorHostKvmFacts {
  cpu: 'yes' | 'no' | 'unknown';
  device: 'present' | 'absent';
  module: 'loaded' | 'absent';
  nested: 'yes' | 'no' | 'unknown';
  hypervisor: 'yes' | 'no';
}

/** Machine-readable report of the standalone host script (`agenstra-gvisor.sh <command> --json`). */
export interface GvisorHostReport {
  runtime: string;
  sharedNetnsRuntime: string;
  release: string;
  standard: string;
  sandboxed: string;
  kvmRuntime?: string;
  kvmSharedNetnsRuntime?: string;
  sandboxedKvm?: string;
  kvm?: GvisorHostKvmFacts;
}

/** Parse the last JSON line of the host script output; `null` when there is none. */
export function parseGvisorHostReport(output: string): GvisorHostReport | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'));

  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(lines[index]) as GvisorHostReport;

      if (parsed && typeof parsed.runtime === 'string' && typeof parsed.standard === 'string') {
        return parsed;
      }
    } catch {
      // not the report line
    }
  }

  return null;
}
