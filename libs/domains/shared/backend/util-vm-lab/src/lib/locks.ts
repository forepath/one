import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename } from 'node:path';

import { onLabExit } from './exit';

/**
 * Lab locks of this machine (WSL protection, see `.lw-plans/implementation.md`): one heavy command at a time
 * (`/tmp/lw-3a-lock.sh` = `flock -w 3600 /tmp/lw-3a.lock`) and, on top, one VM lab at a time (`/tmp/lw-vmlab.lock`,
 * created atomically like the shell's `noclobber`; only its owner ever removes it).
 */

export const HEAVY_LOCK_SCRIPT = '/tmp/lw-3a-lock.sh';
export const HEAVY_LOCK_FILE = '/tmp/lw-3a.lock';
export const VM_LAB_LOCK_FILE = '/tmp/lw-vmlab.lock';
/** Set by `run-lab.sh` (and by this module) for child processes: the VM lab lock with this token is held already. */
export const VM_LAB_LOCK_TOKEN_ENV = 'LW_VMLAB_LOCK_TOKEN';
/** `1`: the heavy lock is held by a parent (`run-lab.sh` sets it after taking the lock). */
export const HEAVY_LOCK_HELD_ENV = 'LW_HEAVY_LOCK_HELD';

export interface LockOwner {
  token: string;
  pid: number;
  host: string;
  label: string;
  started: string;
}

/** One `key=value` per line (also what `run-lab.sh` writes). */
export function formatLockOwner(owner: LockOwner): string {
  return `token=${owner.token}\npid=${owner.pid}\nhost=${owner.host}\nlabel=${owner.label}\nstarted=${owner.started}\n`;
}

