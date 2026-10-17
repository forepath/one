import { mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { HostUpdate } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  GVISOR_ARCH,
  GVISOR_PIN,
  packagePins,
  type KernelModuleComponent,
  type ReleaseManifest,
  type TarballComponent,
} from '@forepath/loadweaver/shared/util-release';
import { buildGvisorHostScript } from '@forepath/shared/backend/util-container-runtime';
import { Logger } from '@nestjs/common';

import type { CommandRunner } from '../host/command-runner';
import type { FetchImpl } from '../host/verified-download';
import { downloadVerified } from './artifact-download';
import { aptPreferences, aptSourcesList, hostUpdateScript } from './host-commands';
import type { UpdateActions } from './update-actions';

const MAX_TARBALL_BYTES = 512 * 1024 * 1024;
const HOST_UPDATE_TIMEOUT_MS = 2 * 3600_000;
export const GVISOR_PREFIX = '/usr/local/lib/agenstra-gvisor';

/** The gVisor release the node runs (`current` link), or null. */
export async function installedGvisor(): Promise<string | null> {
  const target = await readlink(join(GVISOR_PREFIX, 'current')).catch(() => null);

  return target ? basename(target) : null;
}

/**
 * OS, kernel, gVisor and DRBD updates of a node (3.26: drain → update → reboot → rejoin, orchestrated by the control
 * plane). Packages come only from the cluster-local apt snapshot; everything downloaded is checked against the signed
 * manifest. The work runs as a transient systemd unit (it needs to write /usr and must survive an agent restart); its
 * result file tells a restarted agent how it ended. Reboots happen only when the control plane sends a reboot token.
 */
export class OsUpdateManager {
  private readonly logger = new Logger(OsUpdateManager.name);
  private running: string | null = null;

  constructor(
    private readonly dir: string,
    private readonly aptDir: string,
    private readonly commands: CommandRunner,
    private readonly actions: UpdateActions,
    private readonly fetchImpl: FetchImpl,
  ) {}

  private resultFile(id: string): string {
    return join(this.dir, `host-${id}.result`);
  }

  /** The snapshot of the last finished host update (reported to the control plane). */
  async appliedSnapshot(): Promise<string | undefined> {
    return (await readFile(join(this.dir, 'host-snapshot'), 'utf8').catch(() => '')).trim() || undefined;
  }

