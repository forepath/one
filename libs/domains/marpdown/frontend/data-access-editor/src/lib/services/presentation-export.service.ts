import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ExportFormat } from '@forepath/marpdown/marpdown/shared';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PresentationExportService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.marpdown?.restApiUrl ?? '';
  }

  exportPresentation(presentationId: string, format: ExportFormat): Observable<Blob> {
    return this.http.post(
      `${this.apiUrl}/presentations/${presentationId}/export`,
      { format },
      { responseType: 'blob' },
    );
  }
}
