import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Label on every VM lab container / volume (value `run` or `golden`); the cleanup helper removes by label. */
export const LAB_LABEL = 'org.forepath.loadweaver.vm-lab';
export const RUN_LABEL = `${LAB_LABEL}.run`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  raw: Buffer;
}

export interface RunOptions {
  input?: string | Buffer;
  timeoutMs?: number;
  /** Called with every stdout chunk (progress of long builds). */
  onStdout?: (chunk: string) => void;
}

/** Runs a command without a shell; resolves with the exit code (never rejects on a non-zero exit). */
export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs).unref() : undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
      options.onStdout?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
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
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input ?? '');
  });
}

/** `docker …`, throwing with stderr on failure; returns trimmed stdout. */
export async function docker(args: readonly string[], options: RunOptions = {}): Promise<string> {
  const result = await run('docker', args, options);

  if (result.code !== 0)
    throw new Error(`docker ${args.slice(0, 3).join(' ')} … failed (${result.code}): ${result.stderr.trim()}`);

  return result.stdout.trim();
}

export async function dockerOk(args: readonly string[]): Promise<boolean> {
  return (await run('docker', args)).code === 0;
}

/** Tar of small generated files (seeds, scripts), built with the host's tar from a temporary directory. */
export async function tarFiles(files: Record<string, string | Buffer>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'lw-vmlab-'));

  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);

    const result = await run('tar', ['-C', dir, '-cf', '-', '.']);

    if (result.code !== 0) throw new Error(`tar failed: ${result.stderr}`);

    return result.raw;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
