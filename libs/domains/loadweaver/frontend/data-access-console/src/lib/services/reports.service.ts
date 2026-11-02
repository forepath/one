import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Report, ReportFileEntry, RunReport } from '../types/reports.types';
import { ConsoleApi } from './console-api';

function pathParams(path: string): HttpParams | undefined {
  return path ? new HttpParams().set('path', path) : undefined;
}

/** Periodic reports (3.25): runs, re-runs for a finished month and the file tree. */
@Injectable({ providedIn: 'root' })
export class ReportsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Report[]> {
    return this.http.get<Report[]>(this.url('/reports'));
  }

  /** Queues a report for a finished month (cluster admins for `cluster`, project admins for their project). */
  run(report: RunReport): Observable<void> {
    return this.http.post<void>(this.url('/reports/run'), report);
  }

  /** One folder of the tree (`''` = the root). */
  files(path = ''): Observable<ReportFileEntry[]> {
    return this.http.get<ReportFileEntry[]>(this.url('/reports/files'), { params: pathParams(path) });
  }

  /** A file's content (sent as an attachment; fetched with the API's credentials). */
  download(path: string): Observable<Blob> {
    return this.http.get(this.url('/reports/files/download'), { params: pathParams(path), responseType: 'blob' });
  }

  /** A folder as a ZIP archive (up to 500 files and 100 MiB). */
  archive(path: string): Observable<Blob> {
    return this.http.get(this.url('/reports/files/archive'), { params: pathParams(path), responseType: 'blob' });
  }
}
