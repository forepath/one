import { HttpClient, HttpHeaders, HttpParams, HttpRequest, type HttpEvent } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, switchMap, type Observable } from 'rxjs';

import type {
  CreateRolloutRequest,
  Rollout,
  RolloutAction,
  UpdateRelease,
  UpdatesStatus,
} from '../types/updates.types';
import { sha256OfBlob } from '../utils/sha256';
import { ConsoleApi } from './console-api';

/** Declared SHA-256 (hex) of an uploaded bundle; the cluster checks it and the length after receipt. */
export const CONTENT_SHA256_HEADER = 'X-Loadweaver-Content-SHA256';

/**
 * Updates (3.26): cluster / node versions, releases and bundles, update plans and their rollout. Reading needs a
 * cluster role; downloads, uploads, planning and every rollout action are for cluster admins (the API decides).
 * Maintenance windows and the update policy are resources (`ResourcesService`).
 */
@Injectable({ providedIn: 'root' })
export class UpdatesService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  status(): Observable<UpdatesStatus> {
    return this.http.get<UpdatesStatus>(this.url('/updates/status'));
  }

  releases(): Observable<UpdateRelease[]> {
    return this.http.get<UpdateRelease[]>(this.url('/updates/releases'));
  }

  /** Downloads and imports a release's bundle in the background (`202`; the release shows `importing`). */
  download(version: string): Observable<{ version: string; status: string }> {
    return this.http.post<{ version: string; status: string }>(
      this.url(`/updates/releases/${encodeURIComponent(version)}/download`),
      {},
    );
  }

  /**
   * Air-gapped import: the bundle file as the raw request body (`application/x-tar`), with upload progress events. The
   * browser streams the file; it is never read into memory.
   */
  uploadBundle(file: Blob): Observable<HttpEvent<UpdateRelease>> {
    const send = (sha256: string | null) =>
      this.http.request<UpdateRelease>(
        new HttpRequest('POST', this.url('/updates/bundles'), file, {
          reportProgress: true,
          headers: new HttpHeaders({
            'Content-Type': 'application/x-tar',
            ...(sha256 ? { [CONTENT_SHA256_HEADER]: sha256 } : {}),
          }),
        }),
      );

    // Fleet mode (2026-10-27): the relay streams the bundle and binds the caller's identity claim to its declared
    // length + SHA-256, which the cluster checks after receipt — so the digest is computed first (chunk by chunk).
    return this.endpoints.fleetMode
      ? defer(() => sha256OfBlob(file)).pipe(switchMap((sha256) => send(sha256)))
      : send(null);
  }

  rollouts(limit = 50): Observable<Rollout[]> {
    return this.http.get<Rollout[]>(this.url('/updates/rollouts'), {
      params: new HttpParams().set('limit', String(limit)),
    });
  }

  rollout(id: string): Observable<Rollout> {
    return this.http.get<Rollout>(this.url(`/updates/rollouts/${encodeURIComponent(id)}`));
  }

  /** Plans an update (status `planned`): the diff, notes, warnings and failure analysis per wave. */
  createRollout(request: CreateRolloutRequest): Observable<Rollout> {
    return this.http.post<Rollout>(this.url('/updates/rollouts'), request);
  }

  /** `approve` (optionally as an emergency outside maintenance windows), `pause`, `resume`, `rollback`, `cancel`. */
  act(id: string, action: RolloutAction, emergency = false): Observable<Rollout> {
    return this.http.post<Rollout>(
      this.url(`/updates/rollouts/${encodeURIComponent(id)}/${action}`),
      action === 'approve' && emergency ? { emergency: true } : {},
    );
  }
}
