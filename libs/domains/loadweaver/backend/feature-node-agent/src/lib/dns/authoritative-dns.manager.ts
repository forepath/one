import { createHash } from 'node:crypto';
import { chown, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AuthoritativeDns } from '@forepath/loadweaver/shared/util-agent-protocol';
import { bindKeyFileStem, dnssecKeyMatches, renderBindKeyFiles } from '@forepath/loadweaver/shared/util-pki';
import { Injectable } from '@nestjs/common';

import { ManagedContainers } from '../host/managed-containers';
import { defaultFetch, ensureVerifiedFile, type FetchImpl } from '../host/verified-download';
import { AgentStateStore } from '../state/agent-state.store';
import {
  BIND9_CONTAINER,
  BIND9_DATA_DIR,
  BIND9_DIR,
  BIND9_UID,
  bind9Image,
  bind9Spec,
  GEOIP_FILE,
  renderNamedConf,
  renderTsigConf,
  TSIG_CONF,
  viewZoneFile,
  zoneFileName,
} from './bind9-config';

/** Directories strictly between `root` and `path`, outermost first. */
function ancestors(root: string, path: string): string[] {
  const result: string[] = [];

  for (let dir = dirname(path); dir.length > root.length; dir = dirname(dir)) result.unshift(dir);

  return result;
}

/**
 * Shell script syncing bind's data directory (`/data`) with the staging tree (`/next`), run as bind's user in a
 * container that sees only those two (see `AuthoritativeDnsManager.syncData`). Prints `changed=1` when it changed
 * anything.
 */
export function bindDataSyncScript(): string {
  return [
    'set -eu',
    'changed=0',
    'mkdir -p /data/signed /data/secondary /data/keys',
    // We never create links: whatever is one was planted, and nothing may be written through it.
    'if [ -n "$(find /data/signed /data/keys -type l)" ]; then find /data/signed /data/keys -type l -exec rm -f {} +; changed=1; fi',
    'cd /next/signed',
    'for f in $(find . -type f -name "*.zone"); do',
    '  mkdir -p "/data/signed/$(dirname "$f")"',
    '  if ! cmp -s "$f" "/data/signed/$f"; then cp "$f" "/data/signed/$f.new" && mv -f "/data/signed/$f.new" "/data/signed/$f"; changed=1; fi',
    'done',
    'cd /data/signed',
    // Sources of zones no longer signed here go, with what bind wrote next to them.
    'for f in $(find . -name "*.zone"); do [ -f "/next/signed/$f" ] || { rm -rf "$f" "$f".*; changed=1; }; done',
    'cd /next/keys',
    'for d in $(find . -mindepth 1 -type d); do mkdir -p "/data/keys/$d"; done',
    'for k in $(find . -type f -name "*.key"); do',
    '  s="${k%.key}"',
    '  if [ ! -e "/data/keys/$k" ]; then',
    '    for e in private state key; do cp "$s.$e" "/data/keys/$s.$e.new" && chmod 600 "/data/keys/$s.$e.new" && mv -f "/data/keys/$s.$e.new" "/data/keys/$s.$e"; done',
    '    changed=1',
    '  fi',
    'done',
    'cd /data/keys',
    'for f in $(find . -type f); do [ -f "/next/keys/${f%.*}.key" ] || { rm -f "$f"; changed=1; }; done',
    'for d in $(find . -mindepth 1 -depth -type d); do [ -d "/next/keys/$d" ] || { rm -rf "$d"; changed=1; }; done',
    'echo "changed=$changed"',
  ].join('\n');
}

/** Where the control plane serves the GeoIP country database (from its release bundle). */
export const GEOIP_ROUTE = '/api/install/geoip/country.mmdb';
const MAX_GEOIP_BYTES = 256 * 1024 * 1024;

/**
 * The node's hosted bind9 (3.15). New zones are checked with `named-checkconf -z` in a throwaway container before
 * they replace the served ones; content changes are reloaded with SIGHUP, configuration changes re-create bind9.
 * DNSSEC key files are written once: bind keeps each key's rollover state in them from then on. Everything inside
 * bind's writable data directory is done as bind's user (see `syncData`).
 */
