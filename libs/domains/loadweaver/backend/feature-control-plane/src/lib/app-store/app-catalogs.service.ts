import type { RequestWithUser } from '@forepath/identity/backend';
import {
  checkMinLoadweaver,
  effectiveTrust,
  findAffectedInstalls,
  findTakedown,
  isTrustAllowed,
  listedApps,
  loadPackage,
  sha256Digest,
  TRUST_LABELS,
  verifyIndex,
  verifyPackage,
  type AppStoreConfig,
  type CatalogApp,
  type CatalogIndex,
  type CatalogSource,
  type CatalogTakedown,
  type LoadedPackage,
  type TrustLabel,
} from '@forepath/loadweaver/shared/util-app-catalog';
import {
  DEFAULT_REGISTRY_MIRRORS,
  installedAppOf,
  PRIVATE_REGISTRY_HOST,
  type InstalledAppMetadata,
} from '@forepath/loadweaver/shared/util-model';
import { validateWebhookUrlWithDnsOrThrow } from '@forepath/shared/backend/util-webhook';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Not } from 'typeorm';

import { hasAnyRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { writesPaused } from '../database-handover/database-target.runtime';
import { GitConnectionEntity } from '../entities/git.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { TrustedFleetEntity } from '../fleet-identity/fleet-identity.entities';
import { GitClient, gitIdentityFromEnv } from '../git/git-client';
import { GitConnectionsService } from '../git/git-connections.service';
import { mirrorPort, REGISTRY_PRIVATE_PORT } from '../object-store/registry-state.utils';
import { AuditLogService } from '../services/audit-log.service';
import { nodeAddress } from '../services/object-store-controller.service';
import { RegistryTokenService } from '../services/registry-token.service';
import { controlPlaneVersion } from '../updates/releases.service';
import {
  catalogKeys,
  catalogSourceHash,
  displayCatalogUrl,
  effectiveAppStoreConfig,
  fleetCatalogAllowsHttp,
  fleetCatalogTlsRejectUnauthorized,
  officialCatalogFromEnv,
  type CatalogFleetManager,
  type EffectiveAppStoreConfig,
  type EffectiveCatalogSource,
  type OfficialCatalog,
  type ResolvedCatalogKeys,
} from './app-store-config';
import { AppCatalogEntity, AppPackageEntity, AppTakedownFlagEntity } from './app-store.entities';
import {
  FleetCatalogClient,
  GitCatalogClient,
  OciCatalogClient,
  type CatalogCheckout,
  type CatalogClient,
  type OciEndpoint,
} from './catalog-clients';
import { CatalogHttp, insecureTlsFetch, type FetchLike } from './catalog-http';

const TICK_MS = 5 * 60_000;
const DEFAULT_REFRESH_MINUTES = 360;
/** One replica claims due catalogs (transaction-scoped advisory lock). */
export const ADVISORY_LOCK_APP_CATALOGS = 0x4c570048;
const MAX_ERROR = 2000;
const GIT_MAX_FILE_BYTES = 16 * 1024 * 1024;

export type AppCatalogDisplayStatus = 'ok' | 'error' | 'pending' | 'disabled' | 'untrusted';

/** `GET /apps/catalogs`: one configured catalog source and the state of its cache. */
export interface AppCatalogDto {
  name: string;
  type: CatalogSource['type'];
  /** Without credentials, query or fragment. */
  url: string;
  ref: string | null;
  official: boolean;
  /**
   * The fixed entry of a trusted fleet's catalog (2026-11-01): always enabled, not removable while the fleet is
   * trusted here; `fleet` names the fleet.
   */
  fleetManaged: boolean;
  fleet: CatalogFleetManager | null;
  enabled: boolean;
  /** Where the verification keys come from; `none` = can't be enabled (nothing to verify against). */
  keys: ResolvedCatalogKeys['origin'];
  status: AppCatalogDisplayStatus;
  error: string | null;
  /** The catalog as its index names itself (after the first successful refresh). */
  title: string | null;
  apps: number;
  generatedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** Git catalogs: the commit the `ref` resolved to at the last successful refresh (null otherwise / until then). */
  resolvedCommit: string | null;
}

export interface AppVersionDto {
  version: string;
  channel: string;
  digest: string;
  published: string;
}

/** Why projects can't install an app: its trust label isn't allowed, or the cluster is older than `minLoadweaver`. */
export type AppNotInstallableReason = 'trust' | 'loadweaver-version';

/** `GET /apps`: one app of an enabled catalog (taken-down versions hidden). */
export interface AppSummaryDto {
  catalog: string;
  name: string;
  title: string;
  summary: string;
  publisher: string;
  /** Effective trust label (`official` only from the official catalog). */
  trust: TrustLabel;
  /** Whether projects may install it: `allowedTrust` admits its label and the cluster meets `minLoadweaver`. */
  installable: boolean;
  /** Why not (`installable: false`); the trust label wins when both apply. */
  notInstallableReason: AppNotInstallableReason | null;
  /** `minLoadweaver` of the shown version (the index's for lists, the manifest's on the app page). */
  minLoadweaver: string | null;
  /** The control plane's version; null for development builds (`minLoadweaver` isn't enforced then). */
  loadweaverVersion: string | null;
  deprecated: boolean;
  latest: AppVersionDto;
  versions: AppVersionDto[];
}

/** `GET /apps/:catalog/:app`: the app with one version's verified package (manifest, README). */
export interface AppDetailDto extends AppSummaryDto {
  version: AppVersionDto;
  manifest: LoadedPackage['manifest'];
  readme: string;
  /** State of the catalog the app comes from (`error`: a refresh failed, the cached index is served). */
  catalogStatus: AppCatalogDisplayStatus;
}

/** One configured catalog with everything needed to use it. */
export interface ResolvedCatalog {
  source: EffectiveCatalogSource;
  keys: ResolvedCatalogKeys;
  hash: string;
  row: AppCatalogEntity | null;
  /** The verified index, only when the cache belongs to the current source (hash) and the catalog is enabled. */
  index: CatalogIndex | null;
  status: AppCatalogDisplayStatus;
}

/** An installed app (a Deployment with the app record). */
export interface InstalledAppRow extends InstalledAppMetadata {
  project: string;
  deployment: string;
  annotations: Record<string, string>;
  labels: Record<string, string>;
  spec: Record<string, unknown>;
  generation: number;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR);
}

