import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { EnvironmentProgress } from '../state/environment-progress/environment-progress.types';

@Injectable({
  providedIn: 'root',
})
export class EnvironmentProgressService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  /**
   * List running environment create / update operations of a workspace (initial state before socket events).
   */
  listClientEnvironmentProgress(clientId: string): Observable<EnvironmentProgress[]> {
    return this.http.get<EnvironmentProgress[]>(`${this.apiUrl}/clients/${clientId}/agents/progress`);
  }
}
