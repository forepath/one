import {
  generateSigningKeyPair,
  MAX_PACKAGE_SIZE,
  publicKeyId,
  sha256Digest,
  signBlob,
  type SigningKeyType,
} from '@forepath/loadweaver/shared/util-app-catalog';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import {
  FleetCatalogIndexEntity,
  FleetCatalogKeyEntity,
  FleetCatalogPackageEntity,
  FleetCatalogTakedownEntity,
  type FleetCatalogFinding,
  type FleetCatalogPackageStatus,
} from '../entities/fleet-catalog.entities';
import type { FleetCaller } from '../utils/fleet-access.utils';
import {
  archiveMinLoadweaver,
  buildFleetIndex,
  FLEET_CATALOG_PATHS,
  FLEET_CATALOG_TRUST,
  fleetCatalogIdentity,
  fleetPublicUrl,
  MIN_LOADWEAVER_NONE,
  packageSummary,
  pickChannel,
  serializeIndex,
  validateUpload,
} from '../utils/fleet-catalog.utils';
import { FleetAuditService } from './fleet-audit.service';

const KEY_CACHE_MS = 30_000;
const INDEX_ROW_ID = 1;
/** Startup backfill of `min_loadweaver`: archives read per query (≤ 8 MiB each) and at most per start. */
const BACKFILL_BATCH = 10;
const BACKFILL_MAX = 1000;

/** Type of the catalog key the fleet generates (cosign's default key type; Ed25519 keys verify as well). */
export const FLEET_CATALOG_KEY_TYPE: SigningKeyType = 'ecdsa-p256';

export interface FleetCatalogPackageDto {
  id: string;
  app: string;
  version: string;
  channel: string;
  title: string;
  summary: string;
  manifestPublisher: string;
  license: string;
  /** The manifest's `minLoadweaver` (null: none, or not read yet; the stored `''` = none is mapped to null). */
  minLoadweaver: string | null;
  digest: string;
  size: number;
  status: FleetCatalogPackageStatus;
  findings: FleetCatalogFinding[];
  uploadedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  /** Taken down (by an app-wide or a version takedown). */
  takenDown: boolean;
}

