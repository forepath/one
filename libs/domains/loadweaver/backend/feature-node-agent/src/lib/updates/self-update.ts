import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import type { BinaryComponent, ReleaseManifest } from '@forepath/loadweaver/shared/util-release';

import type { CommandRunner } from '../host/command-runner';
import type { FetchImpl } from '../host/verified-download';
import { downloadVerified } from './artifact-download';
import type { UpdateActions } from './update-actions';

const MAX_AGENT_BYTES = 512 * 1024 * 1024;
/** Without a confirmation from the new agent within this time, the previous binary is put back. */
export const SELF_UPDATE_CONFIRM_SECONDS = 300;

/** The confirmation window (`LOADWEAVER_SELF_UPDATE_CONFIRM_SECONDS`, 30–3600; labs shorten it). */
export function selfUpdateConfirmSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['LOADWEAVER_SELF_UPDATE_CONFIRM_SECONDS']);

  return Number.isInteger(raw) && raw >= 30 && raw <= 3600 ? raw : SELF_UPDATE_CONFIRM_SECONDS;
}

export interface SelfUpdateConfig {
  /** Where systemd starts the agent from. */
  binary: string;
  unit: string;
  /** `<state>/updates` */
  dir: string;
}

export function selfUpdateConfig(stateDir: string, env: NodeJS.ProcessEnv = process.env): SelfUpdateConfig {
  return {
    binary: env['LOADWEAVER_AGENT_BINARY'] || '/usr/local/bin/loadweaver-agent',
    unit: env['LOADWEAVER_AGENT_UNIT'] || 'loadweaver-agent',
    dir: join(stateDir, 'updates'),
  };
}

interface Pending {
  version: string;
  from: string;
  release: string;
  rollbackUnit: string;
  at: string;
}

const UNIT = /^[A-Za-z0-9@._-]+$/;
const PATH = /^\/[A-Za-z0-9._/-]+$/;
const sh = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/**
 * The swap script, run as a transient unit (the agent's own unit can't write /usr): keep the running binary as
 * `.prev`, move the verified new one into place, restart the agent. A second transient timer restores `.prev`
 * unless the new agent confirms within `SELF_UPDATE_CONFIRM_SECONDS` (it removes the marker once it reached the
 * control plane and applied its desired state).
 */
export function swapScript(config: SelfUpdateConfig, downloaded: string): string {
  for (const p of [config.binary, config.dir, downloaded]) if (!PATH.test(p)) throw new Error(`unsafe path ${p}`);

  if (!UNIT.test(config.unit)) throw new Error('unsafe unit name');

  return [
    'set -eu',
    `install -m 0755 ${sh(downloaded)} ${sh(config.binary + '.new')}`,
    `cp -p ${sh(config.binary)} ${sh(join(config.dir, 'loadweaver-agent.prev'))}`,
    `mv -f ${sh(config.binary + '.new')} ${sh(config.binary)}`,
    // Docker keeps running (live-restore) and so do the containers; only the agent process restarts.
    `systemctl restart ${sh(config.unit)}`,
  ].join('\n');
}

export function rollbackScript(config: SelfUpdateConfig): string {
  const marker = join(config.dir, 'self-update.json');
  const prev = join(config.dir, 'loadweaver-agent.prev');

  return [
    `if [ -f ${sh(marker)} ] && [ -x ${sh(prev)} ]; then`,
    `  install -m 0755 ${sh(prev)} ${sh(config.binary + '.new')}`,
    `  mv -f ${sh(config.binary + '.new')} ${sh(config.binary)}`,
    // A binary that never started may have hit the unit's start limit.
    `  systemctl reset-failed ${sh(config.unit)} 2>/dev/null || true`,
    `  systemctl restart ${sh(config.unit)}`,
    'fi',
  ].join('\n');
}

/**
 * Agent self-update (3.26: binary swap + systemd restart, containers keep running through Docker's live-restore). The
 * binary comes from the control plane by checksum and is verified against the release manifest the agent verified
 * itself; the swap and the automatic rollback run as transient systemd units.
 */
export class SelfUpdater {
  private readonly logger = new Logger(SelfUpdater.name);
  private running = false;

