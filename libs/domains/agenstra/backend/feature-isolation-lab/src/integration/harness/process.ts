import { hostDockerEnv, run, runOrThrow, sleep } from '@forepath/shared/backend/util-vm-lab';

/**
 * Process helpers of the isolation lab: the shared VM-lab harness (`@forepath/shared/backend/util-vm-lab`, M7.6)
 * provides them for Agenstra's isolation-lab and Loadweaver's vm-lab alike; this file keeps the lab's names.
 */

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

type ProcessOptions = { input?: string | Buffer; timeoutMs?: number; env?: NodeJS.ProcessEnv };

/** Run a process (no shell), optionally with stdin; never throws for non-zero exit codes. */
export function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return run(command, args, options);
}

/** Run a process and throw with its output when it fails. */
export function runProcessOrThrow(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<string> {
  return runOrThrow(command, args, options);
}

/** `docker ...` against the local Docker (the lab host), throwing on failure. */
export function docker(args: readonly string[], options: { input?: string | Buffer; timeoutMs?: number } = {}) {
  // The lab host's Docker, never a tunnelled lab VM socket a spec may have exported.
  return runOrThrow('docker', args, { ...options, env: hostDockerEnv() });
}

export { sleep };