export interface FleetCatalogTakedownDto {
  id: string;
  app: string;
  versions: 'all' | string[];
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

export interface FleetCatalogInfoDto {
  name: string;
  title: string;
  publisher: string;
  trust: string;
  /** `FLEET_PUBLIC_URL`: the catalog `url` clusters use (null: not configured, the console falls back to its own). */
  url: string | null;
  /** The catalog key clusters pin (`publicKeys` of the `type: fleet` catalog). */
  publicKey: string;
  keyId: string;
  keyType: string;
  index: { generatedAt: string; digest: string } | null;
  paths: { key: string; index: string; indexSignature: string; package: string; packageSignature: string };
}

export interface ServedFile {
  body: Buffer;
  /** Strong ETag (the content digest). */
  etag: string;
}

function toTakedownDto(t: FleetCatalogTakedownEntity): FleetCatalogTakedownDto {
  return {
    id: t.id,
    app: t.app,
    versions: t.versions,
    reason: t.reason,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
  };
}

function coveredBy(takedowns: readonly FleetCatalogTakedownEntity[], app: string, version: string): boolean {
  return takedowns.some((t) => t.app === app && (t.versions === 'all' || t.versions.includes(version)));
}

/**
 * The fleet's app catalog (P1 app store, 2026-10-31): the catalog key (created on the first start, sealed like the
 * identity keys), package uploads (validated + linted with the shared format library, signed by the catalog key as
 * the fleet's publisher key), publish / unpublish, takedowns, and the signed index regenerated on every change and
 * served to clusters with `type: fleet` catalogs.
 */
@Injectable()
export class FleetCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FleetCatalogService.name);
  private active: { at: number; row: FleetCatalogKeyEntity } | null = null;
  /** The startup `minLoadweaver` backfill, running in the background (tests await it). */
  backfill: Promise<{ checked: number; filled: number; skipped: number }> | null = null;

  constructor(
    @InjectRepository(FleetCatalogKeyEntity) private readonly keys: Repository<FleetCatalogKeyEntity>,
    @InjectRepository(FleetCatalogPackageEntity) private readonly packages: Repository<FleetCatalogPackageEntity>,
    @InjectRepository(FleetCatalogTakedownEntity) private readonly takedowns: Repository<FleetCatalogTakedownEntity>,
    @InjectRepository(FleetCatalogIndexEntity) private readonly indexes: Repository<FleetCatalogIndexEntity>,
    private readonly audit: FleetAuditService,
  ) {}

  /**
   * The key is generated on the first start (a failure here is retried on first use); the `minLoadweaver` backfill
   * runs in the background afterwards, so it never delays the start.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.signingKey();
    } catch (error) {
      this.logger.warn(`Catalog key: ${error instanceof Error ? error.message : error}`);
    }

    this.backfill = this.backfillMinLoadweaver().catch((error) => {
      this.logger.warn(`minLoadweaver backfill: ${error instanceof Error ? error.message : error}`);

      return { checked: 0, filled: 0, skipped: 0 };
    });
  }

  /**
   * Fills `min_loadweaver` of rows uploaded before the column (NULL = not read yet): reads each stored archive's
   * manifest once and stores its value, or `MIN_LOADWEAVER_NONE` when it has none, so the row isn't read again.
   * Batched (`BACKFILL_BATCH` archives per query, `BACKFILL_MAX` per start); an unreadable archive is logged and
   * skipped (stays NULL, retried on the next start). Idempotent across replicas (no leader in the fleet): a row is
   * only written while still NULL, and every replica writes the same value. Regenerates the index when a published
   * version got a value, so clusters see it.
   */
  async backfillMinLoadweaver(): Promise<{ checked: number; filled: number; skipped: number }> {
    const counts = { checked: 0, filled: 0, skipped: 0 };
    let published = false;
    let after: string | null = null;

    while (counts.checked + counts.skipped < BACKFILL_MAX) {
      const rows: FleetCatalogPackageEntity[] = await this.packages.find({
        select: { id: true, app: true, version: true, status: true, archive: true },
        where: { minLoadweaver: IsNull(), ...(after ? { id: MoreThan(after) } : {}) },
        order: { id: 'ASC' },
        take: BACKFILL_BATCH,
      });

      for (const row of rows) {
        after = row.id;

        const result = archiveMinLoadweaver(row.archive);

        if (result.ok === false) {
          counts.skipped++;
          this.logger.warn(`minLoadweaver backfill: skipped ${row.app} ${row.version}: ${result.errors[0]}`);
          continue;
        }

        await this.packages.update({ id: row.id, minLoadweaver: IsNull() }, { minLoadweaver: result.value });
        counts.checked++;

        if (result.value !== MIN_LOADWEAVER_NONE) {
          counts.filled++;
          published ||= row.status === 'published';
        }
      }

      if (rows.length < BACKFILL_BATCH) break;
    }

    if (published) await this.regenerateIndex();

    if (counts.checked + counts.skipped > 0)
      this.logger.log(
        `minLoadweaver backfill: ${counts.checked} package(s) checked, ${counts.filled} with a minimum, ${counts.skipped} skipped`,
      );

    return counts;
  }

  // --------------------------------------------------------------------------------------------- key

  /** The active catalog key (created when missing; a concurrent creation on another replica wins, this one re-reads). */
  async signingKey(): Promise<FleetCatalogKeyEntity> {
    if (this.active && Date.now() - this.active.at < KEY_CACHE_MS) return this.active.row;

    let row = await this.keys.findOne({ where: { state: 'active' } });

    if (!row) {
      const pair = generateSigningKeyPair(FLEET_CATALOG_KEY_TYPE);

      try {
        row = await this.keys.save(
          this.keys.create({
            kid: pair.keyId,
            type: pair.type,
            publicKey: pair.publicKeyPem,
            privateKey: pair.privateKeyPem,
            state: 'active',
            retiredAt: null,
          }),
        );
        this.logger.log(`Created the fleet catalog key ${row.kid}`);
      } catch {
        row = await this.keys.findOne({ where: { state: 'active' } });
      }
    }

    if (!row) throw new Error('no fleet catalog key');

    // The stored key id must be the key's own id (it is what clusters and the index match on).
    if (publicKeyId(row.publicKey) !== row.kid) throw new Error('the fleet catalog key does not match its key id');

    this.active = { at: Date.now(), row };

    return row;
  }

  /** Every catalog key the index lists (active first, then retired ones, so older signatures keep verifying). */
  private async indexKeys(): Promise<{ kid: string; publicKey: string }[]> {
    const active = await this.signingKey();
    const retired = await this.keys.find({ where: { state: 'retired' }, order: { createdAt: 'DESC' } });

    return [active, ...retired].map((k) => ({ kid: k.kid, publicKey: k.publicKey }));
  }

  /** The public key (SPKI PEM) clusters pin for this catalog. */
  async publicKey(): Promise<string> {
    return (await this.signingKey()).publicKey.trim() + '\n';
  }

  async info(): Promise<FleetCatalogInfoDto> {
    const key = await this.signingKey();
    const catalog = fleetCatalogIdentity();
    const index = await this.indexes.findOne({ where: { id: INDEX_ROW_ID } });

    return {
      ...catalog,
      trust: FLEET_CATALOG_TRUST,
      url: fleetPublicUrl(),
      publicKey: key.publicKey.trim() + '\n',
      keyId: key.kid,
      keyType: key.type,
      index: index ? { generatedAt: index.generatedAt.toISOString(), digest: index.digest } : null,
      paths: {
        key: FLEET_CATALOG_PATHS.key,
        index: FLEET_CATALOG_PATHS.index,
        indexSignature: FLEET_CATALOG_PATHS.indexSignature,
        package: FLEET_CATALOG_PATHS.package(':app', ':version'),
        packageSignature: FLEET_CATALOG_PATHS.packageSignature(':app', ':version'),
      },
    };
  }

  // ------------------------------------------------------------------------------------------ manage

  async list(): Promise<FleetCatalogPackageDto[]> {
    const rows = await this.packages.find({ order: { app: 'ASC', createdAt: 'DESC' } });
    const takedowns = await this.takedowns.find();

    return rows.map((p) => this.toDto(p, takedowns));
  }

  async listTakedowns(): Promise<FleetCatalogTakedownDto[]> {
    return (await this.takedowns.find({ order: { createdAt: 'DESC' } })).map(toTakedownDto);
  }

  /**
   * Uploads a package archive: validated (`loadPackage`) and linted (`lintPackage`; errors block, warnings are kept
   * with the version), signed with the catalog key, stored as a draft — or published right away with `publish`.
   * Re-uploading the identical archive is idempotent; another archive for an existing version is refused.
   */
  async upload(
    caller: FleetCaller,
    archive: Buffer,
    options: { channel?: string | null; publish?: boolean } = {},
  ): Promise<FleetCatalogPackageDto> {
    if (archive.length === 0) throw new BadRequestException('the upload is empty');

    if (archive.length > MAX_PACKAGE_SIZE)
      throw new BadRequestException(`packages are at most ${MAX_PACKAGE_SIZE} bytes`);

    const validation = validateUpload(archive);

    if (validation.ok === false)
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `the package is invalid: ${validation.errors.join('; ')}`.slice(0, 4000),
        errors: validation.errors,
        findings: validation.findings,
      });

    const { manifest, digest } = validation;
    const channel = pickChannel(manifest, options.channel);

    if (channel.ok === false) throw new BadRequestException(channel.errors.join('; '));

    const existing = await this.packages.findOne({ where: { app: manifest.name, version: manifest.version } });

    if (existing) {
      if (existing.digest !== digest)
        throw new ConflictException(
          `${manifest.name} ${manifest.version} exists already with other content: versions are immutable (delete an unpublished version first)`,
        );

      return options.publish ? await this.publish(caller, existing.app, existing.version) : this.toDto(existing, []);
    }

    const key = await this.signingKey();
    const row = await this.packages.save(
      this.packages.create({
        app: manifest.name,
        version: manifest.version,
        channel: channel.value,
        title: manifest.title,
        summary: packageSummary(manifest.description),
        manifestPublisher: manifest.publisher,
        license: manifest.license,
        minLoadweaver: manifest.minLoadweaver ?? MIN_LOADWEAVER_NONE,
        digest,
        size: archive.length,
        archive,
        signature: signBlob(archive, key.privateKey),
        signedBy: key.kid,
        status: 'draft',
        findings: validation.findings.map((f) => ({
          rule: f.rule,
          severity: f.severity,
          message: f.message,
          ...(f.path ? { path: f.path } : {}),
        })),
        uploadedBy: caller.label,
        publishedAt: null,
      }),
    );

    await this.audit.record(caller, 'catalog.package-uploaded', `catalog/${row.app}/${row.version}`, {
      digest,
      size: archive.length,
      channel: channel.value,
      warnings: validation.findings.filter((f) => f.severity === 'warning').length,
    });

    if (options.publish) return await this.publish(caller, row.app, row.version);

    return this.toDto(row, []);
  }

  async publish(caller: FleetCaller, app: string, version: string): Promise<FleetCatalogPackageDto> {
    const row = await this.find(app, version);

    if (row.status !== 'published') {
      row.status = 'published';
      row.publishedAt = row.publishedAt ?? new Date();
      await this.packages.save(row);
      await this.regenerateIndex();
      await this.audit.record(caller, 'catalog.package-published', `catalog/${app}/${version}`, { digest: row.digest });
    }

    return this.toDto(row, await this.takedowns.find({ where: { app } }));
  }

  async unpublish(caller: FleetCaller, app: string, version: string): Promise<FleetCatalogPackageDto> {
    const row = await this.find(app, version);

    if (row.status === 'published') {
      row.status = 'unpublished';
      await this.packages.save(row);
      await this.regenerateIndex();
      await this.audit.record(caller, 'catalog.package-unpublished', `catalog/${app}/${version}`, {});
    }

    return this.toDto(row, await this.takedowns.find({ where: { app } }));
  }

  /** Deletes a version that is not published (a published one is unpublished first; takedowns stay). */
  async remove(caller: FleetCaller, app: string, version: string): Promise<void> {
    const row = await this.find(app, version);

    if (row.status === 'published') throw new ConflictException('unpublish the version before deleting it');

    await this.packages.delete({ id: row.id });
    await this.audit.record(caller, 'catalog.package-deleted', `catalog/${app}/${version}`, { digest: row.digest });
  }

  /**
   * Takes an app (all versions) or some versions down: the signed index lists the takedown, refreshing clusters hide
   * the versions and flag installed copies.
   */
  async takedown(
    caller: FleetCaller,
    app: string,
    input: { versions?: string[] | null; reason: string },
  ): Promise<FleetCatalogTakedownDto> {
    const reason = input.reason.trim();

    if (!reason) throw new BadRequestException('a takedown needs a reason');

    const known = await this.packages.find({ where: { app } });

    if (known.length === 0) throw new NotFoundException(`app ${app} is not in the catalog`);

    const versions = input.versions?.length ? [...new Set(input.versions)] : null;
    const unknown = (versions ?? []).filter((v) => !known.some((p) => p.version === v));

    if (unknown.length) throw new BadRequestException(`unknown versions of ${app}: ${unknown.join(', ')}`);

    const row = await this.takedowns.save(
      this.takedowns.create({
        app,
        versions: versions ?? 'all',
        reason: reason.slice(0, 2000),
        createdBy: caller.label,
      }),
    );

    await this.regenerateIndex();
    await this.audit.record(caller, 'catalog.takedown', `catalog/${app}`, {
      versions: row.versions,
      reason: row.reason,
    });

    return toTakedownDto(row);
  }

  async liftTakedown(caller: FleetCaller, id: string): Promise<void> {
    const row = await this.takedowns.findOne({ where: { id } });

    if (!row) throw new NotFoundException('takedown not found');

    await this.takedowns.delete({ id });
    await this.regenerateIndex();
    await this.audit.record(caller, 'catalog.takedown-lifted', `catalog/${row.app}`, { versions: row.versions });
  }

  private async find(app: string, version: string): Promise<FleetCatalogPackageEntity> {
    const row = await this.packages.findOne({ where: { app, version } });

    if (!row) throw new NotFoundException(`${app} ${version} is not in the catalog`);

    return row;
  }

  private toDto(
    p: FleetCatalogPackageEntity,
    takedowns: readonly FleetCatalogTakedownEntity[],
  ): FleetCatalogPackageDto {
    return {
      id: p.id,
      app: p.app,
      version: p.version,
      channel: p.channel,
      title: p.title,
      summary: p.summary,
      manifestPublisher: p.manifestPublisher,
      license: p.license,
      minLoadweaver: p.minLoadweaver || null,
      digest: p.digest,
      size: p.size,
      status: p.status,
      findings: p.findings ?? [],
      uploadedBy: p.uploadedBy,
      createdAt: p.createdAt.toISOString(),
      publishedAt: p.publishedAt?.toISOString() ?? null,
      takenDown: coveredBy(takedowns, p.app, p.version),
    };
  }

  // ------------------------------------------------------------------------------------------- index

  /** Regenerates and signs the index from the published versions and the takedowns, and stores it for serving. */
  async regenerateIndex(): Promise<FleetCatalogIndexEntity> {
    const key = await this.signingKey();
    const published = await this.packages.find({ where: { status: 'published' } });
    const takedowns = await this.takedowns.find();
    const index = buildFleetIndex({
      catalog: fleetCatalogIdentity(),
      keys: await this.indexKeys(),
      packages: published,
      takedowns,
    });
    const content = serializeIndex(index);
    const bytes = Buffer.from(content, 'utf8');
    const row = this.indexes.create({
      id: INDEX_ROW_ID,
      content,
      signature: signBlob(bytes, key.privateKey),
      digest: sha256Digest(bytes),
      signedBy: key.kid,
      generatedAt: new Date(index.generatedAt),
    });

    await this.indexes.save(row);

    return row;
  }

  // ----------------------------------------------------------------------------------------- serving

  private async currentIndex(): Promise<FleetCatalogIndexEntity> {
    const row = await this.indexes.findOne({ where: { id: INDEX_ROW_ID } });

    return row ?? (await this.regenerateIndex());
  }

  async servedIndex(): Promise<ServedFile> {
    const row = await this.currentIndex();

    return { body: Buffer.from(row.content, 'utf8'), etag: row.digest };
  }

  async servedIndexSignature(): Promise<ServedFile> {
    const row = await this.currentIndex();

    return { body: Buffer.from(row.signature, 'utf8'), etag: `${row.digest}.sig` };
  }

  /** A published version's archive or its signature (404 for drafts / unpublished versions and unknown ones). */
  async servedPackage(app: string, version: string, signature: boolean): Promise<ServedFile> {
    const row = await this.packages.findOne({
      where: { app, version, status: 'published' as const },
      select: { id: true, app: true, version: true, digest: true, signature: true, status: true, archive: !signature },
    });

    if (!row) throw new NotFoundException('package not found');

    return signature
      ? { body: Buffer.from(row.signature, 'utf8'), etag: `${row.digest}.sig` }
      : { body: Buffer.from(row.archive), etag: row.digest };
  }
}