  constructor(
    private readonly config: SelfUpdateConfig,
    private readonly commands: CommandRunner,
    private readonly actions: UpdateActions,
    private readonly currentVersion: string,
    private readonly fetchImpl: FetchImpl,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private get marker(): string {
    return join(this.config.dir, 'self-update.json');
  }

  private async pending(): Promise<Pending | null> {
    try {
      return JSON.parse(await readFile(this.marker, 'utf8')) as Pending;
    } catch {
      return null;
    }
  }

  /**
   * After the agent applied a desired state: a pending self-update to this version is confirmed (the rollback
   * timer stops); a marker for another version means the new agent didn't come up and the previous one is back.
   */
  async confirm(): Promise<void> {
    const pending = await this.pending();

    if (!pending) return;

    if (pending.version === this.currentVersion) {
      await this.commands
        .run('systemctl', ['stop', `${pending.rollbackUnit}.timer`], { okExitCodes: [1, 5] })
        .catch(() => undefined);
      await rm(this.marker, { force: true });
      await this.actions.record({ id: `self-update:${pending.release}`, kind: 'self-update', phase: 'done' });
      this.logger.log(`Self-update to ${pending.version} confirmed`);

      return;
    }

    await rm(this.marker, { force: true });
    // Keyed by the release that asked for it: cleared once the node is moved to another release (a rollback, a new
    // update), so a later step targeting this version tries again instead of being blocked forever.
    await writeFile(
      this.failedMarker(pending.version),
      JSON.stringify({ release: pending.release, at: new Date().toISOString() }),
      { mode: 0o600 },
    );
    await this.actions.record({
      id: `self-update:${pending.release}`,
      kind: 'self-update',
      phase: 'rolled-back',
      error: `agent ${pending.version} did not confirm within ${selfUpdateConfirmSeconds(this.env)} s; ${this.currentVersion} was restored`,
    });
  }

  private failedMarker(version: string): string {
    return join(this.config.dir, `failed-${version.replace(/[^A-Za-z0-9.-]/g, '_')}`);
  }

  /** The release whose self-update to `version` did not confirm on this node, if any. */
  private async failedFor(version: string): Promise<string | null> {
    const raw = await readFile(this.failedMarker(version), 'utf8').catch(() => null);

    if (raw === null) return null;

    try {
      return String((JSON.parse(raw) as { release?: unknown }).release ?? '') || null;
    } catch {
      return null;
    }
  }

  /**
   * Forgets self-updates that did not confirm under another release than the one the node is now asked to run (or
   * none): the node was moved away from that release, so a new step targeting it retries the agent once more.
   */
  async clearStaleFailures(release: string | undefined): Promise<void> {
    const files = await readdir(this.config.dir).catch(() => [] as string[]);

    for (const file of files.filter((f) => f.startsWith('failed-'))) {
      const marked = await this.failedFor(file.slice('failed-'.length));

      if (marked === null || marked !== release) await rm(join(this.config.dir, file), { force: true });
    }
  }

  /** Swaps to the release's agent if it differs from this one. Returns true when a restart was started. */
  async ensure(
    manifest: ReleaseManifest,
    arch: string,
    controlPlaneUrl: string,
    artifactBase: string,
  ): Promise<boolean> {
    const agent = manifest.components['node-agent'] as BinaryComponent | undefined;
    const id = `self-update:${manifest.version}`;

    if (!agent || agent.version === this.currentVersion || this.running) return false;

    if ((await this.failedFor(agent.version)) === manifest.version) {
      // Reported as the action's error: the block is visible, not a silent no-op.
      const error = `agent ${agent.version} did not confirm on this node and is not retried while it stays on release ${manifest.version}; ${this.currentVersion} keeps running (roll the step back or move the node to another release to retry)`;
      const current = await this.actions.get(id);

      if (current?.phase !== 'rolled-back' || current.error !== error)
        await this.actions.record({ id, kind: 'self-update', phase: 'rolled-back', error });

      return false;
    }

    const path = agent.files[arch as 'amd64' | 'arm64'];
    const file = path ? manifest.artifacts.find((a) => a.path === path) : undefined;

    if (!file) {
      await this.actions.record({
        id,
        kind: 'self-update',
        phase: 'failed',
        error: `release ${manifest.version} has no agent for ${arch}`,
      });

      return false;
    }

    // Only a systemd-managed agent can swap itself (development runs keep their binary).
    if (!this.env['INVOCATION_ID']) {
      await this.actions.record({
        id,
        kind: 'self-update',
        phase: 'failed',
        error: 'the agent does not run under systemd',
      });

      return false;
    }

    this.running = true;

    try {
      await mkdir(this.config.dir, { recursive: true, mode: 0o700 });
      await this.actions.record({ id, kind: 'self-update', phase: 'downloading' });

      const downloaded = join(this.config.dir, `loadweaver-agent-${agent.version.replace(/[^A-Za-z0-9.-]/g, '_')}`);

      await downloadVerified(
        `${controlPlaneUrl.replace(/\/+$/, '')}${artifactBase}/${file.sha256}`,
        downloaded,
        { sha256: file.sha256, size: file.size },
        this.fetchImpl,
        MAX_AGENT_BYTES,
      );
      await chmod(downloaded, 0o755);

      const rollbackUnit = `loadweaver-agent-rollback-${randomBytes(4).toString('hex')}`;
      const pending: Pending = {
        version: agent.version,
        from: this.currentVersion,
        release: manifest.version,
        rollbackUnit,
        at: new Date().toISOString(),
      };

      await writeFile(this.marker, JSON.stringify(pending), { mode: 0o600 });
      await this.actions.record({ id, kind: 'self-update', phase: 'restarting' });
      // The rollback timer first: if the swap's restart never comes back, the previous binary returns.
      await this.commands.run('systemd-run', [
        `--unit=${rollbackUnit}`,
        `--on-active=${selfUpdateConfirmSeconds(this.env)}`,
        '--timer-property=AccuracySec=1s',
        '--collect',
        '/bin/sh',
        '-c',
        rollbackScript(this.config),
      ]);
      await this.commands.run('systemd-run', [
        `--unit=loadweaver-agent-update-${randomBytes(4).toString('hex')}`,
        '--collect',
        '/bin/sh',
        '-c',
        swapScript(this.config, downloaded),
      ]);
      this.logger.log(`Self-update ${this.currentVersion} → ${agent.version} started`);

      return true;
    } catch (error) {
      await rm(this.marker, { force: true });
      await this.actions.record({
        id,
        kind: 'self-update',
        phase: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    } finally {
      this.running = false;
    }
  }
}
