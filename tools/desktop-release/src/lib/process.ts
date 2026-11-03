import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export interface RunOptions {
  cwd?: string;
  /** Written to stdin. */
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Never print the arguments (they contain a password); failures name the command only. */
  secretArgs?: boolean;
}

/** Runs a command without a shell and returns its stdout; throws on a non-zero exit. */
export type Runner = (command: string, args: readonly string[], options?: RunOptions) => string;

export const runCommand: Runner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  if (result.error) throw new Error(`${command}: ${result.error.message}`);

  if (result.status !== 0) {
    const shown = options.secretArgs ? '' : ` ${args.join(' ')}`;

    throw new Error(`${command}${shown} exited with ${result.status ?? result.signal}`);
  }

  return result.stdout ?? '';
};

export interface Log {
  info(message: string): void;
  /** A skipped step: GitHub Actions annotation in CI, plain text elsewhere. */
  warn(title: string, message: string): void;
}

export const consoleLog: Log = {
  info: (message) => console.log(message),
  warn: (title, message) =>
    console.log(
      process.env['GITHUB_ACTIONS'] === 'true' ? `::warning title=${title}::${message}` : `warning: ${message}`,
    ),
};

/** The secrets of a step that are unset (empty), by name. */
export function missingSecrets(names: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return names.filter((name) => !env[name]?.trim());
}

/** Appends `key=value` to `$GITHUB_OUTPUT` when running in Actions. */
export function setStepOutput(key: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = env['GITHUB_OUTPUT'];

  if (file) appendFileSync(file, `${key}=${value}\n`);
}
