import { execFile } from 'node:child_process';

import { Injectable } from '@nestjs/common';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Written to the process' stdin (e.g. an nftables script for `nft -f -`). */
  input?: string | Buffer;
  timeoutMs?: number;
  /** Exit codes that count as success besides 0. */
  okExitCodes?: number[];
}

/**
 * Arguments as they may be logged: values of environment options (`--env K=V`, `-e K=V`, `--env=K=V`) are replaced
 * by `K=***`, they may carry secrets (M6 review L2).
 */
export function scrubCommandArgs(args: readonly string[]): string[] {
  const assignment = /^([A-Za-z_][A-Za-z0-9_.-]*)=/;
  const scrub = (value: string) => value.replace(/^([^=]*)=[\s\S]*$/, '$1=***');

  return args.map((arg, i) => {
    if (/^--env=/.test(arg)) return `--env=${scrub(arg.slice('--env='.length))}`;

    return i > 0 && (args[i - 1] === '--env' || args[i - 1] === '-e') && assignment.test(arg) ? scrub(arg) : arg;
  });
}

export class CommandError extends Error {
  readonly args: readonly string[];

  constructor(
    readonly command: string,
    args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    const scrubbed = scrubCommandArgs(args);

    super(`${command} ${scrubbed.join(' ')} failed (exit ${exitCode ?? 'signal'}): ${stderr.trim().slice(0, 500)}`);
    this.args = scrubbed;
  }
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Runs host tools through their machine-readable interfaces (`ip -j`, `nft -j`, `wg`, `birdc`, 5).
 * Never uses a shell: arguments are passed as an array, so values can't inject commands.
 */
@Injectable()
export class CommandRunner {
  async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    return await new Promise((resolve, reject) => {
      const child = execFile(
        command,
        [...args],
        {
          timeout: options.timeoutMs ?? 30_000,
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: 'utf8',
          env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' },
        },
        (error, stdout, stderr) => {
          if (!error) return resolve({ stdout, stderr });

          const code =
            typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
              ? (error as unknown as { code: number }).code
              : null;

          if (code !== null && options.okExitCodes?.includes(code)) return resolve({ stdout, stderr });

          reject(new CommandError(command, args, code, stderr || error.message));
        },
      );

      if (options.input !== undefined) {
        child.stdin?.end(options.input);
      }
    });
  }

  async json<T>(command: string, args: readonly string[], options: RunOptions = {}): Promise<T> {
    const { stdout } = await this.run(command, args, options);

    try {
      return JSON.parse(stdout || 'null') as T;
    } catch {
      throw new CommandError(command, args, 0, 'output is not valid JSON');
    }
  }

  /** True if the binary exists and runs (`<cmd> --version` style probes). */
  async available(command: string, args: readonly string[] = ['--version']): Promise<boolean> {
    try {
      await this.run(command, args, { timeoutMs: 5_000 });

      return true;
    } catch {
      return false;
    }
  }
}
