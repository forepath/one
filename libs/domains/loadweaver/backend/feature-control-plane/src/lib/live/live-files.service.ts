import type { RequestWithUser } from '@forepath/identity/backend';
import {
  LIVE_CHUNK_BYTES,
  type FileEntry,
  type FileRequest,
  type FileResponse,
  type FileTarget,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';

import { MetricsStore } from '../metrics/metrics.store';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { LiveAccessService, type LiveTarget } from './live-access.service';
import { LiveBroker } from './live-broker';

const TIMEOUT_MS = 30_000;
/** Downloads and uploads stop at 100 MB (Agenstra's file API). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type FileTargetRef = `replica:${string}` | `volume:${string}`;

/** `replica:shop/site/web/0` / `volume:shop/site/data` → the node-side target. */
export function parseFileTarget(ref: string): FileTarget {
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];

  if (kind === 'replica' && /^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,4}$/.test(id))
    return { kind: 'replica', replica: id };

  if (kind === 'volume' && /^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/.test(id))
    return { kind: 'volume', volume: id };

  throw new BadRequestException('invalid target');
}

/** Paths as the browser sends them: absolute, no NUL / control characters. */
export function normalizeLivePath(path: string | undefined): string {
  const p = `/${(path ?? '').replace(/^\/+/, '')}`;

  // eslint-disable-next-line no-control-regex -- control characters are rejected
  if (p.length > 4096 || /[\x00-\x1f]/.test(p)) throw new BadRequestException('invalid path');

  return p;
}

/** `bytes=start-end` within `size`; null without a header, `unsatisfiable` outside. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  if (!match || (!match[1] && !match[2])) return 'unsatisfiable';

  let start: number;
  let end: number;

  if (!match[1]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }

  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

/** `bytes start-end/total` of an upload chunk. */
export function parseContentRange(header: string): { start: number; end: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header.trim());

  if (!match) return null;

  const [start, end, total] = match.slice(1).map(Number);

  return start <= end && end < total ? { start, end, total } : null;
}

const ERRORS: Record<string, (message: string) => Error> = {
  'not-found': (m) => new NotFoundException(m),
  exists: (m) => new ConflictException(m),
  denied: (m) => new ForbiddenException(m),
  'too-large': (m) => new PayloadTooLargeException(m),
};

/**
 * The file browser's backend (3.19), Agenstra's file API over the node stream: listings, ranged reads, chunked
 * uploads, create / delete / move / copy in a replica's filesystem or a volume on its primary node. Writes are
 * audited; container-filesystem writes are marked as lost on restart / migration and recorded as drift events.
 */
@Injectable()
export class LiveFilesService {
  constructor(
    private readonly broker: LiveBroker,
    private readonly access: LiveAccessService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsStore,
  ) {}

  async resolve(req: RequestWithUser | undefined, ref: string): Promise<{ target: FileTarget; live: LiveTarget }> {
    const target = parseFileTarget(ref);
    const live =
      target.kind === 'replica'
        ? await this.access.replica(req, target.replica, 'files')
        : await this.access.volume(req, target.volume);

    return { target, live };
  }

