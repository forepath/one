import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreatePresentationDto,
  ImportPresentationDto,
  ListPresentationsParams,
  PaginatedPresentationsResponseDto,
  PresentationResponseDto,
  UpdatePresentationDto,
} from '../types/presentation.types';

@Injectable({
  providedIn: 'root',
})
export class PresentationsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.marpdown?.restApiUrl ?? '';
  }

  listPresentations(params?: ListPresentationsParams): Observable<PaginatedPresentationsResponseDto> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<PaginatedPresentationsResponseDto>(`${this.apiUrl}/presentations`, {
      params: httpParams,
    });
  }

  getPresentation(id: string): Observable<PresentationResponseDto> {
    return this.http.get<PresentationResponseDto>(`${this.apiUrl}/presentations/${id}`);
  }

  createPresentation(dto: CreatePresentationDto): Observable<PresentationResponseDto> {
    return this.http.post<PresentationResponseDto>(`${this.apiUrl}/presentations`, dto);
  }

  updatePresentation(id: string, dto: UpdatePresentationDto): Observable<PresentationResponseDto> {
    return this.http.patch<PresentationResponseDto>(`${this.apiUrl}/presentations/${id}`, dto);
  }

  importMarkdown(id: string, dto: ImportPresentationDto): Observable<PresentationResponseDto> {
    return this.http.post<PresentationResponseDto>(`${this.apiUrl}/presentations/${id}/import`, dto);
  }

  deletePresentation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/presentations/${id}`);
  }
}
