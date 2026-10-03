import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ENVIRONMENT, type Environment } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

export type OpencodeLayerFileEntryKind = 'file' | 'directory';

export interface OpencodeLayerFileDto {
  id: string;
  scope: 'global' | 'workspace';
  clientId?: string | null;
  path: string;
  emittedPath: string;
  entryKind: OpencodeLayerFileEntryKind;
  content: string;
  contentSha: string;
  updatedAt: string;
}

export interface OpencodeLayerFileListEntryDto {
  name: string;
  path: string;
  entryKind: OpencodeLayerFileEntryKind;
}

export interface OpencodeLayerFileListDto {
  path: string;
  entries: OpencodeLayerFileListEntryDto[];
}

@Injectable({ providedIn: 'root' })
export class OpencodeLayerFilesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  listGlobal(path = '.'): Observable<OpencodeLayerFileListDto> {
    return this.http.get<OpencodeLayerFileListDto>(`${this.apiUrl}/admin/opencode/config/files`, {
      params: new HttpParams().set('path', path),
    });
  }

  listWorkspace(clientId: string, path = '.'): Observable<OpencodeLayerFileListDto> {
    return this.http.get<OpencodeLayerFileListDto>(`${this.apiUrl}/clients/${clientId}/opencode/config/files`, {
      params: new HttpParams().set('path', path),
    });
  }

  createGlobal(path: string, entryKind: OpencodeLayerFileEntryKind, content = ''): Observable<OpencodeLayerFileDto> {
    return this.http.post<OpencodeLayerFileDto>(`${this.apiUrl}/admin/opencode/config/files`, {
      path,
      entryKind,
      content,
    });
  }

  createWorkspace(
    clientId: string,
    path: string,
    entryKind: OpencodeLayerFileEntryKind,
    content = '',
  ): Observable<OpencodeLayerFileDto> {
    return this.http.post<OpencodeLayerFileDto>(`${this.apiUrl}/clients/${clientId}/opencode/config/files`, {
      path,
      entryKind,
      content,
    });
  }

  ensureGlobal(path: string, entryKind?: OpencodeLayerFileEntryKind): Observable<OpencodeLayerFileDto> {
    const body: { path: string; entryKind?: OpencodeLayerFileEntryKind } = { path };

    if (entryKind) {
      body.entryKind = entryKind;
    }

    return this.http.post<OpencodeLayerFileDto>(`${this.apiUrl}/admin/opencode/config/files/ensure`, body);
  }

  ensureWorkspace(
    clientId: string,
    path: string,
    entryKind?: OpencodeLayerFileEntryKind,
  ): Observable<OpencodeLayerFileDto> {
    const body: { path: string; entryKind?: OpencodeLayerFileEntryKind } = { path };

    if (entryKind) {
      body.entryKind = entryKind;
    }

    return this.http.post<OpencodeLayerFileDto>(
      `${this.apiUrl}/clients/${clientId}/opencode/config/files/ensure`,
      body,
    );
  }

  getGlobal(path: string): Observable<OpencodeLayerFileDto> {
    return this.http.get<OpencodeLayerFileDto>(`${this.apiUrl}/admin/opencode/config/files/${this.encode(path)}`);
  }

  putGlobal(path: string, content: string): Observable<OpencodeLayerFileDto> {
    return this.http.put<OpencodeLayerFileDto>(`${this.apiUrl}/admin/opencode/config/files/${this.encode(path)}`, {
      content,
    });
  }

  deleteGlobal(path: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.apiUrl}/admin/opencode/config/files/${this.encode(path)}`);
  }

  getWorkspace(clientId: string, path: string): Observable<OpencodeLayerFileDto> {
    return this.http.get<OpencodeLayerFileDto>(
      `${this.apiUrl}/clients/${clientId}/opencode/config/files/${this.encode(path)}`,
    );
  }

  putWorkspace(clientId: string, path: string, content: string): Observable<OpencodeLayerFileDto> {
    return this.http.put<OpencodeLayerFileDto>(
      `${this.apiUrl}/clients/${clientId}/opencode/config/files/${this.encode(path)}`,
      { content },
    );
  }

  deleteWorkspace(clientId: string, path: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(
      `${this.apiUrl}/clients/${clientId}/opencode/config/files/${this.encode(path)}`,
    );
  }

  private encode(path: string): string {
    return path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }
}