function iso(date: Date | null | undefined): string | null {
  return date ? new Date(date).toISOString() : null;
}

function versionDto(v: CatalogApp['versions'][number]): AppVersionDto {
  return { version: v.version, channel: v.channel, digest: v.digest, published: v.published };
}

/**
 * Whether projects may install an app version (P1): the trust label must be allowed (`allowedTrust`) and the cluster
 * at least `minLoadweaver` (unknown / development versions aren't checked).
 */
export function appInstallability(
  trust: TrustLabel,
  config: Pick<AppStoreConfig, 'allowedTrust'>,
  minLoadweaver: string | null | undefined,
  loadweaverVersion: string | null,
): Pick<AppSummaryDto, 'installable' | 'notInstallableReason'> {
  const reason: AppNotInstallableReason | null = !isTrustAllowed(trust, config)
    ? 'trust'
    : checkMinLoadweaver(minLoadweaver, loadweaverVersion).ok
      ? null
      : 'loadweaver-version';

  return { installable: reason === null, notInstallableReason: reason };
}

export function toAppSummary(
  catalog: ResolvedCatalog,
  app: CatalogApp,
  config: Pick<AppStoreConfig, 'allowedTrust'>,
  loadweaverVersion: string | null = null,
): AppSummaryDto {
  const trust = effectiveTrust(app, catalog.source);
  const versions = app.versions.map(versionDto);
  const latest = versions.find((v) => v.channel === 'stable') ?? versions[0];
  const minLoadweaver = app.versions.find((v) => v.version === latest.version)?.minLoadweaver ?? null;

  return {
    catalog: catalog.source.name,
    name: app.name,
    title: app.title,
    summary: app.summary,
    publisher: app.publisher,
    trust,
    ...appInstallability(trust, config, minLoadweaver, loadweaverVersion),
    minLoadweaver,
    loadweaverVersion,
    deprecated: !!app.deprecated,
    latest,
    versions,
  };
}

