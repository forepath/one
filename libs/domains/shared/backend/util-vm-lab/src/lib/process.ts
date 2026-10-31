import { spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Process helpers of the VM labs (Loadweaver's vm-lab and Agenstra's isolation-lab share them): commands run without a
 * shell, results never reject on a non-zero exit, and `docker` always talks to the lab host's daemon (a tunnelled lab
 * VM socket a spec exported as `DOCKER_HOST` is ignored).
 */

export interface RunResult {
  /** Exit code; a process killed by a signal (timeout) reports 128, a process that never reported one 1. */
  code: number;
  stdout: string;
  stderr: string;
  raw: Buffer;
}

export interface RunOptions {
  input?: string | Buffer;
  /** A file streamed to stdin (large archives: never read into memory); wins over `input`. */
  inputFile?: string;
  timeoutMs?: number;
  /** Called with every stdout chunk (progress of long builds). */
  onStdout?: (chunk: string) => void;
  env?: NodeJS.ProcessEnv;
}

/** Runs a command without a shell; resolves with the exit code (never rejects on a non-zero exit). */
export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'], env: options.env ?? process.env });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs).unref() : undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
      options.onStdout?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);

      reject(error);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);

      const raw = Buffer.concat(out);

      resolve({
        code: code ?? (signal ? 128 : 1),
        raw,
        stdout: raw.toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8') + (signal ? `\n(killed by ${signal})` : ''),
      });
    });
    // A process that exits before reading its input (e.g. a stopped VM) must fail the step, not the run.
    child.stdin.on('error', () => undefined);

    if (options.inputFile) {
      const stream = createReadStream(options.inputFile);

      stream.on('error', (error) => {
        child.kill('SIGKILL');
        reject(error);
      });
      stream.pipe(child.stdin);
    } else child.stdin.end(options.input ?? '');
  });
}

/** Runs a command and throws with its output when it fails; returns stdout (untrimmed). */
export async function runOrThrow(command: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
  const result = await run(command, args, options);

  if (result.code !== 0)
    throw new Error(
      `${command} ${args.slice(0, 4).join(' ')} failed (${result.code}): ${(result.stderr || result.stdout).slice(-2000)}`,
    );

  return result.stdout;
}

/** The environment for `docker` processes: the lab host's daemon, never a lab socket a spec may have exported. */
export function hostDockerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };

  delete copy['DOCKER_HOST'];

  return copy;
}

/** `docker …` against the lab host, throwing with stderr on failure; returns trimmed stdout. */
export async function docker(args: readonly string[], options: RunOptions = {}): Promise<string> {
  const result = await run('docker', args, { ...options, env: hostDockerEnv(options.env) });

  if (result.code !== 0)
    throw new Error(`docker ${args.slice(0, 3).join(' ')} … failed (${result.code}): ${result.stderr.trim()}`);

  return result.stdout.trim();
}

/** Whether `docker …` succeeds on the lab host. */
export async function dockerOk(args: readonly string[]): Promise<boolean> {
  return (await run('docker', args, { env: hostDockerEnv() })).code === 0;
}

/** Tar of small generated files (seeds, scripts), built with the host's tar from a temporary directory. */
export async function tarFiles(files: Record<string, string | Buffer>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'vm-lab-tar-'));

  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);

    const result = await run('tar', ['-C', dir, '-cf', '-', '.']);

    if (result.code !== 0) throw new Error(`tar failed: ${result.stderr}`);

    return result.raw;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `fn` until it returns a value other than `undefined` / `null` / `false`; throws with the last error after
 * `timeoutMs`. An error that is an instance of `FatalWait` ends the wait at once.
 */
export async function eventually<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs = 120_000,
  stepMs = 1_000,
): Promise<T> {
  const start = Date.now();
  let last: unknown;

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined && value !== null && value !== false) return value;
    } catch (error) {
      if (error instanceof FatalWait) throw error;

      last = error;
    }

    if (Date.now() - start > timeoutMs)
      throw new Error(`${what}: not reached in ${timeoutMs} ms${last ? ` (${String(last)})` : ''}`);

    await sleep(stepMs);
  }
}

/** Ends an `eventually` at once (a failed plan doesn't recover by waiting). */
export class FatalWait extends Error {}