export function parseLockOwner(text: string): LockOwner | null {
  const fields = Object.fromEntries(
    text
      .split('\n')
      .map((line) => /^([a-z]+)=(.*)$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  const pid = Number(fields['pid']);

  if (!fields['token'] || !Number.isInteger(pid) || pid <= 0) return null;

  return {
    token: fields['token'],
    pid,
    host: fields['host'] ?? '',
    label: fields['label'] ?? '',
    started: fields['started'] ?? '',
  };
}

export type LockHolderState = 'own' | 'live' | 'stale' | 'unknown';

/**
 * How a lock file's holder looks from here: our token → `own`; same host and the pid gone → `stale` (reported, never
 * removed: only the owner removes a lock); unreadable / other host → `unknown`.
 */
export function lockHolderState(
  holder: LockOwner | null,
  context: { token?: string; host: string; alive: (pid: number) => boolean },
): LockHolderState {
  if (!holder) return 'unknown';

  if (context.token && holder.token === context.token) return 'own';

  if (holder.host && holder.host !== context.host) return 'unknown';

  return context.alive(holder.pid) ? 'live' : 'stale';
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Creates the lock file atomically (`O_CREAT | O_EXCL`, the shell's `set -o noclobber`); false when it exists. */
export function tryCreateLock(path: string, owner: LockOwner): boolean {
  let fd: number;

  try {
    fd = openSync(path, 'wx', 0o644);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;

    throw error;
  }

  try {
    writeSync(fd, formatLockOwner(owner));
  } finally {
    closeSync(fd);
  }

  return true;
}

export function readLockOwner(path: string): LockOwner | null {
  try {
    return parseLockOwner(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Removes the lock file only when it carries `token` (never someone else's lock). */
export function releaseLock(path: string, token: string): boolean {
  if (readLockOwner(path)?.token !== token) return false;

  try {
    unlinkSync(path);

    return true;
  } catch {
    return false;
  }
}

export interface VmLabLock {
  token: string;
  /** False when a parent (`run-lab.sh`) holds the lock with our token: release is then a no-op. */
  owned: boolean;
  release(): void;
}

export interface VmLabLockOptions {
  path?: string;
  label: string;
  /** How long to wait for another lab to finish (default 0: fail at once with the holder). */
  waitMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

/** Takes `/tmp/lw-vmlab.lock` (or joins a parent's hold of it via `LW_VMLAB_LOCK_TOKEN`). */
export async function acquireVmLabLock(options: VmLabLockOptions): Promise<VmLabLock> {
  const path = options.path ?? VM_LAB_LOCK_FILE;
  const inherited = process.env[VM_LAB_LOCK_TOKEN_ENV];
  const host = hostname();

  if (inherited && readLockOwner(path)?.token === inherited)
    return { token: inherited, owned: false, release: () => undefined };

  const token = randomBytes(12).toString('hex');
  const owner: LockOwner = { token, pid: process.pid, host, label: options.label, started: new Date().toISOString() };
  const deadline = Date.now() + (options.waitMs ?? 0);
  let reported = false;

  for (;;) {
    if (tryCreateLock(path, owner)) {
      const removeHook = onLabExit(() => releaseLock(path, token));

      process.env[VM_LAB_LOCK_TOKEN_ENV] = token;

      return {
        token,
        owned: true,
        release: () => {
          removeHook();
          releaseLock(path, token);

          if (process.env[VM_LAB_LOCK_TOKEN_ENV] === token) delete process.env[VM_LAB_LOCK_TOKEN_ENV];
        },
      };
    }

    const holder = readLockOwner(path);
    const state = lockHolderState(holder, { host, alive: pidAlive });
    const who = holder
      ? `${holder.label || 'a lab'} (pid ${holder.pid} on ${holder.host || '?'}, since ${holder.started || '?'})`
      : 'an unreadable holder';

    if (state === 'stale' || Date.now() >= deadline)
      throw new Error(
        state === 'stale'
          ? `${path} is held by ${who}, which no longer runs. Only its owner removes a lock: check that no VM lab runs ` +
            `(docker ps --filter label=${options.label}), then remove it by hand (rm ${path}).`
          : `${path} is held by ${who}: one VM lab at a time on this machine.`,
      );

    if (!reported) {
      options.log?.(`waiting for ${path} (held by ${who})`);
      reported = true;
    }

    await new Promise((r) => setTimeout(r, options.pollMs ?? 5_000));
  }
}

export interface ProcessInfo {
  pid: number;
  argv: string[];
}

/** Whether a process in the chain is `flock … <lockFile> …` or the lock script itself (we run under the lock). */
export function heavyLockHeldByAncestors(chain: readonly ProcessInfo[], lockFile = HEAVY_LOCK_FILE): boolean {
  return chain.some(
    ({ argv }) =>
      (argv.length > 0 && basename(argv[0]) === 'flock' && argv.includes(lockFile)) ||
      argv.some((a) => a === HEAVY_LOCK_SCRIPT || basename(a) === basename(HEAVY_LOCK_SCRIPT)),
  );
}

/** Parent chain of this process from `/proc` (Linux); empty elsewhere. */
export function processAncestry(start = process.ppid, max = 32): ProcessInfo[] {
  const chain: ProcessInfo[] = [];
  let pid = start;

  while (pid > 1 && chain.length < max) {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // Field 4 (ppid) comes after the `(comm)` field, which may contain spaces.
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);

      chain.push({ pid, argv });
      pid = ppid;
    } catch {
      break;
    }
  }

  return chain;
}

export interface HeavyLock {
  /** False when a parent holds it (nothing to release). */
  owned: boolean;
  release(): void;
}

/**
 * Takes the heavy lock (`flock` on `/tmp/lw-3a.lock`, the file `/tmp/lw-3a-lock.sh` locks) for this process, unless a
 * parent holds it already (`LW_HEAVY_LOCK_HELD=1`, or `flock … /tmp/lw-3a.lock` / the lock script in the parent
 * chain — taking it again would wait for ourselves). The lock is held by a `flock` child whose stdin is this
 * process: it ends with us, also when we are killed.
 */
export async function acquireHeavyLock(
  options: { lockFile?: string; waitSeconds?: number; log?: (line: string) => void } = {},
): Promise<HeavyLock> {
  const lockFile = options.lockFile ?? HEAVY_LOCK_FILE;

  if (process.env[HEAVY_LOCK_HELD_ENV] === '1' || heavyLockHeldByAncestors(processAncestry(), lockFile))
    return { owned: false, release: () => undefined };

  const child: ChildProcess = spawn(
    'flock',
    ['-w', String(options.waitSeconds ?? 3600), lockFile, 'sh', '-c', 'echo LOCKED; exec cat >/dev/null'],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  let waitingLogged = false;
  const timer = setTimeout(() => {
    waitingLogged = true;
    options.log?.(`waiting for the heavy lock ${lockFile} (another heavy command runs)`);
  }, 2_000);

  try {
    await new Promise<void>((resolve, reject) => {
      let out = '';

      child.once('error', (error) =>
        reject(new Error(`flock is needed for the heavy lock (${lockFile}): ${error.message}`)),
      );
      child.once('exit', (code) => reject(new Error(`heavy lock ${lockFile} not acquired (flock exit ${code})`)));
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');

        if (out.includes('LOCKED')) resolve();
      });
    });
  } finally {
    clearTimeout(timer);
  }

  if (waitingLogged) options.log?.(`heavy lock ${lockFile} acquired`);

  child.removeAllListeners('exit');
  child.unref();
  (child.stdout as unknown as { unref?: () => void } | null)?.unref?.();
  (child.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  process.env[HEAVY_LOCK_HELD_ENV] = '1';

  const release = () => {
    child.stdin?.end();
    child.kill('SIGTERM');

    if (process.env[HEAVY_LOCK_HELD_ENV] === '1') delete process.env[HEAVY_LOCK_HELD_ENV];
  };
  const removeHook = onLabExit(release);

  return {
    owned: true,
    release: () => {
      removeHook();
      release();
    },
  };
}

interface HeldLocks {
  heavy: HeavyLock;
  vmLab: VmLabLock;
}

const LOCKS_KEY = Symbol.for('forepath.vm-lab.locks');

/**
 * Both locks for this process, taken once (global setup and every lab start call it; Jest loads them in separate
 * module registries, so the state lives on `globalThis`). `releaseLabLocks()` (global teardown) or the process exit
 * releases them.
 */
export async function ensureLabLocks(options: {
  label: string;
  log?: (line: string) => void;
  waitMs?: number;
}): Promise<void> {
  const holder = globalThis as unknown as Record<symbol, Promise<HeldLocks> | undefined>;

  holder[LOCKS_KEY] ??= (async () => {
    const heavy = await acquireHeavyLock({ log: options.log });

    try {
      const vmLab = await acquireVmLabLock({ label: options.label, log: options.log, waitMs: options.waitMs });

      return { heavy, vmLab };
    } catch (error) {
      heavy.release();
      throw error;
    }
  })().catch((error: unknown) => {
    holder[LOCKS_KEY] = undefined;
    throw error;
  });

  await holder[LOCKS_KEY];
}

export async function releaseLabLocks(): Promise<void> {
  const holder = globalThis as unknown as Record<symbol, Promise<HeldLocks> | undefined>;
  const held = await holder[LOCKS_KEY]?.catch(() => undefined);

  holder[LOCKS_KEY] = undefined;
  held?.vmLab.release();
  held?.heavy.release();
}
