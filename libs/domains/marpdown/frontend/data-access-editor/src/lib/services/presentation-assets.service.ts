import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AssetContentDto,
  CreateAssetDto,
  FileNodeDto,
  MoveAssetDto,
  WriteAssetDto,
} from '../types/presentation.types';

@Injectable({
  providedIn: 'root',
})
export class PresentationAssetsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.marpdown?.restApiUrl ?? '';
  }

  private assetsBase(presentationId: string): string {
    return `${this.apiUrl}/presentations/${presentationId}/assets`;
  }

  listDirectory(presentationId: string, path = '.'): Observable<FileNodeDto[]> {
    let params = new HttpParams();

    if (path && path !== '.') {
      params = params.set('path', path);
    }

    return this.http.get<FileNodeDto[]>(this.assetsBase(presentationId), { params });
  }

  readAsset(presentationId: string, assetPath: string): Observable<AssetContentDto> {
    return this.http.get<AssetContentDto>(`${this.assetsBase(presentationId)}/${assetPath}`);
  }

  writeAsset(presentationId: string, assetPath: string, dto: WriteAssetDto): Observable<void> {
    return this.http.put<void>(`${this.assetsBase(presentationId)}/${assetPath}`, dto);
  }

  createAsset(presentationId: string, assetPath: string, dto: CreateAssetDto): Observable<void> {
    return this.http.post<void>(`${this.assetsBase(presentationId)}/${assetPath}`, dto);
  }

  moveAsset(presentationId: string, assetPath: string, dto: MoveAssetDto): Observable<void> {
    return this.http.patch<void>(`${this.assetsBase(presentationId)}/${assetPath}`, dto);
  }

  deleteAsset(presentationId: string, assetPath: string): Observable<void> {
    return this.http.delete<void>(`${this.assetsBase(presentationId)}/${assetPath}`);
  }
}
