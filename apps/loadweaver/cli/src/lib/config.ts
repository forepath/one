import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CliConfig {
  /** Control-plane URL, e.g. `https://cp.example.com`. */
  url?: string;
  /** A personal access token or a session token from `loadweaver login`. */
  token?: string;
}

/** `$XDG_CONFIG_HOME/loadweaver/cli.json` (default `~/.config/...`). */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'loadweaver', 'cli.json');
}

/** The stored config, with `LOADWEAVER_URL` / `LOADWEAVER_TOKEN` taking precedence. */
export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<CliConfig> {
  const stored = JSON.parse(await readFile(configPath(env), 'utf8').catch(() => '{}')) as CliConfig;

  return {
    url: env['LOADWEAVER_URL'] || stored.url,
    token: env['LOADWEAVER_TOKEN'] || stored.token,
  };
}

/**
 * Writes a file readable by the user only. The mode of `open` applies to new files only, so an existing file is
 * restricted (fchmod) right after opening and before anything is written into it.
 */
export async function writePrivateFile(path: string, data: string): Promise<void> {
  const file = await open(path, 'w', 0o600);

  try {
    await file.chmod(0o600);
    await file.writeFile(data);
  } finally {
    await file.close();
  }
}

/** Written atomically, readable by the user only (it holds a token). */
export async function saveConfig(config: CliConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = configPath(env);

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writePrivateFile(`${path}.tmp`, JSON.stringify(config, null, 2));
  await rename(`${path}.tmp`, path);
  await chmod(path, 0o600);
}
