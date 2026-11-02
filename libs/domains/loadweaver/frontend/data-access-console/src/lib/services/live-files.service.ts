import { HttpClient, HttpHeaders, HttpParams, type HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type {
  LiveFileContent,
  LiveFileEntry,
  LiveFileTarget,
  LiveFileType,
  LiveFileWriteResult,
} from '../types/live.types';
import { contentRangeTotal } from '../utils/live-files';
import { ConsoleApi } from './console-api';

const FILE_TYPES: LiveFileType[] = ['text', 'image', 'video', 'audio', 'pdf', 'binary'];

/** `X-Loadweaver-Warning` of a write (container filesystem writes are lost on restart or migration). */
export function liveWarning(response: HttpResponse<unknown>): string | null {
  return response.headers.get('X-Loadweaver-Warning') || null;
}

/**
 * The file browser (3.19): `GET /live/files` lists, `GET /live/files/content` reads (with `Range`), `PUT` writes
 * (whole ≤ 10 MB or `Content-Range` chunks with `X-Upload-Id`), `POST` creates, `DELETE` removes, `PATCH` moves,
 * `POST /live/files/copy` copies.
 */
@Injectable({ providedIn: 'root' })
export class LiveFilesService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  private params(target: LiveFileTarget, path: string): HttpParams {
    return new HttpParams().set('target', target).set('path', path);
  }

  list(target: LiveFileTarget, path: string): Observable<LiveFileEntry[]> {
    return this.http.get<LiveFileEntry[]>(this.url('/live/files'), { params: this.params(target, path) });
  }

  /** The file or `range` of it (end inclusive). */
  read(target: LiveFileTarget, path: string, range?: { start: number; end: number }): Observable<LiveFileContent> {
    const headers = range ? new HttpHeaders({ Range: `bytes=${range.start}-${range.end}` }) : undefined;

    return this.http
      .get(this.url('/live/files/content'), {
        params: this.params(target, path),
        headers,
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((response) => {
          const data = response.body ?? new Blob([]);
          const size = contentRangeTotal(response.headers.get('Content-Range')) ?? data.size;
          const type = response.headers.get('X-File-Type') as LiveFileType | null;

          return {
            data,
            size,
            partial: response.status === 206 && data.size < size,
            fileType: type && FILE_TYPES.includes(type) ? type : null,
          };
        }),
      );
  }

  /** The whole file as an attachment (up to 100 MB). */
  download(target: LiveFileTarget, path: string): Observable<Blob> {
    return this.http.get(this.url('/live/files/content'), {
      params: this.params(target, path).set('download', 'true'),
      responseType: 'blob',
    });
  }

  /** A whole file (≤ 10 MB) or one chunk of a larger upload. */
  write(
    target: LiveFileTarget,
    path: string,
    body: Blob,
    chunk?: { contentRange: string; uploadId: string },
  ): Observable<LiveFileWriteResult> {
    let headers = new HttpHeaders({ 'Content-Type': 'application/octet-stream' });

    if (chunk) headers = headers.set('Content-Range', chunk.contentRange).set('X-Upload-Id', chunk.uploadId);

    return this.http
      .put(this.url('/live/files/content'), body, {
        params: this.params(target, path),
        headers,
        observe: 'response',
        responseType: 'text',
      })
      .pipe(map((response) => ({ warning: liveWarning(response), complete: response.status !== 202 })));
  }

  /** An empty file or a directory. */
  create(target: LiveFileTarget, path: string, type: 'file' | 'directory'): Observable<string | null> {
    return this.http
      .post(
        this.url('/live/files'),
        { type },
        { params: this.params(target, path), observe: 'response', responseType: 'text' },
      )
      .pipe(map(liveWarning));
  }

  /** A file or a directory (recursively). */
  remove(target: LiveFileTarget, path: string): Observable<string | null> {
    return this.http
      .delete(this.url('/live/files'), { params: this.params(target, path), observe: 'response', responseType: 'text' })
      .pipe(map(liveWarning));
  }

  move(target: LiveFileTarget, path: string, destination: string, overwrite = false): Observable<string | null> {
    return this.http
      .patch(
        this.url('/live/files'),
        { destination, overwrite },
        { params: this.params(target, path), observe: 'response', responseType: 'text' },
      )
      .pipe(map(liveWarning));
  }

  /** Recursively. */
  copy(target: LiveFileTarget, path: string, destination: string, overwrite = false): Observable<string | null> {
    return this.http
      .post(
        this.url('/live/files/copy'),
        { destination, overwrite },
        { params: this.params(target, path), observe: 'response', responseType: 'text' },
      )
      .pipe(map(liveWarning));
  }
}
