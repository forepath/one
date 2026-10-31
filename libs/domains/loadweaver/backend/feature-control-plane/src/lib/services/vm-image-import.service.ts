import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';

import type { RequestWithUser } from '@forepath/identity/backend';
import {
  containerDiskFormat,
  SHA256_HEX_PATTERN,
  SHA512_HEX_PATTERN,
  VM_IMAGE_ARCHES,
  type VmImageFormat,
} from '@forepath/loadweaver/shared/util-model';
import { readTar } from '@forepath/loadweaver/shared/util-release';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import { validateWebhookUrlWithDnsOrThrow } from '@forepath/shared/backend/util-webhook';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { atLeast, canReadProject, projectRole } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VmImageImportEntity } from '../entities/virtual-machine.entities';
import { REGISTRY_PRIVATE_PORT } from '../object-store/registry-state.utils';
import { pushBlob, pushManifest, type RegistryEndpoint } from '../updates/registry-import';
import {
  detectDiskFormat,
  OCI_MANIFEST_MEDIA_TYPE,
  parseVmImageImportRef,
  qcow2VirtualSize,
  vmImageConfigBlob,
  vmImageLayerDescriptor,
  vmImageLayerTitle,
  vmImageManifest,
  vmImageReference,
} from '../utils/vm-image-import.utils';
import { AuditLogService, actorFromRequest } from './audit-log.service';
import { nodeAddress } from './object-store-controller.service';
import { RegistryTokenService } from './registry-token.service';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 10_000;
/** A running import without a heartbeat for this long is taken over by another replica. */
const STALE_MS = 10 * 60_000;
const HEARTBEAT_MS = 30_000;
/** A worker busy for this long logs what it waits on (G5: a pending import sat unclaimed for 30 min, no log line). */
const BUSY_WARN_MS = 5 * 60_000;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 6 * 3_600_000;
/**
 * A download without a single byte for this long fails ("stalled") instead of running on to the 6 h limit with no
 * progress visible (`LOADWEAVER_VM_IMAGE_STALL_SECONDS`; G5: an import sat at 0 bytes for 30 min).
 */
const DEFAULT_STALL_MS = 5 * 60_000;
/** `downloadedBytes` is written about every this many bytes (it was 256 MiB: a 340 MB image showed 0 for long). */
const PROGRESS_STEP_BYTES = 32 * 1024 ** 2;
/** Default cap of a downloaded image (`LOADWEAVER_VM_IMAGE_MAX_BYTES`). */
const DEFAULT_MAX_BYTES = 64 * 1024 ** 3;
const HEADER_BYTES = 4096;

export interface VmImageImportRequest {
  url: string;
  /** Exactly one of `sha256` / `sha512` (Debian and Alpine publish SHA-512 only; 3.42). */
  sha256?: string;
  sha512?: string;
  ref: string;
  arch?: 'amd64' | 'arm64';
  firmware?: ('uefi' | 'bios')[];
  guestAgent?: boolean;
}

export interface VmImageImportDto {
  id: string;
  project: string;
  repository: string;
  tag: string;
  /** Pull reference (with the digest once pushed). */
  reference: string;
  url: string;
  /** The expected checksum: one of the two is set. */
  sha256: string | null;
  sha512: string | null;
  arch: 'amd64' | 'arm64';
  firmware: ('uefi' | 'bios')[];
  guestAgent: boolean;
  status: VmImageImportEntity['status'];
  step: string | null;
  format: 'qcow2' | 'raw' | null;
  containerDisk: boolean;
  downloadedBytes: number;
  virtualSize: number | null;
  digest: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** The URL without credentials / query (what lists and audits show). */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '';
  }
}

