import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { TrustedFleet, TrustedFleetInput } from '../types/trusted-fleets.types';
import { ConsoleApi } from './console-api';

/**
 * Trusted fleets (3.24, cluster admins, the cluster's own console only): the fleets whose signed identity claims the
 * cluster accepts, so approvals through a fleet count the real person.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleTrustedFleetsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(): Observable<TrustedFleet[]> {
    return this.http.get<TrustedFleet[]>(this.url('/trusted-fleets'));
  }

  put(issuer: string, input: TrustedFleetInput): Observable<TrustedFleet> {
    return this.http.put<TrustedFleet>(this.url(`/trusted-fleets/${encodeURIComponent(issuer)}`), input);
  }

  remove(issuer: string): Observable<void> {
    return this.http.delete<void>(this.url(`/trusted-fleets/${encodeURIComponent(issuer)}`));
  }
}
