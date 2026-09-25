import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable, from, map, of, switchMap } from 'rxjs';

import type {
  AgentFileType,
  CreateFileDto,
  FileContentDto,
  FileManagerContext,
  FileNodeDto,
  FileProbeDto,
  ListDirectoryParams,
  MoveFileDto,
  WriteFileDto,
} from '../state/files/files.types';
import {
  AGENT_FILE_MAX_ASSEMBLED_BYTES,
  AGENT_FILE_MAX_CHUNK_BYTES,
  AGENT_FILE_UPLOAD_CHUNK_BYTES,
} from '../state/files/files.types';
import { arrayBufferToUtf8, utf8ToArrayBuffer, writeFileDtoToFileContent } from '../utils/agent-file-bytes';
import { shouldFetchFileBodyOnOpen } from '../utils/agent-file-open-policy';

import { AgentFileBodyStore } from './agent-file-body.store';

export type WriteFileProgressCallback = (loaded: number, total: number) => void;

@Injectable({
  providedIn: 'root',
})
export class FilesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly bodyStore = inject(AgentFileBodyStore);

  /**
   * Get the base URL for the API.
   */
  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  /**
   * Encode a file path for use in URL path segments.
   * Encodes each segment separately to preserve forward slashes,
   * which are needed for NestJS wildcard path parameter parsing.
   * @param filePath - The file path to encode
   * @returns The encoded path with forward slashes preserved
   */
  private encodePath(filePath: string): string {
    return filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private fileUrl(clientId: string, agentId: string, filePath: string): string {
    return `${this.apiUrl}/clients/${clientId}/agents/${agentId}/files/${this.encodePath(filePath)}`;
  }

  private contextParams(context: FileManagerContext, extra?: Record<string, string>): HttpParams {
    let params = new HttpParams();

    if (context === 'config') {
      params = params.set('context', 'config');
    }

    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        params = params.set(key, value);
      }
    }

    return params;
  }

  private parseAgentFileType(header: string | null): AgentFileType {
    if (
      header === 'text' ||
      header === 'binary' ||
      header === 'pdf' ||
      header === 'image' ||
      header === 'video' ||
      header === 'audio'
    ) {
      return header;
    }

    return 'binary';
  }

  private async mapResponseToFileContent(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext,
    response: HttpResponse<ArrayBuffer>,
  ): Promise<FileContentDto> {
    const body = response.body ?? new ArrayBuffer(0);
    const fileType = this.parseAgentFileType(response.headers.get('X-File-Type'));
    const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
    const text = fileType === 'text' ? arrayBufferToUtf8(body) : undefined;
    const bodyRef = this.bodyStore.buildKey(clientId, agentId, context, filePath);
    const blob = new Blob([body], { type: contentType.split(';')[0].trim() || 'application/octet-stream' });

    try {
      await this.bodyStore.put(bodyRef, blob);

      return {
        fileType,
        contentType,
        text,
        size: body.byteLength,
        bodyRef,
        revision: Date.now(),
      };
    } catch {
      return {
        fileType,
        contentType,
        text,
        size: body.byteLength,
        bodyRef: null,
        bodyOmitted: fileType !== 'text',
        revision: Date.now(),
      };
    }
  }

  /**
   * Persist write bytes outside NgRx and return serializable metadata.
   */
  async materializeWriteContent(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext,
    writeFileDto: WriteFileDto,
  ): Promise<FileContentDto> {
    const bodyRef = this.bodyStore.buildKey(clientId, agentId, context, filePath);
    const contentType = writeFileDto.contentType ?? 'application/octet-stream';
    const blob = new Blob([writeFileDto.bytes], {
      type: contentType.split(';')[0].trim() || 'application/octet-stream',
    });

    try {
      await this.bodyStore.put(bodyRef, blob);

      return writeFileDtoToFileContent(writeFileDto, bodyRef);
    } catch {
      return writeFileDtoToFileContent(writeFileDto, null);
    }
  }

  /**
   * Probe file metadata via HEAD (no body transfer).
   */
  probeFile(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext = 'app',
  ): Observable<FileProbeDto> {
    const params = this.contextParams(context);

    return this.http
      .head(this.fileUrl(clientId, agentId, filePath), {
        params,
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          fileType: this.parseAgentFileType(response.headers.get('X-File-Type')),
          contentType: response.headers.get('Content-Type') ?? 'application/octet-stream',
          size: Number(response.headers.get('Content-Length') ?? 0),
        })),
      );
  }

  /**
   * Open a file: HEAD first, then GET body only when needed for preview/edit.
   */
  openFile(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext = 'app',
  ): Observable<FileContentDto> {
    return this.probeFile(clientId, agentId, filePath, context).pipe(
      switchMap((probe) => {
        if (!shouldFetchFileBodyOnOpen(probe)) {
          return of({
            fileType: probe.fileType,
            contentType: probe.contentType,
            size: probe.size,
            text: probe.fileType === 'text' ? '' : undefined,
            bodyRef: null,
            bodyOmitted: true,
            revision: Date.now(),
          } satisfies FileContentDto);
        }

        return this.readFile(clientId, agentId, filePath, context);
      }),
    );
  }

  /**
   * Read file content from agent container as raw bytes.
   * Body bytes go to {@link AgentFileBodyStore}; NgRx only gets metadata + bodyRef.
   */
  readFile(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext = 'app',
  ): Observable<FileContentDto> {
    const params = this.contextParams(context);

    return this.http
      .get(this.fileUrl(clientId, agentId, filePath), {
        params,
        responseType: 'arraybuffer',
        observe: 'response',
      })
      .pipe(
        switchMap((response) => from(this.mapResponseToFileContent(clientId, agentId, filePath, context, response))),
      );
  }

  /**
   * Write file content to agent container as raw bytes.
   * Files ≤ 10MB use a single PUT; larger files use sequential Content-Range chunks (≤ 100MB assembled).
   */
  writeFile(
    clientId: string,
    agentId: string,
    filePath: string,
    writeFileDto: WriteFileDto,
    context: FileManagerContext = 'app',
    onProgress?: WriteFileProgressCallback,
  ): Observable<void> {
    const total = writeFileDto.bytes.byteLength;

    if (total > AGENT_FILE_MAX_ASSEMBLED_BYTES) {
      return from(
        Promise.reject(new Error(`File size exceeds maximum allowed size of ${AGENT_FILE_MAX_ASSEMBLED_BYTES} bytes`)),
      );
    }

    if (total <= AGENT_FILE_MAX_CHUNK_BYTES) {
      return this.putFileBytes(clientId, agentId, filePath, writeFileDto.bytes, context, {
        fileType: writeFileDto.fileType,
        contentType: writeFileDto.contentType,
      }).pipe(
        map(() => {
          onProgress?.(total, total);
        }),
      );
    }

    return from(this.writeFileChunked(clientId, agentId, filePath, writeFileDto, context, onProgress));
  }

  private async writeFileChunked(
    clientId: string,
    agentId: string,
    filePath: string,
    writeFileDto: WriteFileDto,
    context: FileManagerContext,
    onProgress?: WriteFileProgressCallback,
  ): Promise<void> {
    const total = writeFileDto.bytes.byteLength;
    const uploadId = crypto.randomUUID();
    const source = new Uint8Array(writeFileDto.bytes);
    let offset = 0;

    while (offset < total) {
      const end = Math.min(offset + AGENT_FILE_UPLOAD_CHUNK_BYTES, total);
      const chunk = source.subarray(offset, end).slice().buffer;

      await new Promise<void>((resolve, reject) => {
        this.putFileBytes(clientId, agentId, filePath, chunk, context, {
          fileType: writeFileDto.fileType,
          contentType: writeFileDto.contentType,
          contentRange: `bytes ${offset}-${end - 1}/${total}`,
          uploadId,
        }).subscribe({
          next: () => resolve(),
          error: (error) => reject(error),
        });
      });

      offset = end;
      onProgress?.(offset, total);
    }
  }

  private putFileBytes(
    clientId: string,
    agentId: string,
    filePath: string,
    bytes: ArrayBuffer,
    context: FileManagerContext,
    options?: {
      fileType?: AgentFileType;
      contentType?: string;
      contentRange?: string;
      uploadId?: string;
    },
  ): Observable<void> {
    let headers = new HttpHeaders({
      'Content-Type': options?.contentType ?? 'application/octet-stream',
    });

    if (options?.contentRange) {
      headers = headers.set('Content-Range', options.contentRange);
    }

    if (options?.uploadId) {
      headers = headers.set('X-Upload-Id', options.uploadId);
    }

    if (options?.fileType) {
      headers = headers.set('X-File-Type', options.fileType);
    }

    return this.http.put<void>(this.fileUrl(clientId, agentId, filePath), bytes, {
      headers,
      params: this.contextParams(context),
    });
  }

  /**
   * Download a file and trigger a browser save dialog.
   * Assembles into a Blob (not NgRx); uses Range when the server returns 206.
   */
  downloadFile(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext = 'app',
  ): Observable<void> {
    return from(this.downloadFileInternal(clientId, agentId, filePath, context));
  }

  private async downloadFileInternal(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext,
  ): Promise<void> {
    const params = this.contextParams(context, { download: 'true' });
    const fileName = filePath.includes('/') ? filePath.slice(filePath.lastIndexOf('/') + 1) : filePath;

    let first: HttpResponse<ArrayBuffer>;

    try {
      first = await new Promise<HttpResponse<ArrayBuffer>>((resolve, reject) => {
        this.http
          .get(this.fileUrl(clientId, agentId, filePath), {
            params,
            responseType: 'arraybuffer',
            observe: 'response',
            headers: new HttpHeaders({ Range: 'bytes=0-' }),
          })
          .subscribe({ next: resolve, error: reject });
      });
    } catch (error) {
      // Empty files reject Range as 416; still offer a zero-byte download.
      if (error instanceof HttpErrorResponse && error.status === 416) {
        this.triggerBrowserDownload(new Blob([]), 'application/octet-stream', fileName);

        return;
      }

      throw error;
    }

    const contentType = first.headers.get('Content-Type') ?? 'application/octet-stream';
    let blob: Blob;

    if (first.status === 206) {
      blob = await this.assembleRangeDownloadBlob(clientId, agentId, filePath, context, first, contentType);
    } else {
      blob = new Blob([first.body ?? new ArrayBuffer(0)], {
        type: contentType.split(';')[0].trim() || 'application/octet-stream',
      });
    }

    this.triggerBrowserDownload(blob, contentType, fileName);
  }

  private async assembleRangeDownloadBlob(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext,
    first: HttpResponse<ArrayBuffer>,
    contentType: string,
  ): Promise<Blob> {
    const contentRange = first.headers.get('Content-Range');
    const totalMatch = contentRange?.match(/\/(\d+)$/);
    const total = totalMatch ? Number(totalMatch[1]) : (first.body?.byteLength ?? 0);
    const parts: BlobPart[] = [first.body ?? new ArrayBuffer(0)];
    let nextStart = first.body?.byteLength ?? 0;

    while (nextStart < total) {
      const end = Math.min(nextStart + AGENT_FILE_UPLOAD_CHUNK_BYTES, total) - 1;
      const part = await new Promise<HttpResponse<ArrayBuffer>>((resolve, reject) => {
        this.http
          .get(this.fileUrl(clientId, agentId, filePath), {
            params: this.contextParams(context, { download: 'true' }),
            responseType: 'arraybuffer',
            observe: 'response',
            headers: new HttpHeaders({ Range: `bytes=${nextStart}-${end}` }),
          })
          .subscribe({ next: resolve, error: reject });
      });

      const partBytes = part.body ?? new ArrayBuffer(0);

      parts.push(partBytes);
      nextStart += partBytes.byteLength;
    }

    return new Blob(parts, { type: contentType.split(';')[0].trim() || 'application/octet-stream' });
  }

  private triggerBrowserDownload(blob: Blob, contentType: string, fileName: string): void {
    const typed =
      blob.type && blob.type !== ''
        ? blob
        : new Blob([blob], { type: contentType.split(';')[0].trim() || 'application/octet-stream' });
    const url = URL.createObjectURL(typed);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /**
   * List directory contents in agent container.
   */
  listDirectory(clientId: string, agentId: string, params?: ListDirectoryParams): Observable<FileNodeDto[]> {
    let httpParams = new HttpParams();

    if (params?.path !== undefined) {
      httpParams = httpParams.set('path', params.path);
    }

    if (params?.context === 'config') {
      httpParams = httpParams.set('context', 'config');
    }

    return this.http.get<FileNodeDto[]>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/files`, {
      params: httpParams,
    });
  }

  /**
   * Create a file or directory in agent container (metadata only; no body content).
   */
  createFileOrDirectory(
    clientId: string,
    agentId: string,
    filePath: string,
    createFileDto: CreateFileDto,
    context: FileManagerContext = 'app',
  ): Observable<void> {
    return this.http.post<void>(this.fileUrl(clientId, agentId, filePath), createFileDto, {
      params: this.contextParams(context),
    });
  }

  /**
   * Delete a file or directory from agent container.
   */
  deleteFileOrDirectory(
    clientId: string,
    agentId: string,
    filePath: string,
    context: FileManagerContext = 'app',
  ): Observable<void> {
    return this.http
      .delete<void>(this.fileUrl(clientId, agentId, filePath), {
        params: this.contextParams(context),
      })
      .pipe(
        switchMap(() =>
          from(
            this.bodyStore.delete(this.bodyStore.buildKey(clientId, agentId, context, filePath)).catch(() => undefined),
          ),
        ),
        map(() => undefined),
      );
  }

  /**
   * Move a file or directory in agent container.
   */
  moveFileOrDirectory(
    clientId: string,
    agentId: string,
    sourcePath: string,
    moveFileDto: MoveFileDto,
    context: FileManagerContext = 'app',
  ): Observable<void> {
    return this.http.patch<void>(this.fileUrl(clientId, agentId, sourcePath), moveFileDto, {
      params: this.contextParams(context),
    });
  }

  /**
   * Resolve stored body (or text) back to a WriteFileDto for copies/saves.
   */
  async fileContentToWriteDto(content: FileContentDto): Promise<WriteFileDto> {
    if (content.bodyRef) {
      const buffer = await this.bodyStore.getArrayBuffer(content.bodyRef);

      if (buffer) {
        return {
          bytes: buffer,
          fileType: content.fileType,
          contentType: content.contentType,
        };
      }
    }

    if (content.fileType === 'text' && content.text !== undefined) {
      return {
        bytes: utf8ToArrayBuffer(content.text),
        fileType: content.fileType,
        contentType: content.contentType,
      };
    }

    throw new Error('File body is not available in local storage');
  }
}