export function toVmImageImportDto(row: VmImageImportEntity): VmImageImportDto {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

  return {
    id: row.id,
    project: row.project,
    repository: row.repository,
    tag: row.tag,
    reference: vmImageReference(row.project, row.repository, row.tag, row.digest),
    url: redactUrl(row.url),
    sha256: row.sha256,
    sha512: row.sha512 ?? null,
    arch: row.arch,
    firmware: row.firmware,
    guestAgent: row.guestAgent,
    status: row.status,
    step: row.step,
    format: row.format,
    containerDisk: row.containerDisk,
    downloadedBytes: Number(row.downloadedBytes ?? 0),
    virtualSize: row.virtualSize === null ? null : Number(row.virtualSize),
    digest: row.digest,
    error: row.error,
    requestedBy: row.requestedBy,
    createdAt: new Date(row.createdAt).toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}

/** Validates an import request; throws 400 with the reason. */
export function validateVmImageImport(
  project: string,
  request: VmImageImportRequest,
): {
  repository: string;
  tag: string;
  arch: 'amd64' | 'arm64';
  firmware: ('uefi' | 'bios')[];
  sha256: string | null;
  sha512: string | null;
} {
  const ref = parseVmImageImportRef(project, request.ref ?? '');

  if (!ref) throw new BadRequestException('ref must be <repository>:<tag> in the project (e.g. debian-13:20261017)');

  const checksum = importChecksum(request);

  let url: URL;

  try {
    url = new URL(request.url);
  } catch {
    throw new BadRequestException('url must be an https URL');
  }

  if (url.protocol !== 'https:') throw new BadRequestException('url must be an https URL');

  const arch = request.arch ?? 'amd64';

  if (!VM_IMAGE_ARCHES.includes(arch)) throw new BadRequestException('arch must be amd64 or arm64');

  const firmware = [...new Set(request.firmware?.length ? request.firmware : (['uefi'] as const))];

  if (firmware.some((f) => f !== 'uefi' && f !== 'bios'))
    throw new BadRequestException('firmware values are uefi and bios');

  if (arch !== 'amd64' && firmware.includes('bios')) throw new BadRequestException('bios firmware is amd64 only');

  return { ...ref, arch, firmware, ...checksum };
}

/** The expected checksum of an import: exactly one of `sha256` / `sha512`, lower-case hex without prefix. */
function importChecksum(request: VmImageImportRequest): { sha256: string | null; sha512: string | null } {
  const given = (value: unknown) => typeof value === 'string' && value !== '';

  if (given(request.sha256) === given(request.sha512))
    throw new BadRequestException('give exactly one of sha256 and sha512 (the hex checksum of the file)');

  if (given(request.sha256)) {
    if (!SHA256_HEX_PATTERN.test(request.sha256 as string))
      throw new BadRequestException('sha256 must be the hex SHA-256 of the file');

    return { sha256: (request.sha256 as string).toLowerCase().replace(/^sha256:/, ''), sha512: null };
  }

  if (!SHA512_HEX_PATTERN.test(request.sha512 as string))
    throw new BadRequestException('sha512 must be the hex SHA-512 of the file');

  return { sha256: null, sha512: (request.sha512 as string).toLowerCase().replace(/^sha512:/, '') };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface DownloadResult {
  sha256: string;
  sha512: string;
  bytes: number;
}

/**
 * VM image imports (3.35, `POST /projects/:p/vm-images/import`): a background job in the control plane. The
 * download is SSRF-checked on every redirect hop (HTTPS to public addresses only), the sha256 / sha512 is verified,
 * KubeVirt containerDisk tars are unpacked to their disk, raw disks are compressed with zstd, and the result is pushed
 * into the built-in registry as an OCI VM image artifact. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so one replica
 * runs each import; a replica that dies leaves a stale heartbeat and another one restarts the import.
 */
@Injectable()
export class VmImageImportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VmImageImportService.name);
  private readonly worker = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** What the worker is busy with since when (`claiming` = the claim query itself). */
  private busy: { what: string; since: number } | null = null;
  private busyWarnedAt = 0;
  /** Test seams. */
  fetchImpl: Fetch = (url, init) => fetch(url, init);
  /** No-progress limit of a download (tests shorten it; `LOADWEAVER_VM_IMAGE_STALL_SECONDS` overrides). */
  stallMs = DEFAULT_STALL_MS;
  validateUrl: (url: string) => Promise<unknown> = validateWebhookUrlWithDnsOrThrow;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly registryTokens: RegistryTokenService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env['LOADWEAVER_VM_IMAGE_IMPORTS'] ?? 'on') === 'off' || !shouldRunApiHttp(getQueueRole())) return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------------------------------------- API

  async list(req: RequestWithUser | undefined, project: string): Promise<VmImageImportDto[]> {
    await this.access.assertRead(req, project);

    const rows = await this.dataSource
      .getRepository(VmImageImportEntity)
      .find({ where: { project }, order: { createdAt: 'DESC' }, take: 200 });

    return rows.map(toVmImageImportDto);
  }

  async get(req: RequestWithUser | undefined, project: string, id: string): Promise<VmImageImportDto> {
    const caller = await this.access.caller(req);
    const row = await this.dataSource.getRepository(VmImageImportEntity).findOne({ where: { id, project } });

    if (!row || !canReadProject(caller, project)) throw new NotFoundException('import not found');

    return toVmImageImportDto(row);
  }

  /** Queues an import (operators and admins of the project). */
  async create(
    req: RequestWithUser | undefined,
    project: string,
    request: VmImageImportRequest,
  ): Promise<VmImageImportDto> {
    const caller = await this.access.caller(req);

    if (!canReadProject(caller, project)) throw new NotFoundException('project not found');

    if (!atLeast(projectRole(caller, project), 'operator')) throw new ForbiddenException('operators import VM images');

    const exists = await this.dataSource
      .getRepository(ResourceEntity)
      .exists({ where: { kind: 'Project', name: project } });

    if (!exists) throw new NotFoundException('project not found');

    const valid = validateVmImageImport(project, request);
    const actor = actorFromRequest(req);
    const requestedBy = actor.type === 'api-key' ? 'api-key' : `user:${actor.id ?? 'unknown'}`;

    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(VmImageImportEntity);
      const row = await repo.save(
        repo.create({
          project,
          repository: valid.repository,
          tag: valid.tag,
          url: request.url,
          sha256: valid.sha256,
          sha512: valid.sha512,
          arch: valid.arch,
          firmware: valid.firmware,
          guestAgent: request.guestAgent ?? false,
          status: 'pending',
          step: null,
          format: null,
          containerDisk: false,
          downloadedBytes: '0',
          virtualSize: null,
          digest: null,
          error: null,
          requestedBy,
          worker: null,
          startedAt: null,
          heartbeatAt: null,
          finishedAt: null,
        }),
      );

      await this.audit.record(manager, {
        actor,
        action: 'vm-image.import',
        target: `vm-image/${project}/${valid.repository}:${valid.tag}`,
        project,
        details: {
          import: row.id,
          url: redactUrl(request.url),
          ...(row.sha512 ? { sha512: row.sha512 } : { sha256: row.sha256 }),
          arch: valid.arch,
        },
      });

      return toVmImageImportDto(row);
    });
  }

  // ---------------------------------------------------------------------------------------------- worker

  async safeTick(now = Date.now()): Promise<void> {
    if (writesPaused('VM image imports', this.logger)) return;

    if (this.running) {
      this.warnIfBusy(now);

      return;
    }

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`VM image imports: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
      this.busy = null;
    }
  }

  private warnIfBusy(now: number): void {
    if (!this.busy || now - this.busy.since < BUSY_WARN_MS || now - this.busyWarnedAt < BUSY_WARN_MS) return;

    this.busyWarnedAt = now;
    this.logger.warn(
      `VM image imports: worker busy with ${this.busy.what} for ${Math.round((now - this.busy.since) / 1000)} s; due imports wait`,
    );
  }

  /** Claims and runs one due import; returns its id (null when nothing was due). */
  async tick(now = new Date()): Promise<string | null> {
    // No registry yet (no real member node, or its object store not formed): imports stay queued; the download only
    // starts once there is somewhere to push to (the cluster holds just state / config until then).
    if (!(await this.registryReady())) return null;

    this.busy = { what: 'claiming the next import', since: Date.now() };

    const claimed: unknown = await this.dataSource.query(
      `UPDATE "lw_vm_image_imports" SET "status" = 'running', "worker" = $1, "started_at" = $2, "heartbeat_at" = $2,
              "step" = 'download', "error" = NULL
        WHERE "id" = (
          SELECT "id" FROM "lw_vm_image_imports"
           WHERE "status" = 'pending' OR ("status" = 'running' AND "heartbeat_at" < $3)
           ORDER BY "created_at" LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING "id"`,
      [this.worker, now, new Date(now.getTime() - STALE_MS)],
    );
    // TypeORM answers UPDATE … RETURNING with [rows, affected] (G5: read as rows, every claimed import was left
    // "running" without a worker until it went stale, and claimed again the same way).
    const rows = (Array.isArray(claimed) && Array.isArray(claimed[0]) ? claimed[0] : claimed) as { id: string }[];
    const id = rows[0]?.id;

    if (!id) return null;

    this.busy = { what: `import ${id}`, since: Date.now() };

    const row = await this.dataSource.getRepository(VmImageImportEntity).findOneOrFail({ where: { id } });

    this.logger.log(`VM image import ${id} claimed (${row.project}/${row.repository}:${row.tag})`);

    await this.run(row);

    return id;
  }

  private async update(id: string, patch: Partial<VmImageImportEntity>): Promise<void> {
    if (patch.step && this.busy) this.busy = { ...this.busy, what: `import ${id} (${patch.step})` };

    await this.dataSource
      .getRepository(VmImageImportEntity)
      .update({ id, worker: this.worker }, { ...patch, heartbeatAt: new Date() });
  }

  /** Runs one import to its end (succeeded / failed). */
  async run(row: VmImageImportEntity): Promise<void> {
    const dir = await mkdtemp(join(process.env['LOADWEAVER_VM_IMAGE_WORKDIR'] || tmpdir(), 'lw-vm-image-'));
    const beat = setInterval(() => void this.update(row.id, {}).catch(() => undefined), HEARTBEAT_MS);

    beat.unref?.();

    try {
      const downloaded = join(dir, 'download');
      const { sha256, sha512, bytes } = await this.download(row, downloaded);

      await this.update(row.id, { step: 'verify', downloadedBytes: String(bytes) });

      if (row.sha512) {
        if (sha512 !== row.sha512) throw new Error(`sha512 mismatch: expected ${row.sha512}, got ${sha512}`);
      } else if (sha256 !== row.sha256) throw new Error(`sha256 mismatch: expected ${row.sha256}, got ${sha256}`);

      await this.update(row.id, { step: 'convert' });

      const disk = await this.unpack(downloaded, dir);
      const layer =
        disk.format === 'raw'
          ? await this.compressRaw(disk.path, join(dir, 'disk.raw.zst'))
          : await fileDigest(disk.path);
      const layerPath = disk.format === 'raw' ? join(dir, 'disk.raw.zst') : disk.path;
      const config = vmImageConfigBlob({
        arch: row.arch,
        format: disk.format,
        virtualSize: disk.virtualSize,
        firmware: row.firmware,
        ...(row.guestAgent ? { guestAgent: true } : {}),
      });
      const manifest = vmImageManifest(
        config.descriptor,
        vmImageLayerDescriptor(disk.format, layer.digest, layer.size, vmImageLayerTitle(disk.format)),
        { 'org.opencontainers.image.source': redactUrl(row.url) },
      );

      await this.update(row.id, {
        step: 'push',
        format: disk.format,
        containerDisk: disk.containerDisk,
        virtualSize: String(disk.virtualSize),
      });

      const repository = `${row.project}/${row.repository}`;
      const endpoint = await this.registry(repository);

      await pushBlob(endpoint, repository, config.descriptor.digest, config.data.length, config.data);
      await pushBlob(endpoint, repository, layer.digest, layer.size, createReadStream(layerPath));
      await pushManifest(endpoint, repository, row.tag, OCI_MANIFEST_MEDIA_TYPE, manifest.data);
      await this.finish(row, { status: 'succeeded', digest: manifest.digest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`VM image import ${row.id} failed: ${message}`);
      await this.finish(row, { status: 'failed', error: message.slice(0, 2000) });
    } finally {
      clearInterval(beat);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async finish(
    row: VmImageImportEntity,
    result: { status: 'succeeded'; digest: string } | { status: 'failed'; error: string },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(VmImageImportEntity)
        .update(
          { id: row.id, worker: this.worker },
          { ...result, step: null, finishedAt: new Date(), heartbeatAt: new Date() },
        );
      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: result.status === 'succeeded' ? 'vm-image.imported' : 'vm-image.import-failed',
        target: `vm-image/${row.project}/${row.repository}:${row.tag}`,
        project: row.project,
        details: { import: row.id, ...result },
      });
    });
  }

  /** Downloads with the SSRF check on every hop; returns the file's sha256 / sha512 (hex) and size. */
  private async download(row: VmImageImportEntity, path: string): Promise<DownloadResult> {
    const maxBytes = Number(process.env['LOADWEAVER_VM_IMAGE_MAX_BYTES'] ?? DEFAULT_MAX_BYTES);
    const stallSeconds = Number(process.env['LOADWEAVER_VM_IMAGE_STALL_SECONDS']);
    const stallMs = Number.isFinite(stallSeconds) && stallSeconds > 0 ? stallSeconds * 1000 : this.stallMs;
    // One controller for the whole download: the overall limit, and the stall watchdog below (no byte for stallMs).
    const controller = new AbortController();
    const overall = setTimeout(() => controller.abort(new Error('download took longer than 6 h')), DOWNLOAD_TIMEOUT_MS);
    // What the download waits on (named in a stall): the per-hop address check, the response, or its data.
    const phase = { current: 'starting' };
    let stall: NodeJS.Timeout | undefined;
    const watch = () => {
      if (stall) clearTimeout(stall);

      stall = setTimeout(
        () =>
          controller.abort(
            new Error(`download stalled: no progress for ${Math.round(stallMs / 1000)} s (${phase.current})`),
          ),
        stallMs,
      );
    };
    // The abort ends the download wherever it waits — also in the address check, which takes no signal (a hung
    // `run()` kept its heartbeat and the import stayed "running" for good; G5).
    const aborted = new Promise<never>((_resolve, reject) =>
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }),
    );

    aborted.catch(() => undefined);

    try {
      watch();

      return await Promise.race([this.downloadWithin(row, path, maxBytes, controller.signal, watch, phase), aborted]);
    } catch (error) {
      throw controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error;
    } finally {
      clearTimeout(overall);

      if (stall) clearTimeout(stall);
    }
  }

  private async downloadWithin(
    row: VmImageImportEntity,
    path: string,
    maxBytes: number,
    signal: AbortSignal,
    progressed: () => void,
    phase: { current: string },
  ): Promise<DownloadResult> {
    let url = row.url;
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (new URL(url).protocol !== 'https:') throw new Error('downloads must use https');

      phase.current = `checking the address of ${new URL(url).host}`;
      await this.validateUrl(url);
      phase.current = `waiting for ${new URL(url).host}`;
      response = await this.fetchImpl(url, { redirect: 'manual', signal });
      progressed();

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        if (!location) throw new Error(`redirect without a location (${response.status})`);

        url = new URL(location, url).toString();
        response = null;
        continue;
      }

      break;
    }

    if (!response) throw new Error('too many redirects');

    if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);

    const length = Number(response.headers.get('content-length') ?? 0);

    if (length > maxBytes) throw new Error(`the image is larger than the limit of ${maxBytes} bytes`);

    phase.current = 'receiving';

    const hash = createHash('sha256');
    const hash512 = createHash('sha512');
    let bytes = 0;
    let reported = 0;
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        bytes += chunk.length;
        progressed();

        if (bytes > maxBytes) return callback(new Error(`the image is larger than the limit of ${maxBytes} bytes`));

        hash.update(chunk);
        hash512.update(chunk);

        if (bytes - reported > PROGRESS_STEP_BYTES) {
          reported = bytes;
          void this.update(row.id, { downloadedBytes: String(bytes) }).catch(() => undefined);
        }

        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(path),
      { signal },
    );

    return { sha256: hash.digest('hex'), sha512: hash512.digest('hex'), bytes };
  }

  /**
   * The disk inside the download: qcow2 / raw as is, gzip decompressed first, a KubeVirt containerDisk tar unpacked
   * to its `/disk/*.qcow2|*.img`. zstd-compressed sources are refused (decompress them before the import).
   */
  async unpack(
    path: string,
    dir: string,
    depth = 0,
  ): Promise<{ path: string; format: VmImageFormat; virtualSize: number; containerDisk: boolean }> {
    const header = await readHeader(path);
    const detected = detectDiskFormat(header);

    if (detected === 'qcow2') {
      const virtualSize = qcow2VirtualSize(header);

      if (!virtualSize) throw new Error('the qcow2 header has no virtual size');

      return { path, format: 'qcow2', virtualSize, containerDisk: false };
    }

    if (detected === 'zstd') throw new Error('zstd-compressed sources are not supported; upload the plain disk');

    if (depth > 1) throw new Error('nested archives are not supported');

    if (detected === 'gzip') {
      const out = join(dir, `gunzip-${depth}`);

      await pipeline(createReadStream(path), zlib.createGunzip(), createWriteStream(out));

      return await this.unpack(out, dir, depth + 1);
    }

    if (detected === 'tar') {
      const out = join(dir, `container-disk-${depth}`);
      let found = false;

      for await (const entry of readTar(createReadStream(path))) {
        if (!found && entry.type === 'file' && containerDiskFormat(`/${entry.name}`)) {
          await pipeline(Readable.from(entry.body), createWriteStream(out));
          found = true;
          continue;
        }

        for await (const _ of entry.body) void _;
      }

      if (!found) throw new Error('the tar archive has no /disk/*.qcow2 or /disk/*.img (not a KubeVirt containerDisk)');

      return { ...(await this.unpack(out, dir, depth + 1)), containerDisk: true };
    }

    const size = (await stat(path)).size;

    if (size === 0) throw new Error('the image is empty');

    return { path, format: 'raw', virtualSize: size, containerDisk: false };
  }

  private async compressRaw(path: string, out: string): Promise<{ digest: string; size: number }> {
    const createZstd = (zlib as unknown as { createZstdCompress?: () => Transform }).createZstdCompress;

    if (!createZstd) throw new Error('raw images need zstd support in the control plane (Node.js 22.15 or newer)');

    await pipeline(createReadStream(path), createZstd(), createWriteStream(out));

    return await fileDigest(out);
  }

  /** Whether a registry can take pushes: an active object-store generation and a connected control-plane member. */
  protected async registryReady(): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM "lw_object_store_generations" WHERE "state" = 'active'
          AND EXISTS (SELECT 1 FROM "lw_nodes" WHERE "control_plane" AND "connected" AND "lifecycle" <> 'left')
        LIMIT 1`,
    )) as unknown[];

    return rows.length > 0;
  }

  /** The registry on a connected control-plane member, with a push token for the repository. */
  private async registry(repository: string): Promise<RegistryEndpoint> {
    const members = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, lifecycle: Not('left'), connected: true }, order: { name: 'ASC' } });
    const host = members.map((n) => nodeAddress(n)).find((a): a is string => !!a);

    if (!host) throw new Error('no registry member reachable');

    const token = await this.registryTokens.issue(
      'control-plane:vm-images',
      [{ name: repository, actions: ['pull', 'push'] }],
      3600,
    );

    return { host, port: REGISTRY_PRIVATE_PORT, token };
  }
}

async function readHeader(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');

  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function fileDigest(path: string): Promise<{ digest: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }

  return { digest: `sha256:${hash.digest('hex')}`, size };
}
