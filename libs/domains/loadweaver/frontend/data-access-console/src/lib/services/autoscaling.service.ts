import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { AutoscaledService } from '../types/autoscaling.types';
import { ConsoleApi } from './console-api';

/** Autoscaling status of services (3.23): range, metric vs. target, last scaling and why a scale-up is blocked. */
@Injectable({ providedIn: 'root' })
export class AutoscalingService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** The autoscaled services the caller may read, optionally of one project. */
  list(project?: string): Observable<AutoscaledService[]> {
    return this.http.get<AutoscaledService[]>(this.url('/autoscaling'), {
      params: project ? new HttpParams().set('project', project) : undefined,
    });
  }
}
