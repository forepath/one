/**
 * Synchronous exit hooks of a lab process: lab containers and locks are released when the test process ends —
 * normally, by Ctrl+C (SIGINT), SIGTERM or SIGHUP. Hooks must be synchronous (`spawnSync`, `fs.*Sync`): nothing
 * asynchronous runs during `process.on('exit')`.
 */

type Hook = () => void;

interface ExitState {
  hooks: Map<number, Hook>;
  next: number;
  installed: boolean;
}

const KEY = Symbol.for('forepath.vm-lab.exit');

function state(): ExitState {
  const holder = globalThis as unknown as Record<symbol, ExitState | undefined>;

  holder[KEY] ??= { hooks: new Map(), next: 1, installed: false };

  return holder[KEY] as ExitState;
}

const SIGNALS: Readonly<Record<string, number>> = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };

/** Runs every registered hook once (newest first), swallowing errors. */
export function runExitHooks(): void {
  const s = state();
  const hooks = [...s.hooks.entries()].reverse();

  s.hooks.clear();

  for (const [, hook] of hooks) {
    try {
      hook();
    } catch {
      // best effort: the next hook still runs
    }
  }
}

/** Registers a synchronous hook for the end of the process; returns a function removing it again. */
export function onLabExit(hook: Hook): () => void {
  const s = state();
  const id = s.next++;

  s.hooks.set(id, hook);

  if (!s.installed) {
    s.installed = true;
    process.on('exit', runExitHooks);

    for (const [signal, number] of Object.entries(SIGNALS))
      process.once(signal as NodeJS.Signals, () => {
        runExitHooks();
        process.exit(128 + number);
      });
  }

  return () => {
    s.hooks.delete(id);
  };
}