  /** One request to the node, answered on its own channel. */
  async request(node: string, request: FileRequest): Promise<FileResponse> {
    return await new Promise<FileResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.broker.closeChannel(channel);
        reject(new GatewayTimeoutException('the node did not answer'));
      }, TIMEOUT_MS);
      const channel = this.broker.openChannel((type, payload) => {
        if (type !== 'fileResponse') return;

        clearTimeout(timer);
        this.broker.closeChannel(channel);
        resolve(payload as unknown as FileResponse);
      });

      this.broker
        .send(node, channel, 'fileRequest', request as unknown as Record<string, unknown>)
        .catch((error: unknown) => {
          clearTimeout(timer);
          this.broker.closeChannel(channel);
          reject(new GatewayTimeoutException(error instanceof Error ? error.message : 'node not reachable'));
        });
    });
  }

  private async ok(node: string, request: FileRequest): Promise<FileResponse> {
    const response = await this.request(node, request);

    if (!response.ok) {
      const code = response.error?.code ?? 'failed';

      throw (ERRORS[code] ?? ((m: string) => new BadRequestException(m)))(response.error?.message ?? 'failed');
    }

    return response;
  }

  async list(req: RequestWithUser | undefined, ref: string, path: string): Promise<FileEntry[]> {
    const { target, live } = await this.resolve(req, ref);

    return (await this.ok(live.node, { op: 'list', target, path: normalizeLivePath(path) })).entries ?? [];
  }

  async stat(req: RequestWithUser | undefined, ref: string, path: string): Promise<FileEntry> {
    const { target, live } = await this.resolve(req, ref);
    const entry = (await this.ok(live.node, { op: 'stat', target, path: normalizeLivePath(path) })).entry;

    if (!entry) throw new NotFoundException('no such file');

    return entry;
  }

  /** Bytes `start`–`end` of a file, read in chunks over the stream. */
  async read(req: RequestWithUser | undefined, ref: string, path: string, start: number, end: number): Promise<Buffer> {
    const { target, live } = await this.resolve(req, ref);

    if (end - start + 1 > MAX_FILE_BYTES) throw new PayloadTooLargeException('at most 100 MB at a time');

    const chunks: Buffer[] = [];

    for (let offset = start; offset <= end; ) {
      const length = Math.min(LIVE_CHUNK_BYTES, end - offset + 1);
      const data = Buffer.from(
        (await this.ok(live.node, { op: 'read', target, path: normalizeLivePath(path), offset, length })).data ?? '',
        'base64',
      );

      chunks.push(data);

      if (data.length < length) break;

      offset += data.length;
    }

    return Buffer.concat(chunks);
  }

  private async recordWrite(
    req: RequestWithUser | undefined,
    live: LiveTarget,
    action: string,
    details: Record<string, unknown>,
  ): Promise<string | null> {
    await this.audit.recordStandalone({
      actor: actorFromRequest(req),
      action: `files.${action}`,
      target: live.target,
      project: live.project,
      details,
    });

    if (!live.target.startsWith('replica/')) return null;

    // The container layer isn't persistent: a drift-like event (3.8) and a warning for the client.
    await this.metrics.event(
      'drift',
      `${action} in the filesystem of ${live.target.slice('replica/'.length)} (lost on restart / migration)`,
      {
        entity: live.target,
        ...(live.project ? { project: live.project } : {}),
        data: details,
      },
    );

    return 'Changes in a container filesystem are lost on restart or migration';
  }

  /**
   * A whole file (≤ 10 MB in one request) or one sequential chunk of an upload (`Content-Range`). Chunks go to a
   * temporary file next to the target, so any replica can take the next one (the expected offset is its size) and an
   * interrupted upload leaves the existing file alone; the last chunk renames it over the target.
   */
  async write(
    req: RequestWithUser | undefined,
    ref: string,
    path: string,
    body: Buffer,
    contentRange?: string,
    uploadId?: string,
  ): Promise<{ complete: boolean; warning: string | null }> {
    const { target, live } = await this.resolve(req, ref);
    const p = normalizeLivePath(path);

    if (!contentRange) {
      if (body.length > 10 * 1024 * 1024)
        throw new PayloadTooLargeException('more than 10 MB: upload in chunks with Content-Range');

      await this.writeChunks(live.node, target, p, 0, body);

      return { complete: true, warning: await this.recordWrite(req, live, 'write', { path: p, bytes: body.length }) };
    }

    const range = parseContentRange(contentRange);

    if (!range || range.end - range.start + 1 !== body.length) throw new BadRequestException('invalid Content-Range');

    if (range.total > MAX_FILE_BYTES) throw new PayloadTooLargeException('at most 100 MB');

    if (p === '/') throw new BadRequestException('invalid path');

    const name = p.slice(p.lastIndexOf('/') + 1);
    const temp = `${p.slice(0, p.lastIndexOf('/') + 1)}.${name.slice(0, 180)}.lw-upload-${uploadId ?? 'default'}`;

    if (range.start > 0) {
      const existing = await this.request(live.node, { op: 'stat', target, path: temp });

      if (!existing.ok || existing.entry?.size !== range.start)
        throw new BadRequestException(`expected start ${existing.ok ? (existing.entry?.size ?? 0) : 0}`);
    } else {
      // Audited when it starts, so unfinished uploads are on record too.
      await this.audit.recordStandalone({
        actor: actorFromRequest(req),
        action: 'files.upload',
        target: live.target,
        project: live.project,
        details: { path: p, bytes: range.total },
      });
    }

    await this.writeChunks(live.node, target, temp, range.start, body);

    if (range.end + 1 < range.total) {
      return {
        complete: false,
        warning: live.target.startsWith('replica/')
          ? 'Changes in a container filesystem are lost on restart or migration'
          : null,
      };
    }

    await this.ok(live.node, { op: 'move', target, path: temp, to: p, overwrite: true });

    return { complete: true, warning: await this.recordWrite(req, live, 'write', { path: p, bytes: range.total }) };
  }

  private async writeChunks(
    node: string,
    target: FileTarget,
    path: string,
    start: number,
    body: Buffer,
  ): Promise<void> {
    for (let offset = 0; offset < body.length || (offset === 0 && body.length === 0); offset += LIVE_CHUNK_BYTES) {
      await this.ok(node, {
        op: 'write',
        target,
        path,
        offset: start + offset,
        data: body.subarray(offset, offset + LIVE_CHUNK_BYTES).toString('base64'),
        truncate: start + offset === 0,
      });

      if (body.length === 0) break;
    }
  }

  async create(
    req: RequestWithUser | undefined,
    ref: string,
    path: string,
    type: 'file' | 'directory',
  ): Promise<string | null> {
    const { target, live } = await this.resolve(req, ref);
    const p = normalizeLivePath(path);

    if (type === 'directory') await this.ok(live.node, { op: 'mkdir', target, path: p });
    else {
      const existing = await this.request(live.node, { op: 'stat', target, path: p });

      if (existing.ok) throw new ConflictException('already exists');

      await this.ok(live.node, { op: 'write', target, path: p, offset: 0, data: '', truncate: true });
    }

    return await this.recordWrite(req, live, 'create', { path: p, type });
  }

  async remove(req: RequestWithUser | undefined, ref: string, path: string): Promise<string | null> {
    const { target, live } = await this.resolve(req, ref);
    const p = normalizeLivePath(path);

    await this.ok(live.node, { op: 'delete', target, path: p });

    return await this.recordWrite(req, live, 'delete', { path: p });
  }

  async move(
    req: RequestWithUser | undefined,
    ref: string,
    path: string,
    destination: string,
    overwrite: boolean,
    op: 'move' | 'copy',
  ): Promise<string | null> {
    const { target, live } = await this.resolve(req, ref);
    const from = normalizeLivePath(path);
    const to = normalizeLivePath(destination);

    await this.ok(live.node, { op, target, path: from, to, overwrite });

    return await this.recordWrite(req, live, op, { path: from, to, overwrite });
  }
}
