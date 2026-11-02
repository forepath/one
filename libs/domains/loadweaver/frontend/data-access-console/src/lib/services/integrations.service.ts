import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type { IntegrationEnvStatus, IntegrationTestResult, IntegrationTestTarget } from '../types/integrations.types';
import { ConsoleApi } from './console-api';

/**
 * External integrations (3.41): the read-only status of env-configured integrations (cluster admins) and connection
 * tests of the applied DNS providers, backup targets, failover-IP providers and SIEM targets.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  status(): Observable<IntegrationEnvStatus[]> {
    return this.http.get<{ env: IntegrationEnvStatus[] }>(this.url('/integrations')).pipe(map((r) => r.env ?? []));
  }

  test(kind: IntegrationTestTarget, name: string): Observable<IntegrationTestResult> {
    return this.http.post<IntegrationTestResult>(this.url('/integrations/test'), { kind, name });
  }
}
