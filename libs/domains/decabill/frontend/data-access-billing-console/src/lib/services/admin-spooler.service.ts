import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { defer, Observable, switchMap, throwError, timer } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';

import type { PaginatedSpoolJobs, SpoolJob, SpoolJobListParams } from '../types/spooler.types';

/** Poll fast at first (most printouts take a few seconds), then back off. */
export const SPOOL_POLL_FAST_MS = 1000;
export const SPOOL_POLL_SLOW_MS = 3000;
const SPOOL_POLL_FAST_COUNT = 10;

/** The triggering page stops waiting after this; the job keeps running and its file stays on the Spooler page. */
export const SPOOL_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/** Thrown when a spooled printout did not finish while the page waited (the job keeps running). */
export class SpoolJobPendingError extends Error {
  constructor(readonly jobId: string) {
    super('The printout is still being prepared; download it from the Spooler page once it is ready.');
    this.name = 'SpoolJobPendingError';
  }
}

/** Thrown when a spooled printout failed (message from the job). */
export class SpoolJobFailedError extends Error {
  constructor(
    readonly jobId: string,
    message: string,
  ) {
    super(message);
    this.name = 'SpoolJobFailedError';
  }
}

/**
 * Central spooler (admin printouts and document sends run as background jobs). `spoolAndDownload` turns a spool
 * request into the finished file, so pages that used to download a PDF directly keep working unchanged.
 */
@Injectable({
  providedIn: 'root',
})
export class AdminSpoolerService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.billing.urls.restApi}/admin/billing/spooler/jobs`;
  }

  list(params: SpoolJobListParams = {}): Observable<PaginatedSpoolJobs> {
    let httpParams = new HttpParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }

    return this.http.get<PaginatedSpoolJobs>(this.baseUrl, { params: httpParams });
  }

  get(id: string): Observable<SpoolJob> {
    return this.http.get<SpoolJob>(`${this.baseUrl}/${id}`);
  }

  downloadFile(id: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${id}/file`, { responseType: 'blob' });
  }

  retry(id: string): Observable<SpoolJob> {
    return this.http.post<SpoolJob>(`${this.baseUrl}/${id}/retry`, {});
  }

  cancel(id: string): Observable<SpoolJob> {
    return this.http.post<SpoolJob>(`${this.baseUrl}/${id}/cancel`, {});
  }

  /** Emits the job once it finished (completed, failed or cancelled); errors after `SPOOL_WAIT_TIMEOUT_MS`. */
  awaitJob(jobId: string): Observable<SpoolJob> {
    return timer(0, SPOOL_POLL_FAST_MS).pipe(
      // After the fast phase, only every third tick polls (≈ SPOOL_POLL_SLOW_MS).
      filter((tick) => tick < SPOOL_POLL_FAST_COUNT || tick % (SPOOL_POLL_SLOW_MS / SPOOL_POLL_FAST_MS) === 0),
      switchMap(() => this.get(jobId)),
      filter((job) => job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'),
      take(1),
      timeout({ first: SPOOL_WAIT_TIMEOUT_MS, with: () => throwError(() => new SpoolJobPendingError(jobId)) }),
    );
  }

  /**
   * Spools a printout and resolves its file once the job completed (auto-download on the triggering page). A failed
   * or cancelled job errors with its message; the job stays on the Spooler page either way.
   */
  spoolAndDownload(spool: Observable<SpoolJob>): Observable<Blob> {
    return defer(() => spool).pipe(
      switchMap((job) => this.awaitJob(job.id)),
      switchMap((job) => {
        if (job.status !== 'completed' || !job.hasFile) {
          return throwError(
            () =>
              new SpoolJobFailedError(
                job.id,
                job.error ?? (job.status === 'cancelled' ? 'The printout was cancelled' : 'The printout failed'),
              ),
          );
        }

        return this.downloadFile(job.id);
      }),
    );
  }
}
