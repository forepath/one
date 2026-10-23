import { MICROVM_EXEC_CLIENT_PATH, MICROVM_VMM_USER } from './constants';
import { isValidUserSpec } from './messages';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** The subset of Docker's exec-create options the agent manager uses. */
export interface DockerExecCreateOptions {
  Cmd?: string[];
  Env?: string[];
  User?: string;
  WorkingDir?: string;
  Tty?: boolean;
  AttachStdin?: boolean;
  AttachStdout?: boolean;
  AttachStderr?: boolean;
}

export interface ExecClientArguments {
  user: string;
  workdir: string;
  /** Names of exec-specific variables whose values the client reads from its own environment. */
  passEnv: string[];
  argv: string[];
}

export class ExecClientUsageError extends Error {}

/**
 * Rewrites a `docker exec` for a microVM worker: the exec runs the bridge client in the launcher as the
 * unprivileged VMM user, and the client runs the original command inside the guest.
 *
 * Exec-specific environment values stay in the exec's `Env` (only their names travel as arguments), so values
 * such as provider credentials never show up in the launcher's process list.
 */
export function toMicrovmExecOptions<T extends DockerExecCreateOptions>(options: T): T {
  const cmd = options.Cmd ?? [];

  if (!cmd.length) {
    throw new ExecClientUsageError('exec command is empty');
  }

  const user = options.User ?? '';

  if (!isValidUserSpec(user)) {
    throw new ExecClientUsageError(`unsupported exec user ${JSON.stringify(user)}`);
  }

  const env = options.Env ?? [];
  const passEnv = [...new Set(env.map((entry) => entry.split('=', 1)[0]))];

  if (passEnv.some((name) => !ENV_NAME.test(name))) {
    throw new ExecClientUsageError('exec environment entries must be KEY=VALUE');
  }

  const args = [MICROVM_EXEC_CLIENT_PATH];

  if (user) {
    args.push('--user', user);
  }

  if (options.WorkingDir) {
    args.push('--workdir', options.WorkingDir);
  }

  for (const name of passEnv) {
    args.push('--pass-env', name);
  }

  const rewritten: T = { ...options, Cmd: [...args, '--', ...cmd], User: MICROVM_VMM_USER };

  delete rewritten.WorkingDir;

  return rewritten;
}

export function parseExecClientArguments(argv: readonly string[]): ExecClientArguments {
  const result: ExecClientArguments = { user: '', workdir: '', passEnv: [], argv: [] };
  let index = 0;

  const value = (flag: string): string => {
    const next = argv[index + 1];

    if (next === undefined) {
      throw new ExecClientUsageError(`${flag} needs a value`);
    }

    index += 2;

    return next;
  };

  while (index < argv.length) {
    const arg = argv[index];

    if (arg === '--') {
      result.argv = argv.slice(index + 1);
      break;
    }

    if (arg === '--user') {
      result.user = value(arg);
    } else if (arg === '--workdir') {
      result.workdir = value(arg);
    } else if (arg === '--pass-env') {
      result.passEnv.push(value(arg));
    } else {
      throw new ExecClientUsageError(`unknown option ${arg}`);
    }
  }

  if (!result.argv.length || !result.argv[0]) {
    throw new ExecClientUsageError('missing command after --');
  }

  if (!isValidUserSpec(result.user)) {
    throw new ExecClientUsageError('invalid --user');
  }

  if (result.workdir && !result.workdir.startsWith('/')) {
    throw new ExecClientUsageError('--workdir must be absolute');
  }

  if (result.passEnv.some((name) => !ENV_NAME.test(name))) {
    throw new ExecClientUsageError('invalid --pass-env name');
  }

  return result;
}