@Injectable()
export class AuthoritativeDnsManager {
  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
  ) {}

  private get dir(): string {
    return join(this.state.dir, 'bind9');
  }

  /** bind's writable data (signed zones, key state, transferred zones), mounted at {@link BIND9_DATA_DIR}. */
  private get dataDir(): string {
    return join(this.state.dir, 'bind9-data');
  }

  /** Secrets arrive at push time; without them bind would sign with keys of its own or transfer unauthenticated. */
  private static checkSecrets(config: AuthoritativeDns): void {
    for (const zone of config.zones) {
      for (const key of zone.dnssec?.keys ?? []) {
        if (!key.privateKey || !dnssecKeyMatches({ publicKey: key.publicKey, privateKey: key.privateKey }))
          throw new Error(`DNSSEC key for ${zone.name} is missing or does not match; zones left as they are`);
      }

      for (const name of new Set([
        ...(zone.transferKey ? [zone.transferKey] : []),
        ...(zone.transfers ?? []).map((t) => t.key),
      ])) {
        if (!config.tsigKeys?.some((k) => k.name === name && k.secret))
          throw new Error(`TSIG key ${name} for ${zone.name} is missing; zones left as they are`);
      }
    }
  }

  /** Root-owned, readable by bind's group only: nothing bind (or whoever compromised it) can change. */
  private get stagingDir(): string {
    return join(this.state.dir, 'bind9-staging');
  }

  private async stagingEntry(path: string, content?: string): Promise<void> {
    if (content === undefined) await mkdir(path, { recursive: true, mode: 0o750 });
    else await writeFile(path, content, { mode: 0o640 });

    await chown(path, 0, BIND9_UID);
  }

  /**
   * What bind's data directory must hold: signed zones' sources and the key files of every signed zone, plus a copy
   * per steering view with its own variant (bind refuses one key directory for two signing zones). Returns a hash of
   * it, so an unchanged state needs no sync.
   */
  private async stage(config: AuthoritativeDns, signedSources: readonly [string, string][]): Promise<string> {
    const root = this.stagingDir;
    const hash = createHash('sha256');

    await rm(root, { recursive: true, force: true });

    for (const dir of [root, join(root, 'signed'), join(root, 'keys'), join(root, 'secondary')])
      await this.stagingEntry(dir);

    for (const [file, content] of signedSources) {
      for (const dir of ancestors(join(root, 'signed'), join(root, 'signed', file))) await this.stagingEntry(dir);

      await this.stagingEntry(join(root, 'signed', file), content);
      hash.update(`signed/${file}\0${content}\0`);
    }

    for (const zone of config.zones) {
      if (!zone.dnssec) continue;

      const dirs = [
        zone.name,
        ...(config.views ?? [])
          .filter((v) => v.zones.some((z) => z.name === zone.name))
          .map((v) => `${v.name}/${zone.name}`),
      ];

      for (const relative of dirs) {
        const dir = join(root, 'keys', relative);

        for (const d of [...ancestors(join(root, 'keys'), dir), dir]) await this.stagingEntry(d);

        for (const key of zone.dnssec.keys) {
          const stem = bindKeyFileStem(zone.name, key.publicKey);
          const files = renderBindKeyFiles(
            zone.name,
            { publicKey: key.publicKey, privateKey: key.privateKey as string },
            { created: new Date(key.created), ...(key.retired ? { retired: new Date(key.retired) } : {}) },
          );

          for (const [ext, content] of [
            ['private', files.private],
            ['state', files.state],
            ['key', files.key],
          ] as const) {
            await this.stagingEntry(join(dir, `${stem}.${ext}`), content);
            hash.update(`keys/${relative}/${stem}.${ext}\0${content}\0`);
          }
        }
      }
    }

    return hash.digest('hex');
  }

  /**
   * Brings bind's data directory in line with the staging tree. It runs as bind's user in a throwaway container that
   * sees only these two directories: bind writes into its data directory, so the root agent never touches anything
   * in there (a symlink planted by a compromised bind could otherwise turn a write or delete into one on the host).
   * Key files are written once (bind keeps each key's rollover state in them); sources replace changed ones.
   */
  private async syncData(image: string): Promise<boolean> {
    const script = bindDataSyncScript();
    const result = await this.containers.runOnce(
      image,
      ['sh', '-c', script],
      [`${this.stagingDir}:/next:ro`, `${this.dataDir}:/data`],
      { user: `${BIND9_UID}:${BIND9_UID}` },
    );

    if (result.exitCode !== 0) throw new Error(`bind data sync failed: ${result.output.trim().slice(0, 1000)}`);

    return result.output.includes('changed=1');
  }

  /** Overridable for tests. */
  fetchImpl: FetchImpl = defaultFetch;

  /**
   * The GeoIP database for geo views, verified; without it, views that match by country / continent are left out
   * (those clients get the default answers) rather than failing the whole configuration.
   */
  private async withGeoIp(config: AuthoritativeDns): Promise<AuthoritativeDns> {
    const geoViews = (config.views ?? []).some((v) => v.country || v.continent);
    const dir = join(this.dir, 'geoip');

    if (!config.geoip || !geoViews) {
      await rm(dir, { recursive: true, force: true });

      const { geoip: _unused, ...rest } = config;

      return { ...rest, ...(config.views ? { views: config.views.filter((v) => !v.country && !v.continent) } : {}) };
    }

    await mkdir(dir, { recursive: true, mode: 0o755 });

    if (
      await ensureVerifiedFile(
        join(dir, GEOIP_FILE),
        config.geoip.sha256,
        GEOIP_ROUTE,
        this.state,
        this.fetchImpl,
        MAX_GEOIP_BYTES,
      )
    )
      return config;

    const { geoip: _unused, ...rest } = config;

    return { ...rest, views: (config.views ?? []).filter((v) => !v.country && !v.continent) };
  }

  async apply(config: AuthoritativeDns | undefined): Promise<boolean> {
    if (!config) {
      const removed = await this.containers.remove(BIND9_CONTAINER);

      // fs.rm removes symlinks themselves, never what they point to.
      await rm(this.dir, { recursive: true, force: true });
      await rm(this.dataDir, { recursive: true, force: true });
      await rm(this.stagingDir, { recursive: true, force: true });
      await rm(join(this.state.dir, 'bind9-staging.sha256'), { force: true });

      return removed;
    }

    AuthoritativeDnsManager.checkSecrets(config);

    await mkdir(this.dir, { recursive: true, mode: 0o755 });
    // Only the directory itself, in a root-owned parent; its contents are bind's (see syncData).
    await mkdir(this.dataDir, { recursive: true, mode: 0o750 });
    await chown(this.dataDir, BIND9_UID, BIND9_UID);

    const effective = await this.withGeoIp(config);
    const live = join(this.dir, 'zones');
    const next = join(this.dir, 'zones.next');
    const image = bind9Image();
    const namedConf = renderNamedConf(effective, { zones: `${BIND9_DIR}/zones`, signed: `${BIND9_DATA_DIR}/signed` });
    const tsigConf = renderTsigConf(effective);
    const signedZones = new Set(effective.zones.filter((z) => z.dnssec).map((z) => z.name));
    // Relative paths below the zones directory: the shared zones, then every view's variants.
    const zoneFiles = new Map<string, { zone: string; content: string }>([
      ...effective.zones
        .filter((z) => z.file)
        .map((z) => [zoneFileName(z.name), { zone: z.name, content: z.file as string }] as const),
      ...(effective.views ?? []).flatMap((v) =>
        v.zones.map((z) => [viewZoneFile(v.name, z.name), { zone: z.name, content: z.file }] as const),
      ),
    ]);
    const signedSources = [...zoneFiles]
      .filter(([, f]) => signedZones.has(f.zone))
      .map(([file, f]) => [file, f.content] as [string, string]);
    const staged = await this.stage(effective, signedSources);
    const syncedMarker = join(this.state.dir, 'bind9-staging.sha256');
    const same = async (path: string, content: string) => (await readFile(path, 'utf8').catch(() => null)) === content;
    const configUnchanged =
      (await same(join(this.dir, 'named.conf'), namedConf)) &&
      (await same(join(this.dir, TSIG_CONF), tsigConf)) &&
      (await Promise.all([...zoneFiles].map(([file, f]) => same(join(live, file), f.content)))).every(Boolean);
    const dataUnchanged = await same(syncedMarker, staged);

    if (!configUnchanged || !dataUnchanged) {
      await rm(next, { recursive: true, force: true });
      await mkdir(next, { recursive: true, mode: 0o755 });

      for (const [file, f] of zoneFiles) {
        await mkdir(dirname(join(next, file)), { recursive: true, mode: 0o755 });
        await writeFile(join(next, file), f.content, { mode: 0o644 });
      }

      // Readable by bind only (group), never by anyone else on the node.
      await writeFile(join(this.dir, TSIG_CONF), tsigConf, { mode: 0o640 });
      await chown(join(this.dir, TSIG_CONF), 0, BIND9_UID);
      // Checked against the new files (signed zones from their unsigned source) and the staged keys.
      await writeFile(
        join(this.dir, 'named.next.conf'),
        renderNamedConf(effective, { zones: `${BIND9_DIR}/zones.next`, signed: `${BIND9_DIR}/zones.next` }),
        { mode: 0o644 },
      );

      const check = await this.containers.runOnce(
        image,
        ['named-checkconf', '-z', `${BIND9_DIR}/named.next.conf`],
        [`${this.dir}:${BIND9_DIR}:ro`, `${this.stagingDir}:${BIND9_DATA_DIR}:ro`],
      );

      if (check.exitCode !== 0)
        throw new Error(`zones rejected by named-checkconf: ${check.output.trim().slice(0, 1000)}`);
    }

    const dataChanged = dataUnchanged ? false : await this.syncData(image);

    if (!dataUnchanged) await writeFile(syncedMarker, staged, { mode: 0o600 });

    if (!configUnchanged) {
      await rm(live, { recursive: true, force: true });
      await rename(next, live);
      await writeFile(join(this.dir, 'named.conf'), namedConf, { mode: 0o644 });
    }

    await rm(next, { recursive: true, force: true });
    await rm(join(this.dir, 'named.next.conf'), { force: true });

    const unchanged = configUnchanged && !dataChanged;
    const keysChanged = dataChanged;

    const created = await this.containers.ensure(bind9Spec(this.dir, this.dataDir, namedConf, image));

    if ((!unchanged || keysChanged) && !created) await this.containers.signal(BIND9_CONTAINER, 'SIGHUP');

    return created || !unchanged || keysChanged;
  }
}
