import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { DriftReport, ProposeDriftPlan } from '../types/drift.types';
import type { Plan } from '../types/plans.types';
import { ConsoleApi } from './console-api';

/** Drift (3.8): foreign containers and inconsistent states, and plans proposed from them. */
@Injectable({ providedIn: 'root' })
export class DriftService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  report(): Observable<DriftReport> {
    return this.http.get<DriftReport>(this.url('/drift'));
  }

  /** A `Deployment` plan with the foreign container's image and published ports. */
  propose(dto: ProposeDriftPlan): Observable<Plan> {
    return this.http.post<Plan>(this.url('/drift/plans'), dto);
  }
}
