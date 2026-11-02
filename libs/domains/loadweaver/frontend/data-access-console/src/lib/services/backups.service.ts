import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  Backup,
  BackupCatalogQuery,
  BackupDeletion,
  BackupDeletionAction,
  BackupDiff,
  BackupFileEntry,
  BackupKeyGeneration,
  BackupRestore,
  BackupsStatus,
  DrInfoDocument,
  KitShare,
  KitSize,
  PlatformBackupKind,
  PlatformBackupRunResult,
  PlatformBackupStatus,
  PlatformCopyRunResult,
  PlatformCutover,
  PlatformCutoverAction,
  PlatformOpensearchRestoreRequest,
  PlatformRestore,
  PlatformRestoreRequest,
  RestoreTest,
} from '../types/backups.types';
import { ConsoleApi } from './console-api';

/**
 * Backups (3.20): status, catalog, file browsing / download and diff, "back up now", restore tests, restores,
 * deletion requests and the backup key / recovery kit (cluster admins). The API scopes everything to the caller;
 * restores themselves are `Restore` resources created through plans (`PlansService`). Plus the control-plane
 * ("platform") backups: Postgres PITR restores and the cut-over, external copies and the DR info document (M6).
 */
@Injectable({ providedIn: 'root' })
export class BackupsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  status(): Observable<BackupsStatus> {
    return this.http.get<BackupsStatus>(this.url('/backups/status'));
  }

  /** Newest first. */
  catalog(query: BackupCatalogQuery = {}): Observable<Backup[]> {
    let params = new HttpParams();

    if (query.project) params = params.set('project', query.project);

    if (query.resource) params = params.set('resource', query.resource);

    if (query.includeDeleted) params = params.set('includeDeleted', 'true');

    if (query.limit) params = params.set('limit', String(query.limit));

    return this.http.get<Backup[]>(this.url('/backups'), { params });
  }

  get(id: string): Observable<Backup> {
    return this.http.get<Backup>(this.url(`/backups/${encodeURIComponent(id)}`));
  }

  /** A directory of the backup (`path` relative to the volume root; empty = the root). */
  files(id: string, path = ''): Observable<BackupFileEntry[]> {
    const params = path ? new HttpParams().set('path', path) : new HttpParams();

    return this.http.get<BackupFileEntry[]>(this.url(`/backups/${encodeURIComponent(id)}/files`), { params });
  }

  /** One file of the backup (audited). */
  download(id: string, path: string): Observable<Blob> {
    return this.http.get(this.url(`/backups/${encodeURIComponent(id)}/download`), {
      params: new HttpParams().set('path', path),
      responseType: 'blob',
    });
  }

  /** Changed files from `from` to `to` (two backups of the same volume). */
  diff(from: string, to: string): Observable<BackupDiff> {
    return this.http.get<BackupDiff>(this.url('/backups/diff'), {
      params: new HttpParams().set('from', from).set('to', to),
    });
  }

  /** Starts a backup of one volume now (project operators). */
  backupNow(volume: string): Observable<Backup> {
    return this.http.post<Backup>(this.url('/backups/now'), { volume });
  }

  /** Starts a restore test of one backup now (project operators). */
  restoreTest(id: string): Observable<RestoreTest> {
    return this.http.post<RestoreTest>(this.url(`/backups/${encodeURIComponent(id)}/restore-test`), {});
  }

  restoreTests(query: { project?: string | null; resource?: string | null } = {}): Observable<RestoreTest[]> {
    let params = new HttpParams();

    if (query.project) params = params.set('project', query.project);

    if (query.resource) params = params.set('resource', query.resource);

    return this.http.get<RestoreTest[]>(this.url('/backups/restore-tests'), { params });
  }

  restores(project?: string | null): Observable<BackupRestore[]> {
    const params = project ? new HttpParams().set('project', project) : new HttpParams();

    return this.http.get<BackupRestore[]>(this.url('/backups/restores'), { params });
  }

  deletions(): Observable<BackupDeletion[]> {
    return this.http.get<BackupDeletion[]>(this.url('/backups/deletions'));
  }

  /** Admins request; a second admin approves; it takes effect after the delay. */
  requestDeletion(backupIds: string[], reason: string): Observable<BackupDeletion> {
    return this.http.post<BackupDeletion>(this.url('/backups/deletions'), { backupIds, reason });
  }

  actOnDeletion(id: string, action: BackupDeletionAction): Observable<BackupDeletion> {
    return this.http.post<BackupDeletion>(this.url(`/backups/deletions/${encodeURIComponent(id)}/${action}`), {});
  }

  keys(): Observable<BackupKeyGeneration[]> {
    return this.http.get<BackupKeyGeneration[]>(this.url('/backups/keys'));
  }

  /** A new key generation (with a new kit); without a size the cluster's default applies. */
  rotateKey(kit?: KitSize): Observable<BackupKeyGeneration> {
    return this.http.post<BackupKeyGeneration>(this.url('/backups/keys/rotate'), kit ?? {});
  }

  /** A new kit for a generation (the old shares stop counting). */
  reissueKit(generation: number, kit: KitSize): Observable<BackupKeyGeneration> {
    return this.http.post<BackupKeyGeneration>(this.url(`/backups/keys/${generation}/kit`), kit);
  }

  /** Hands out one share, exactly once. */
  downloadShare(generation: number, index: number): Observable<KitShare> {
    return this.http.post<KitShare>(this.url(`/backups/keys/${generation}/kit/shares/${index}`), {});
  }

  /** Confirms the kit by pasting enough shares back (400 with a message on wrong / too few shares). */
  confirmKit(generation: number, shares: string[]): Observable<{ confirmed: true }> {
    return this.http.post<{ confirmed: true }>(this.url(`/backups/keys/${generation}/kit/confirm`), { shares });
  }

  /** Escrows the generation's key in the configured KMS. */
  escrow(generation: number): Observable<BackupKeyGeneration> {
    return this.http.post<BackupKeyGeneration>(this.url(`/backups/keys/${generation}/escrow`), {});
  }

  /** Control-plane backups: per kind, PITR window, restores, external copies, pins. */
  platformStatus(): Observable<PlatformBackupStatus> {
    return this.http.get<PlatformBackupStatus>(this.url('/backups/platform'));
  }

  /** Backs up one platform kind now (cluster admins). */
  runPlatformBackup(kind: PlatformBackupKind): Observable<PlatformBackupRunResult> {
    return this.http.post<PlatformBackupRunResult>(this.url(`/backups/platform/${kind}/run`), {});
  }

  platformRestores(): Observable<PlatformRestore[]> {
    return this.http.get<PlatformRestore[]>(this.url('/backups/platform/postgres/restores'));
  }

  /** A point-in-time restore of the control-plane Postgres into its own scope (the live database stays untouched). */
  requestPlatformRestore(request: PlatformRestoreRequest = {}): Observable<PlatformRestore> {
    const body: PlatformRestoreRequest = {};

    if (request.targetTime) body.targetTime = request.targetTime;

    if (request.node) body.node = request.node;

    return this.http.post<PlatformRestore>(this.url('/backups/platform/postgres/restores'), body);
  }

  discardPlatformRestore(id: string): Observable<PlatformRestore> {
    return this.http.delete<PlatformRestore>(this.url(`/backups/platform/postgres/restores/${encodeURIComponent(id)}`));
  }

  /** Plans switching the control-plane database to a ready restore (409 with a message when refused). */
  planPlatformCutover(restoreId: string): Observable<PlatformCutover> {
    return this.http.post<PlatformCutover>(
      this.url(`/backups/platform/postgres/restores/${encodeURIComponent(restoreId)}/cutover`),
      {},
    );
  }

  /** Newest first. */
  platformCutovers(): Observable<PlatformCutover[]> {
    return this.http.get<PlatformCutover[]>(this.url('/backups/platform/cutovers'));
  }

  /** A second cluster admin approves (403 for the requester); planned / approved cut-overs can be cancelled. */
  actOnPlatformCutover(id: string, action: PlatformCutoverAction): Observable<PlatformCutover> {
    return this.http.post<PlatformCutover>(
      this.url(`/backups/platform/cutovers/${encodeURIComponent(id)}/${action}`),
      {},
    );
  }

  /** Copies the platform backups to every external target now. */
  runPlatformCopies(): Observable<PlatformCopyRunResult[]> {
    return this.http.post<PlatformCopyRunResult[]>(this.url('/backups/platform/copies/run'), {});
  }

  /** The DR info document `loadweaver-agent bootstrap --restore --dr-info` reads (no secrets). */
  drInfo(): Observable<DrInfoDocument> {
    return this.http.get<DrInfoDocument>(this.url('/backups/platform/dr-info'));
  }

  /** An etcd snapshot as a file. */
  downloadEtcdSnapshot(name: string): Observable<Blob> {
    return this.http.get(this.url(`/backups/platform/etcd/${encodeURIComponent(name)}`), { responseType: 'blob' });
  }

  /** Restores indices of an OpenSearch snapshot (optionally renamed). */
  restoreOpensearch(request: PlatformOpensearchRestoreRequest): Observable<unknown> {
    return this.http.post<unknown>(this.url('/backups/platform/opensearch/restore'), request);
  }
}
