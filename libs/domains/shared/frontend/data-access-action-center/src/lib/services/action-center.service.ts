import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ACTION_CENTER_ENVIRONMENT } from '../tokens/action-center-environment';
import type { ActionCenterView, CreateActionCenterSilence } from '../types/action-center.types';

/** REST client of the action center (the live updates arrive over the socket). */
@Injectable({
  providedIn: 'root',
})
export class ActionCenterService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject(ACTION_CENTER_ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.apiUrl}/${this.environment.basePath}`;
  }

  getView(): Observable<ActionCenterView> {
    return this.http.get<ActionCenterView>(this.baseUrl);
  }

  createSilence(silence: CreateActionCenterSilence): Observable<ActionCenterView> {
    return this.http.post<ActionCenterView>(`${this.baseUrl}/silences`, silence);
  }

  removeSilence(silenceId: string): Observable<ActionCenterView> {
    return this.http.delete<ActionCenterView>(`${this.baseUrl}/silences/${encodeURIComponent(silenceId)}`);
  }
}
