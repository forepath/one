import { spawn } from 'child_process';

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a process (no shell), optionally with stdin; never throws for non-zero exit codes. */
export function runProcess(
  command: string,
  args: readonly string[],
  options: { input?: string | Buffer; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : undefined;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
      });
    });

    // A process that exits before reading its input (e.g. a stopped VM) must fail the step, not the run.
    child.stdin.on('error', () => undefined);

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Run a process and throw with its output when it fails. */
export async function runProcessOrThrow(
  command: string,
  args: readonly string[],
  options: { input?: string | Buffer; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const result = await runProcess(command, args, options);

  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.slice(0, 4).join(' ')} failed (${result.code}): ${(result.stderr || result.stdout).slice(-2000)}`,
    );
  }

  return result.stdout;
}

/** `docker ...` against the local Docker (the lab host), throwing on failure. */
export function docker(args: readonly string[], options: { input?: string | Buffer; timeoutMs?: number } = {}) {
  const env = { ...process.env };

  // The lab host's Docker, never a tunnelled lab VM socket a spec may have exported.
  delete env['DOCKER_HOST'];

  return runProcessOrThrow('docker', args, { ...options, env });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
