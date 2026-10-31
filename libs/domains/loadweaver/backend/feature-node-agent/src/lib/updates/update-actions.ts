import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { UpdateAction } from '@forepath/loadweaver/shared/util-agent-protocol';

const MAX_ACTIONS = 8;

/**
 * The node's recent update actions (self-update, host update, switchover) as reported to the control plane (3.26).
 * Persisted under the state directory, so progress survives agent restarts and reboots (a host update finishes in a
 * transient unit, a self-update restarts the agent itself).
 */
export class UpdateActions {
  private cache: UpdateAction[] | null = null;

  constructor(private readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'actions.json');
  }

  async list(): Promise<UpdateAction[]> {
    if (this.cache) return this.cache;

    try {
      this.cache = JSON.parse(await readFile(this.file, 'utf8')) as UpdateAction[];
    } catch {
      this.cache = [];
    }

    return this.cache;
  }

  async get(id: string): Promise<UpdateAction | undefined> {
    return (await this.list()).find((a) => a.id === id);
  }

  async record(action: Omit<UpdateAction, 'at'>): Promise<void> {
    const entry: UpdateAction = {
      ...action,
      ...(action.error ? { error: action.error.slice(0, 2000) } : {}),
      at: new Date().toISOString(),
    };
    const next = [entry, ...(await this.list()).filter((a) => a.id !== action.id)].slice(0, MAX_ACTIONS);

    this.cache = next;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(`${this.file}.new`, JSON.stringify(next), { mode: 0o600 });
    await rename(`${this.file}.new`, this.file);
  }
}
