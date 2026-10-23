import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Slo } from '../types/slos.types';
import { ConsoleApi } from './console-api';

/** SLOs of exposed services with error budget, burn rate and monthly uptime (3.25). */
@Injectable({ providedIn: 'root' })
export class SlosService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** The SLOs the caller may read, optionally of one project. */
  list(project?: string): Observable<Slo[]> {
    return this.http.get<Slo[]>(this.url('/slos'), {
      params: project ? new HttpParams().set('project', project) : undefined,
    });
  }
}
