import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Overview } from '../types/console.types';
import { ConsoleApi } from './console-api';

@Injectable({ providedIn: 'root' })
export class OverviewService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** The overview, optionally for one project. */
  overview(project?: string): Observable<Overview> {
    return this.http.get<Overview>(this.url('/overview'), {
      params: project ? new HttpParams().set('project', project) : undefined,
    });
  }
}
