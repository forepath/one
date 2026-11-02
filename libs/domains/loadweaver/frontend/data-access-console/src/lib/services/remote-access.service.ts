import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { VpnClient } from '../types/remote-access.types';
import { ConsoleApi } from './console-api';

/**
 * Remote access (3.31): the caller's enrolled devices (all clients for infra operators and cluster admins) and
 * instant revocation. Enrollment happens on the device (`loadweaver vpn enroll`), the private key never leaves it.
 */
@Injectable({ providedIn: 'root' })
export class RemoteAccessService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** `all`: every client in the cluster (infra permission). */
  devices(all = false): Observable<VpnClient[]> {
    return this.http.get<VpnClient[]>(this.url('/vpn/devices'), {
      params: all ? new HttpParams().set('all', 'true') : undefined,
    });
  }

  revoke(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/vpn/devices/${encodeURIComponent(id)}`));
  }
}
