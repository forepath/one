import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A random secret for a local component (queue / rate-limit passwords), generated on first use and kept (0600) in
 * the agent's state directory, so restarts keep it and concurrent callers agree on one value.
 */
export async function localSecret(stateDir: string, name: string): Promise<string> {
  const file = join(stateDir, `${name}.secret`);
  const existing = (await readFile(file, 'utf8').catch(() => '')).trim();

  if (existing) return existing;

  await writeFile(file, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    },
  );

  return (await readFile(file, 'utf8')).trim();
}