  /** Runs a host update once per id; returns when it finished (or immediately if it ran / is running). */
  async run(
    host: HostUpdate,
    manifest: ReleaseManifest,
    controlPlaneUrl: string,
    artifactBase: string,
    os: { id: string; versionId: string; arch: string },
  ): Promise<void> {
    const previous = await this.actions.get(host.id);

    if (previous && ['done', 'failed', 'rolled-back', 'rebooting'].includes(previous.phase)) return;

    if (this.running === host.id) return;

    // A run that ended while the agent was restarting.
    const result = (await readFile(this.resultFile(host.id), 'utf8').catch(() => '')).trim();

    if (result) return await this.finish(host, result);

    this.running = host.id;

    try {
      await this.actions.record({ id: host.id, kind: 'host', phase: 'downloading' });
      await mkdir(join(this.dir, 'files'), { recursive: true, mode: 0o700 });
      await mkdir(join(this.aptDir, 'lists', 'partial'), { recursive: true, mode: 0o755 });

      const pins = packagePins(manifest, `${os.id}:${os.versionId}`);
      const installed = await this.installedPackages();
      const install = Object.fromEntries(Object.entries(pins).filter(([pkg]) => installed[pkg] !== undefined));

      await writeFile(join(this.aptDir, 'sources.list'), aptSourcesList(controlPlaneUrl, host.aptBase, host.sources), {
        mode: 0o644,
      });
      await writeFile(join(this.aptDir, 'preferences'), aptPreferences(install), { mode: 0o644 });

      const base = `${controlPlaneUrl.replace(/\/+$/, '')}${artifactBase}`;
      const gvisor = await this.prepareGvisor(manifest, os.arch, base);
      const drbd = await this.prepareDrbd(manifest, os.arch, base);
      const script = join(this.dir, `host-${host.id}.sh`);

      await rm(this.resultFile(host.id), { force: true });
      await writeFile(
        script,
        hostUpdateScript({
          apt: { dir: this.aptDir },
          upgrade: host.upgrade,
          install,
          birdGracefulRestart: !!install['bird2'] && installed['bird2'] !== install['bird2'],
          ...(gvisor ? { gvisor } : {}),
          // SPAAS only for online clusters (the control plane decides; air-gapped ones build offline or refuse).
          ...(drbd ? { drbd: { ...drbd, spaas: host.spaas === true } } : {}),
          resultFile: this.resultFile(host.id),
        }),
        { mode: 0o700 },
      );
      await this.actions.record({ id: host.id, kind: 'host', phase: 'installing' });
      await this.commands
        .run(
          'systemd-run',
          [
            `--unit=loadweaver-host-update-${host.id.slice(0, 8)}`,
            '--wait',
            '--collect',
            '--quiet',
            '/bin/bash',
            script,
          ],
          { timeoutMs: HOST_UPDATE_TIMEOUT_MS },
        )
        .catch((error: unknown) =>
          this.logger.warn(`Host update unit: ${error instanceof Error ? error.message : String(error)}`),
        );

      await this.finish(
        host,
        (await readFile(this.resultFile(host.id), 'utf8').catch(() => 'failed: no result')).trim(),
      );
    } catch (error) {
      await this.actions.record({
        id: host.id,
        kind: 'host',
        phase: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = null;
    }
  }

  private async finish(host: HostUpdate, result: string): Promise<void> {
    if (result === 'ok') {
      await writeFile(join(this.dir, 'host-snapshot'), host.snapshot, { mode: 0o600 });
      await this.actions.record({ id: host.id, kind: 'host', phase: 'done' });
      this.logger.log(`Host update ${host.id} from snapshot ${host.snapshot} done`);
    } else {
      await this.actions.record({ id: host.id, kind: 'host', phase: 'failed', error: `host update ${result}` });
    }
  }

  /** Reboots once per token (the control plane drained the node first). */
  async reboot(host: HostUpdate): Promise<boolean> {
    if (!host.reboot) return false;

    const marker = join(this.dir, `reboot-${host.reboot}`);

    if (await readFile(marker, 'utf8').catch(() => null)) return false;

    await writeFile(marker, new Date().toISOString(), { mode: 0o600 });
    await this.actions.record({ id: host.id, kind: 'host', phase: 'rebooting' });
    this.logger.warn(`Rebooting for host update ${host.id}`);
    // Let the heartbeat carry the progress out first. The drained node's DRBD replicas (Secondary) go down cleanly
    // before the reboot: torn down by the shutdown instead, a replica came back with out-of-sync bits toward the
    // primary under equal UUIDs, offered itself as sync source and was declined by the Primary — StandAlone, no
    // resync (VM lab, kernel update). A replica still Primary refuses `down` and stays as it is (best effort).
    setTimeout(
      () =>
        void this.commands
          .run('drbdadm', ['down', 'all'], { timeoutMs: 60_000 })
          .catch((error: unknown) =>
            this.logger.warn(`DRBD down before reboot: ${error instanceof Error ? error.message : String(error)}`),
          )
          .then(() => this.commands.run('systemctl', ['reboot']))
          .catch(() => undefined),
      3_000,
    ).unref();

    return true;
  }

  async installedPackages(): Promise<Record<string, string>> {
    const out = await this.commands
      .run('dpkg-query', ['-W', '-f', '${Package} ${Version} ${db:Status-Status}\\n'])
      .then((r) => r.stdout)
      .catch(() => '');

    return Object.fromEntries(
      out
        .split('\n')
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length >= 3 && p[2] === 'installed')
        .map((p) => [p[0].replace(/:.*$/, ''), p[1]]),
    );
  }

  private async prepareGvisor(
    manifest: ReleaseManifest,
    arch: string,
    base: string,
  ): Promise<{ release: string; tarball: string; script: string } | undefined> {
    const gvisor = manifest.components['gvisor'] as TarballComponent | undefined;

    if (!gvisor || gvisor.kind !== 'tarball' || (await installedGvisor()) === gvisor.version) return undefined;

    const sha512 = gvisor.sha512[arch as 'amd64'];

    if (!sha512) throw new Error(`release ${manifest.version} pins no gVisor for ${arch}`);

    const bundled = gvisor.files?.[arch as 'amd64'];
    const file = bundled ? manifest.artifacts.find((a) => a.path === bundled) : undefined;
    const tarball = join(this.dir, 'files', `gvisor-${gvisor.version}-${arch}.tar.bz2`);
    const url = file
      ? `${base}/${file.sha256}`
      : GVISOR_PIN.urlTemplate.replace('{release}', gvisor.version).replace('{arch}', GVISOR_ARCH[arch as 'amd64']);

    await downloadVerified(
      url,
      tarball,
      { sha512, ...(file ? { sha256: file.sha256, size: file.size } : {}) },
      this.fetchImpl,
      MAX_TARBALL_BYTES,
    );

    const script = join(this.dir, 'files', 'gvisor-host.sh');

    await writeFile(
      script,
      buildGvisorHostScript({
        release: gvisor.version,
        sha512: { x86_64: gvisor.sha512.amd64 ?? '', aarch64: gvisor.sha512.arm64 ?? '' },
      }),
      { mode: 0o700 },
    );

    return { release: gvisor.version, tarball, script };
  }

  private async prepareDrbd(
    manifest: ReleaseManifest,
    arch: string,
    base: string,
  ): Promise<
    | {
        version: string;
        prebuilt: Record<string, string>;
        source?: string;
        compat: Record<string, { file: string; md5: string }[]>;
        signed: boolean;
      }
    | undefined
  > {
    const drbd = manifest.components['drbd'] as KernelModuleComponent | undefined;

    if (!drbd || drbd.kind !== 'kernel-module') return undefined;

    const prebuilt: Record<string, string> = {};

    for (const p of drbd.prebuilt.filter((x) => x.arch === arch)) {
      const file = manifest.artifacts.find((a) => a.path === p.file);

      if (!file) continue;

      const target = join(this.dir, 'files', `drbd-${drbd.version}-${p.kernel}.tar.gz`);

      await downloadVerified(
        `${base}/${file.sha256}`,
        target,
        { sha256: file.sha256, size: file.size },
        this.fetchImpl,
        MAX_TARBALL_BYTES,
      );
      prebuilt[p.kernel] = target;
    }

    const sourceFile = drbd.source.file ? manifest.artifacts.find((a) => a.path === drbd.source.file) : undefined;
    const source = join(this.dir, 'files', `drbd-${drbd.version}.tar.gz`);

    await downloadVerified(
      sourceFile ? `${base}/${sourceFile.sha256}` : drbd.source.url,
      source,
      { sha256: drbd.source.sha256 },
      this.fetchImpl,
      MAX_TARBALL_BYTES,
    );

    // DRBD's compat patches per kernel, pre-generated at bundle build time: the build needs no SPAAS (internet).
    const compat: Record<string, { file: string; md5: string }[]> = {};

    for (const c of (drbd.compat ?? []).filter((x) => x.arch === arch)) {
      const file = manifest.artifacts.find((a) => a.path === c.file);

      if (!file) continue;

      const target = join(this.dir, 'files', `drbd-${drbd.version}-compat-${c.kernel}-${c.md5}.tar.gz`);

      await downloadVerified(
        `${base}/${file.sha256}`,
        target,
        { sha256: file.sha256, size: file.size },
        this.fetchImpl,
        MAX_TARBALL_BYTES,
      );
      (compat[c.kernel] ??= []).push({ file: target, md5: c.md5 });
    }

    // A module built from source on the node is never signed for Secure Boot (prebuilt ones may be).
    return { version: drbd.version, prebuilt, source, compat, signed: false };
  }
}
