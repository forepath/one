import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { labCacheDir } from './cache';
import { run, hostDockerEnv } from './process';

/**
 * Keep-alive of lab VMs between runs (development only, never in the gate): with `LW_LAB_KEEP=1` a lab started with
 * a keep key stays up when the run ends (`stop()` only closes tunnels; `run-lab.sh` skips its cleanup) and its state is
 * written to `<cache>/keep/<key>.json`. The next run with the same key and the same lab fingerprint (VM specs, golden)
 * re-attaches to the running containers instead of booting — a focused re-run (`--case '(e)'`) then costs seconds.
 * Without `LW_LAB_KEEP=1` a kept lab of the same key is removed first and the run is a normal cold one.
 */
export const LAB_KEEP_ENV = 'LW_LAB_KEEP';

export function labKeepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LAB_KEEP_ENV] === '1';
}

export interface KeptLabState<T> {
  key: string;
  fingerprint: string;
  createdAt: string;
  data: T;
}

export function keptLabFile(key: string, dir = join(labCacheDir(), 'keep')): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(key)) throw new Error(`invalid lab keep key ${key}`);

  return join(dir, `${key}.json`);
}

/** The kept state of `key` (any fingerprint), or null. */
export function readKeptLab<T>(key: string, dir?: string): KeptLabState<T> | null {
  const file = keptLabFile(key, dir);

  if (!existsSync(file)) return null;

  try {
    const state = JSON.parse(readFileSync(file, 'utf8')) as KeptLabState<T>;

    return state && state.key === key && typeof state.fingerprint === 'string' ? state : null;
  } catch {
    return null;
  }
}

export function writeKeptLab<T>(key: string, fingerprint: string, data: T, dir?: string): KeptLabState<T> {
  const file = keptLabFile(key, dir);
  const state: KeptLabState<T> = { key, fingerprint, createdAt: new Date().toISOString(), data };

  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);

  return state;
}

export function forgetKeptLab(key: string, dir?: string): void {
  rmSync(keptLabFile(key, dir), { force: true });
}

/** Whether every container exists and runs (a kept lab is only re-attached when all of it is still up). */
export async function containersRunning(names: readonly string[]): Promise<boolean> {
  if (names.length === 0) return false;

  const result = await run('docker', ['inspect', '-f', '{{.State.Running}}', ...names], { env: hostDockerEnv() });

  return (
    result.code === 0 &&
    result.stdout
      .trim()
      .split('\n')
      .every((line) => line.trim() === 'true')
  );
}

/**
 * What a run does with a kept lab of its key: `attach` (keep on, same fingerprint, everything running), `replace`
 * (a kept lab exists but can't be used: remove it, then boot), `boot` (nothing kept).
 */
export function keepDecision(input: {
  keep: boolean;
  state: KeptLabState<unknown> | null;
  fingerprint: string;
  running: boolean;
}): 'attach' | 'replace' | 'boot' {
  if (!input.state) return 'boot';

  if (input.keep && input.state.fingerprint === input.fingerprint && input.running) return 'attach';

  return 'replace';
}
