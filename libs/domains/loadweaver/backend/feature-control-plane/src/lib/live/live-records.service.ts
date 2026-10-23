import type { RequestWithUser } from '@forepath/identity/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ResourceStoreService } from '../services/resource-store.service';

const SWEEP_MS = 3_600_000;
const ORPHANS_MS = 60_000;
/** Open sessions and tunnels whose replica stopped its heartbeat (crashed) this long ago are closed. */
const ORPHANED_AFTER = '5 minutes';
const ADVISORY_LOCK_RECORDINGS = 0x4c57001a;

export interface TerminalSessionDto {
  id: string;
  userId: string | null;
  project: string | null;
  target: string;
  node: string;
  recorded: boolean;
  hasRecording: boolean;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface TunnelDto {
  id: string;
  userId: string | null;
  project: string;
  replica: string;
  node: string;
  port: number;
  openedAt: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  user_id: string | null;
  project: string | null;
  target: string;
  node: string;
  recorded: boolean;
  recording_key: string | null;
  exit_code: number | null;
  started_at: Date;
  ended_at: Date | null;
}

/** Sessions are audit data: auditors and cluster admins all, project admins their projects (3.18). */
function mayReadSessions(caller: AccessCaller, project: string | null): boolean {
  if (caller.clusterRole === 'cluster-admin' || caller.clusterRole === 'auditor') return true;

  return !!project && projectRole(caller, project) === 'admin';
}

/**
 * Terminal sessions and debug tunnels as records (3.19): who, where, when, exit code, recordings to download;
 * open tunnels for the map's temporary operator edges; recordings deleted after the cluster's retention.
 */
@Injectable()
export class LiveRecordsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LiveRecordsService.name);
  private timer: NodeJS.Timeout | null = null;
  private orphanTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly files: FileStorageService,
    private readonly resources: ResourceStoreService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.sweep().catch((e) => this.logger.warn(`Recording retention: ${String(e)}`)),
      SWEEP_MS,
    );
    this.orphanTimer = setInterval(
      () => void this.closeOrphans().catch((e) => this.logger.warn(`Orphaned live sessions: ${String(e)}`)),
      ORPHANS_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);

    if (this.orphanTimer) clearInterval(this.orphanTimer);
  }

  /**
   * Sessions and tunnels of a replica that crashed stay open in the records: closed at their last heartbeat. (Their
   * in-memory recordings are lost; the node ends the sessions itself when the stream drops.)
   */
  async closeOrphans(): Promise<number> {
    const [, sessions] = await this.dataSource.query(
      `UPDATE lw_terminal_sessions SET ended_at = seen_at WHERE ended_at IS NULL AND seen_at < now() - INTERVAL '${ORPHANED_AFTER}'`,
    );
    const [, tunnels] = await this.dataSource.query(
      `UPDATE lw_tunnels SET closed_at = seen_at WHERE closed_at IS NULL AND seen_at < now() - INTERVAL '${ORPHANED_AFTER}'`,
    );

    return Number(sessions ?? 0) + Number(tunnels ?? 0);
  }

  async sessions(req: RequestWithUser | undefined, project?: string): Promise<TerminalSessionDto[]> {
    const caller = await this.access.caller(req);
    const all = caller.clusterRole === 'cluster-admin' || caller.clusterRole === 'auditor';
    // Filtered before the limit, so project admins see their sessions however many others there are.
    const projects = all
      ? null
      : [...caller.projects.keys()].filter((p) => mayReadSessions(caller, p) && (!project || p === project));

    if (projects?.length === 0) return [];

    const rows: SessionRow[] = await this.dataSource.query(
      `SELECT * FROM lw_terminal_sessions WHERE ($1::varchar IS NULL OR project = $1) AND ($2::varchar[] IS NULL OR project = ANY($2))
         ORDER BY started_at DESC LIMIT 1000`,
      [project ?? null, projects],
    );

    return rows
      .filter((r) => mayReadSessions(caller, r.project))
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        project: r.project,
        target: r.target,
        node: r.node,
        recorded: r.recorded,
        hasRecording: !!r.recording_key,
        exitCode: r.exit_code,
        startedAt: new Date(r.started_at).toISOString(),
        endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      }));
  }

  /** An asciicast v2 file (`.cast`). */
  async recording(req: RequestWithUser | undefined, id: string): Promise<Buffer> {
    const caller = await this.access.caller(req);
    const [row]: SessionRow[] = await this.dataSource.query(`SELECT * FROM lw_terminal_sessions WHERE id = $1`, [id]);

    if (!row || !mayReadSessions(caller, row.project) || !row.recording_key)
      throw new NotFoundException('recording not found');

    return await this.files.readFile(FileStorageScope.loadweaverRecordings, row.recording_key);
  }

  /** Open tunnels the caller may see (the map's temporary operator edges). */
  async tunnels(req: RequestWithUser | undefined): Promise<TunnelDto[]> {
    const caller = await this.access.caller(req);
    const rows: {
      id: string;
      user_id: string | null;
      project: string;
      replica: string;
      node: string;
      port: number;
      opened_at: Date;
      expires_at: Date;
    }[] = await this.dataSource.query(
      `SELECT * FROM lw_tunnels WHERE closed_at IS NULL AND expires_at > now() ORDER BY opened_at DESC LIMIT 1000`,
    );

    return rows
      .filter((r) => canReadProject(caller, r.project))
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        project: r.project,
        replica: r.replica,
        node: r.node,
        port: r.port,
        openedAt: new Date(r.opened_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
      }));
  }

  /** Deletes recordings past the retention, on one replica at a time. */
  async sweep(): Promise<number> {
    return await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_RECORDINGS,
      ]);

      if (!locked) return 0;

      const days = (await this.resources.clusterSpec()).terminalRecordingRetentionDays;
      const old: { id: string; recording_key: string }[] = await manager.query(
        `SELECT id, recording_key FROM lw_terminal_sessions WHERE recording_key IS NOT NULL AND started_at < now() - $1 * INTERVAL '1 day' LIMIT 1000`,
        [days],
      );

      for (const r of old) {
        await this.files.deleteFile(FileStorageScope.loadweaverRecordings, r.recording_key);
        await manager.query(`UPDATE lw_terminal_sessions SET recording_key = NULL WHERE id = $1`, [r.id]);
      }

      return old.length;
    });
  }
}