/** Filters for `GET /apps`: free text over name / title / summary / publisher, catalog, effective trust label. */
export function matchesAppFilter(
  app: AppSummaryDto,
  filter: { q?: string; catalog?: string; trust?: string },
): boolean {
  if (filter.catalog && app.catalog !== filter.catalog) return false;

  if (filter.trust && app.trust !== filter.trust) return false;

  const q = filter.q?.trim().toLowerCase();

  return !q || [app.name, app.title, app.summary, app.publisher].some((s) => s.toLowerCase().includes(q));
}

/**
 * App store catalogs (P1): resolves `Cluster.spec.appStore` (official catalog from the environment, a fixed entry per
 * trusted fleet's catalog), fetches each
 * enabled catalog's index from its source (OCI registry, Git repository, trusted fleet), verifies it against the
 * catalog keys before parsing (`verifyIndex`), caches it in Postgres bound to the source it was verified for, and
 * fetches / verifies / caches packages on demand (`verifyPackage`, `loadPackage`). Refreshes run every
 * `LOADWEAVER_APP_CATALOG_REFRESH_MINUTES` (default 6 h) on one replica and on demand (cluster admins); while the
 * database is read-only the cache is served and refreshes pause. Takedowns flag installed copies (inbox, status).
 */
@Injectable()
export class AppCatalogsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppCatalogsService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Test seams. */
  fetchImpl: FetchLike = (url, init) => fetch(url, init);
  /** Trusted fleets' catalogs with `LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED=false` (dedicated agent). */
  insecureFetchImpl: FetchLike = insecureTlsFetch;
  validateUrl: (url: string) => Promise<unknown> = validateWebhookUrlWithDnsOrThrow;
  official: OfficialCatalog = officialCatalogFromEnv();
  git = new GitClient({ identity: gitIdentityFromEnv(), maxFileBytes: GIT_MAX_FILE_BYTES });
  clients: Partial<Record<CatalogSource['type'], CatalogClient>> = {};
  /** The running control plane's version for `minLoadweaver` (null = development build). */
  loadweaverVersion: () => string | null = () => controlPlaneVersion();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly registryTokens: RegistryTokenService,
    private readonly gitConnections: GitConnectionsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (writesPaused('App catalog refresh', this.logger)) return;

      this.tick().catch((error) => this.logger.warn(`App catalog refresh: ${message(error)}`));
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------------------------------------- config

  /** Refresh interval (`LOADWEAVER_APP_CATALOG_REFRESH_MINUTES`, at least 5). */
  refreshIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
    const minutes = Number(env['LOADWEAVER_APP_CATALOG_REFRESH_MINUTES']);

    return (Number.isFinite(minutes) && minutes >= 5 ? minutes : DEFAULT_REFRESH_MINUTES) * 60_000;
  }

  /** The configuration in effect and every catalog with its keys and cache. */
  async resolve(): Promise<{ config: EffectiveAppStoreConfig; catalogs: ResolvedCatalog[] }> {
    const cluster = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Cluster', projectKey: '' } });
    const fleets = await this.dataSource.getRepository(TrustedFleetEntity).find();
    const config = effectiveAppStoreConfig(cluster?.spec?.['appStore'], this.official, fleets);
    const rows = new Map(
      (await this.dataSource.getRepository(AppCatalogEntity).find()).map((r) => [r.name, r] as const),
    );

    const catalogs = config.catalogs.map((source): ResolvedCatalog => {
      const keys = catalogKeys(source, this.official, fleets);
      const hash = catalogSourceHash(source, keys.keys);
      const row = rows.get(source.name) ?? null;
      const current = row && row.sourceHash === hash ? row : null;
      const status: AppCatalogDisplayStatus = !source.enabled
        ? 'disabled'
        : keys.keys.length === 0
          ? 'untrusted'
          : current?.index
            ? current.status === 'error'
              ? 'error'
              : 'ok'
            : current?.status === 'error'
              ? 'error'
              : 'pending';

      return {
        source,
        keys,
        hash,
        row: current,
        index: source.enabled && keys.keys.length > 0 ? (current?.index ?? null) : null,
        status,
      };
    });

    return { config, catalogs };
  }

  private async assertAudience(req: RequestWithUser | undefined): Promise<AccessCaller> {
    const caller = await this.access.caller(req);

    if (!hasAnyRole(caller)) throw new ForbiddenException('the app store needs a project membership or a cluster role');

    return caller;
  }

  // ------------------------------------------------------------------------------------------------- browse

  async catalogs(req: RequestWithUser | undefined): Promise<{ catalogs: AppCatalogDto[]; allowedTrust: TrustLabel[] }> {
    await this.assertAudience(req);

    const { config, catalogs } = await this.resolve();

    return {
      allowedTrust: TRUST_LABELS.filter((t) => config.allowedTrust.includes(t)),
      catalogs: catalogs.map((c) => ({
        name: c.source.name,
        type: c.source.type,
        url: displayCatalogUrl(c.source.url),
        ref: c.source.ref ?? null,
        official: !!c.source.official,
        fleetManaged: !!c.source.fleet,
        fleet: c.source.fleet ? { ...c.source.fleet } : null,
        enabled: c.source.enabled,
        keys: c.keys.origin,
        status: c.status,
        error:
          c.status === 'untrusted'
            ? c.source.official
              ? 'no official ForePath catalog key is configured (LOADWEAVER_APP_CATALOG_OFFICIAL_KEY)'
              : 'no public key to verify the catalog with'
            : (c.row?.error ?? null),
        title: c.row?.index?.catalog.title ?? null,
        apps: c.index ? listedApps(c.index).length : 0,
        generatedAt: c.row?.index?.generatedAt ?? null,
        lastAttemptAt: iso(c.row?.lastAttemptAt),
        lastSuccessAt: iso(c.row?.lastSuccessAt),
        resolvedCommit: c.row?.resolvedCommit ?? null,
      })),
    };
  }

  async apps(
    req: RequestWithUser | undefined,
    filter: { q?: string; catalog?: string; trust?: string } = {},
  ): Promise<{ apps: AppSummaryDto[] }> {
    await this.assertAudience(req);

    const { config, catalogs } = await this.resolve();
    const loadweaverVersion = this.loadweaverVersion();
    const apps = catalogs.flatMap((c) =>
      c.index ? listedApps(c.index).map((app) => toAppSummary(c, app, config, loadweaverVersion)) : [],
    );

    return {
      apps: apps
        .filter((a) => matchesAppFilter(a, filter))
        .sort((a, b) => a.title.localeCompare(b.title) || a.catalog.localeCompare(b.catalog)),
    };
  }

  /** The app with the verified package of `version` (default: newest stable, else newest). */
  async app(req: RequestWithUser | undefined, catalog: string, name: string, version?: string): Promise<AppDetailDto> {
    await this.assertAudience(req);

    const { config, catalogs } = await this.resolve();
    const resolved = this.enabled(catalogs, catalog);
    const app = listedApps(resolved.index).find((a) => a.name === name);

    if (!app) {
      const takedown = findTakedown(resolved.index, name);

      if (takedown) throw new GoneException(`${name} was taken down: ${takedown.reason}`);

      throw new NotFoundException(`app ${name} is not in catalog ${catalog}`);
    }

    const loadweaverVersion = this.loadweaverVersion();
    const summary = toAppSummary(resolved, app, config, loadweaverVersion);
    const selected = version ? summary.versions.find((v) => v.version === version) : summary.latest;

    if (!selected) {
      const takedown = version ? findTakedown(resolved.index, name, version) : undefined;

      if (takedown) throw new GoneException(`${name} ${version} was taken down: ${takedown.reason}`);

      throw new NotFoundException(`version ${version} of ${name} is not in catalog ${catalog}`);
    }

    const pkg = await this.package(resolved, name, selected.version);
    // The signed manifest decides for the shown version (older indexes don't carry `minLoadweaver`).
    const minLoadweaver = pkg.manifest.minLoadweaver ?? null;

    return {
      ...summary,
      ...appInstallability(summary.trust, config, minLoadweaver, loadweaverVersion),
      minLoadweaver,
      version: selected,
      manifest: pkg.manifest,
      readme: pkg.files.readme,
      catalogStatus: resolved.status,
    };
  }

  /** An enabled catalog with a verified index, or a 404 / 503 that says why not. */
  enabled(catalogs: readonly ResolvedCatalog[], name: string): ResolvedCatalog & { index: CatalogIndex } {
    const resolved = catalogs.find((c) => c.source.name === name);

    if (!resolved || !resolved.source.enabled) throw new NotFoundException(`catalog ${name} is not enabled`);

    if (!resolved.index)
      throw new ServiceUnavailableException(
        resolved.status === 'untrusted'
          ? `catalog ${name} has no key to verify it with`
          : `catalog ${name} has no verified index yet${resolved.row?.error ? `: ${resolved.row.error}` : ''}`,
      );

    return resolved as ResolvedCatalog & { index: CatalogIndex };
  }

  // ----------------------------------------------------------------------------------------------- packages

  /**
   * A verified package: from the cache when its digest still matches the index, else fetched from the source,
   * verified against the publisher's key and cached (the cache write is skipped while the database is read-only).
   * Taken-down versions are refused.
   */
  async package(
    catalog: ResolvedCatalog & { index: CatalogIndex },
    app: string,
    version: string,
  ): Promise<LoadedPackage> {
    const takedown = findTakedown(catalog.index, app, version);

    if (takedown) throw new GoneException(`${app} ${version} was taken down: ${takedown.reason}`);

    const entry = catalog.index.apps.find((a) => a.name === app)?.versions.find((v) => v.version === version);

    if (!entry) throw new NotFoundException(`${app} ${version} is not in catalog ${catalog.source.name}`);

    const repo = this.dataSource.getRepository(AppPackageEntity);
    const cached = await repo.findOne({ where: { catalog: catalog.source.name, app, version } });

    if (cached && cached.digest === entry.digest) {
      const loaded = loadPackage(cached.archive, { digest: entry.digest, name: app, version });

      if (loaded.ok) return loaded.value;
    }

    let fetched;

    try {
      fetched = await this.client(catalog.source.type).fetchPackage(catalog.source, app, version);
    } catch (error) {
      throw new ServiceUnavailableException(`${app} ${version}: ${message(error)}`);
    }

    const verified = verifyPackage({
      index: catalog.index,
      app,
      version,
      archive: fetched.bytes,
      signature: fetched.signature,
    });

    if (verified.ok === false)
      throw new BadRequestException(`${app} ${version} failed verification: ${verified.errors.join('; ')}`);

    const loaded = loadPackage(fetched.bytes, { digest: entry.digest, name: app, version });

    if (loaded.ok === false)
      throw new BadRequestException(`${app} ${version} is not a valid package: ${loaded.errors.join('; ')}`);

    if (!writesPaused('App package cache'))
      await repo
        .save(
          repo.create({
            catalog: catalog.source.name,
            app,
            version,
            digest: entry.digest,
            archive: Buffer.from(fetched.bytes),
            keyId: verified.value.keyId,
          }),
        )
        .catch((error) => this.logger.warn(`App package cache ${app} ${version}: ${message(error)}`));

    return loaded.value;
  }

  // ------------------------------------------------------------------------------------------------ refresh

  /** Manual refresh (cluster admins): one catalog or every enabled one. */
  async refresh(req: RequestWithUser | undefined, name?: string): Promise<{ catalogs: AppCatalogDto[] }> {
    const caller = await this.access.caller(req);

    if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admins refresh the app catalogs');

    if (writesPaused('App catalog refresh'))
      throw new ServiceUnavailableException(
        'the database is read-only: the app store serves the cached catalogs; refresh once writes are back',
      );

    const { catalogs } = await this.resolve();
    const targets = catalogs.filter((c) => c.source.enabled && (!name || c.source.name === name));

    if (name && targets.length === 0) throw new NotFoundException(`catalog ${name} is not enabled`);

    for (const catalog of targets) await this.refreshCatalog(catalog);

    return { catalogs: (await this.catalogs(req)).catalogs };
  }

  /**
   * A trusted fleet registered or changed its catalog (2026-11-01): run a pass now instead of at the next tick — the
   * new / changed fixed entry is due (no cache row, or one bound to another source hash). In the background; the
   * advisory lock keeps it to one replica.
   */
  catalogSourcesChanged(): void {
    if (writesPaused('App catalog refresh', this.logger)) return;

    this.tick().catch((error) => this.logger.warn(`App catalog refresh: ${message(error)}`));
  }

  /** One periodic pass: claims the due catalogs on one replica, then refreshes them. */
  async tick(now = Date.now()): Promise<number> {
    const { catalogs } = await this.resolve();
    const interval = this.refreshIntervalMs();
    const allRows = new Map(
      (await this.dataSource.getRepository(AppCatalogEntity).find()).map((r) => [r.name, r] as const),
    );
    const due = catalogs.filter((c) => {
      if (!c.source.enabled || c.keys.keys.length === 0) return false;

      const row = allRows.get(c.source.name);

      return !row || row.sourceHash !== c.hash || !row.lastAttemptAt || now - row.lastAttemptAt.getTime() >= interval;
    });

    if (due.length === 0) return 0;

    const claimed = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_APP_CATALOGS,
      ]);

      if (!locked) return [];

      const repo = manager.getRepository(AppCatalogEntity);
      const fresh = new Map(
        (await repo.find({ where: { name: In(due.map((c) => c.source.name)) } })).map((r) => [r.name, r] as const),
      );
      const mine = due.filter((c) => {
        const row = fresh.get(c.source.name);

        return !row || row.sourceHash !== c.hash || !row.lastAttemptAt || now - row.lastAttemptAt.getTime() >= interval;
      });

      for (const c of mine) {
        const row = fresh.get(c.source.name);

        await repo.save(
          row
            ? Object.assign(row, { lastAttemptAt: new Date(now) })
            : repo.create({ name: c.source.name, sourceHash: c.hash, status: 'pending', lastAttemptAt: new Date(now) }),
        );
      }

      return mine;
    });

    for (const catalog of claimed) await this.refreshCatalog(catalog, new Date(now));

    return claimed.length;
  }

  /**
   * Fetches, verifies and stores one catalog's index, then flags the installs its takedowns hit. A failure keeps the
   * last verified index of the same source (served) and records the error; an index older than the cached one is
   * refused (no rollback to an index that still lists taken-down apps).
   */
  async refreshCatalog(catalog: ResolvedCatalog, now = new Date()): Promise<AppCatalogEntity> {
    const repo = this.dataSource.getRepository(AppCatalogEntity);
    const existing = await repo.findOne({ where: { name: catalog.source.name } });
    const previous = existing && existing.sourceHash === catalog.hash ? existing : null;
    const base = existing ?? repo.create({ name: catalog.source.name });
    let result: { index: CatalogIndex; keyId: string; digest: string; commit: string | null } | { error: string };

    if (catalog.keys.keys.length === 0) result = { error: 'no public key to verify the catalog with' };
    else
      try {
        const fetched = await this.client(catalog.source.type).fetchIndex(catalog.source);
        const verified = verifyIndex(fetched.bytes, fetched.signature, catalog.keys.keys);

        if (verified.ok === false) result = { error: `verification failed: ${verified.errors.join('; ')}` };
        else if (
          previous?.index &&
          Date.parse(verified.value.index.generatedAt) < Date.parse(previous.index.generatedAt)
        )
          result = {
            error: `the index (${verified.value.index.generatedAt}) is older than the cached one (${previous.index.generatedAt}); kept the cached index`,
          };
        else result = { ...verified.value, digest: sha256Digest(fetched.bytes), commit: fetched.commit ?? null };
      } catch (error) {
        result = { error: message(error) };
      }

    const saved = await repo.save(
      'error' in result
        ? Object.assign(base, {
            sourceHash: catalog.hash,
            status: 'error' as const,
            error: result.error.slice(0, MAX_ERROR),
            lastAttemptAt: now,
            ...(previous
              ? {}
              : { index: null, indexDigest: null, keyId: null, lastSuccessAt: null, resolvedCommit: null }),
          })
        : Object.assign(base, {
            sourceHash: catalog.hash,
            status: 'ok' as const,
            error: null,
            index: result.index,
            indexDigest: result.digest,
            keyId: result.keyId,
            resolvedCommit: catalog.source.type === 'git' ? result.commit : null,
            lastAttemptAt: now,
            lastSuccessAt: now,
          }),
    );

    if ('error' in result) this.logger.warn(`App catalog ${catalog.source.name}: ${result.error}`);
    else await this.flagTakedowns(catalog.source.name, result.index);

    return saved;
  }

  // ---------------------------------------------------------------------------------------------- takedowns

  /** Installed apps: Deployments carrying the app record. */
  async installs(): Promise<InstalledAppRow[]> {
    const rows = await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Deployment' } });

    return rows.flatMap((r) => {
      const app = installedAppOf(r.annotations);

      return app && r.project
        ? [
            {
              ...app,
              project: r.project,
              deployment: r.name,
              annotations: r.annotations ?? {},
              labels: r.labels ?? {},
              spec: r.spec ?? {},
              generation: r.generation,
            },
          ]
        : [];
    });
  }

  /**
   * Reconciles the takedown flags of one catalog with its index: new hits are flagged (audited `app.takedown`),
   * flags whose install was updated, removed or un-taken-down disappear.
   */
  async flagTakedowns(catalog: string, index: CatalogIndex): Promise<{ flagged: number; cleared: number }> {
    const affected = findAffectedInstalls(index, await this.installs(), catalog);

    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AppTakedownFlagEntity);
      const existing = await repo.find({ where: { catalog } });
      const key = (x: { project: string; deployment: string }) => `${x.project}/${x.deployment}`;
      const hits = new Map(affected.map((a) => [key(a.install), a] as const));
      const stale = existing.filter((f) => {
        const hit = hits.get(key(f));

        return !hit || hit.install.version !== f.version;
      });

      if (stale.length) await repo.remove(stale);

      const kept = new Set(existing.filter((f) => !stale.includes(f)).map(key));
      let flagged = 0;

      for (const { install, takedown } of affected) {
        if (kept.has(key(install))) continue;

        await repo.save(repo.create(flagRow(catalog, install, takedown)));
        await this.audit.record(manager, {
          actor: { type: 'system', id: null },
          action: 'app.takedown',
          target: `deployment/${install.project}/${install.deployment}`,
          project: install.project,
          details: { catalog, app: install.name, version: install.version, reason: takedown.reason },
        });
        flagged += 1;
      }

      return { flagged, cleared: stale.length };
    });
  }

  /** Takedown flags (all, or of some deployments). */
  async flags(): Promise<AppTakedownFlagEntity[]> {
    return await this.dataSource.getRepository(AppTakedownFlagEntity).find();
  }

  // ---------------------------------------------------------------------------------------------- clients

  client(type: CatalogSource['type']): CatalogClient {
    const existing = this.clients[type];

    if (existing) return existing;

    const http = new CatalogHttp(
      (url, init) => this.fetchImpl(url, init),
      (url) => this.validateUrl(url),
      undefined,
      (url, init) => this.insecureFetchImpl(url, init),
    );
    const client: CatalogClient =
      type === 'oci'
        ? new OciCatalogClient(http, (host, repository) => this.ociEndpoints(host, repository))
        : type === 'git'
          ? new GitCatalogClient((repository, ref) => this.openGit(repository, ref))
          : new FleetCatalogClient(
              http,
              async (source) => {
                const fleets = await this.dataSource.getRepository(TrustedFleetEntity).find();

                return catalogKeys(source, this.official, fleets).trustedFleet;
              },
              () => fleetCatalogAllowsHttp(),
              () => fleetCatalogTlsRejectUnauthorized(),
            );

    this.clients[type] = client;

    return client;
  }

  /**
   * Where an OCI registry is reached: the built-in registry (`registry.lw/<project>/…`) on the control-plane members
   * with a short pull token; a registry the cluster mirrors (3.22) through the mirror first, then upstream; anything
   * else upstream (https, public addresses only).
   */
  async ociEndpoints(host: string, repository: string): Promise<OciEndpoint[]> {
    const upstream: OciEndpoint = { base: `https://${host}`, internal: false, label: host };
    const members = async () =>
      (
        await this.dataSource
          .getRepository(NodeEntity)
          .find({ where: { controlPlane: true, lifecycle: Not('left') }, order: { name: 'ASC' } })
      )
        .map((n) => nodeAddress(n))
        .filter((a): a is string => !!a);

    if (host === PRIVATE_REGISTRY_HOST) {
      const token = await this.registryTokens.issue(
        'control-plane:app-store',
        [{ name: repository, actions: ['pull'] }],
        300,
      );

      return (await members()).map((m) => ({
        base: `http://${m}:${REGISTRY_PRIVATE_PORT}`,
        internal: true,
        token,
        label: `built-in registry on ${m}`,
      }));
    }

    const cluster = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Cluster', projectKey: '' } });
    const registry = cluster?.spec?.['registry'] as { mirrors?: { host: string }[] } | undefined;
    const mirrors = registry?.mirrors ?? DEFAULT_REGISTRY_MIRRORS;
    const index = mirrors.findIndex((m) => m.host === host);

    if (index < 0) return [upstream];

    return [
      ...(await members()).map((m) => ({
        base: `http://${m}:${mirrorPort(index)}`,
        internal: true,
        label: `mirror of ${host} on ${m}`,
      })),
      upstream,
    ];
  }

  /**
   * A shallow checkout of a Git catalog at a branch, tag or commit: credentials of the cluster's Git connection for the same repository when
   * there is one (3.29), anonymous https otherwise; https hosts must resolve to public addresses.
   */
  async openGit(repository: string, ref: string): Promise<CatalogCheckout> {
    const normalize = (url: string) =>
      url
        .trim()
        .replace(/\/+$/, '')
        .replace(/\.git$/, '')
        .toLowerCase();
    const connection = (await this.dataSource.getRepository(GitConnectionEntity).find()).find(
      (c) => c.project === null && normalize(c.repoUrl) === normalize(repository),
    );

    if (!connection) {
      if (!repository.startsWith('https://'))
        throw new Error('ssh / http Git catalogs need a cluster Git connection for the repository (credentials)');

      await this.validateUrl(repository);
    }

    const remote = connection
      ? await this.gitConnections.remote(connection)
      : { url: repository, auth: { kind: 'none' as const } };
    // A branch, a tag or a full commit SHA (P1), checked out shallow and detached.
    const tree = await this.git.openCatalogRef(remote, ref);

    return {
      readFile: async (path) => await tree.readFile(path),
      dispose: async () => await tree.dispose(),
      commit: tree.resolvedCommit,
    };
  }
}

function flagRow(catalog: string, install: InstalledAppRow, takedown: CatalogTakedown): Partial<AppTakedownFlagEntity> {
  return {
    project: install.project,
    deployment: install.deployment,
    catalog,
    app: install.name,
    version: install.version,
    reason: takedown.reason.slice(0, MAX_ERROR),
    takenDownAt: new Date(takedown.at),
  };
}
