import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { ImportDetail, ImportSelections, ImportSelectionView, ImportSummary } from '../types/import.types';
import type { Plan } from '../types/plans.types';
import { ConsoleApi } from './console-api';

/** The import wizard's API (3.21): pending nodes' discoveries, selections, join plans and their plan. */
@Injectable({ providedIn: 'root' })
export class ImportService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(): Observable<ImportSummary[]> {
    return this.http.get<ImportSummary[]>(this.url('/imports'));
  }

  get(node: string): Observable<ImportDetail> {
    return this.http.get<ImportDetail>(this.url(`/imports/${encodeURIComponent(node)}`));
  }

  /** Asks the pending node to discover again. */
  discover(node: string): Observable<{ request: string }> {
    return this.http.post<{ request: string }>(this.url(`/imports/${encodeURIComponent(node)}/discover`), {});
  }

  /** Saves the selections and returns the join plan built from them (a preview). */
  saveSelection(node: string, selections: ImportSelections): Observable<ImportSelectionView> {
    return this.http.put<ImportSelectionView>(this.url(`/imports/${encodeURIComponent(node)}/selection`), selections);
  }

  /** Turns the saved selections into one plan (deployments + NodeImport). */
  createPlan(node: string): Observable<Plan> {
    return this.http.post<Plan>(this.url(`/imports/${encodeURIComponent(node)}/plan`), {});
  }

  /** Discards the open import; a pending node leaves the cluster. */
  discard(node: string): Observable<{ discarded: boolean; nodeLeft: boolean }> {
    return this.http.delete<{ discarded: boolean; nodeLeft: boolean }>(
      this.url(`/imports/${encodeURIComponent(node)}`),
    );
  }
}
