import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { AuditExportFormat, AuditFilter, AuditPage, AuditQuery, AuditVerification } from '../types/audit.types';
import { ConsoleApi } from './console-api';

/** The query parameters of an audit filter (empty values left out). */
export function auditParams(query: AuditQuery): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;

    params = params.set(key, String(value));
  }

  return params;
}

/**
 * The audit log (3.18): search newest first with a `before` cursor, export (CSV / NDJSON), and the hash chain's
 * verification (auditors and cluster admins). Project admins see their projects' entries.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleAuditService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(query: AuditQuery): Observable<AuditPage> {
    return this.http.get<AuditPage>(this.url('/audit'), { params: auditParams(query) });
  }

  export(filter: AuditFilter, format: AuditExportFormat): Observable<string> {
    return this.http.get(this.url('/audit/export'), {
      params: auditParams({ ...filter }).set('format', format),
      responseType: 'text',
    });
  }

  verify(): Observable<AuditVerification> {
    return this.http.get<AuditVerification>(this.url('/cluster/audit/verify'));
  }
}
