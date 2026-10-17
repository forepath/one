import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  DnsFailoverState,
  DnsProviderResource,
  DnsRecordResource,
  DnssecZone,
  DnsZoneResource,
  DnsZoneStatus,
} from '../types/dns.types';
import { ConsoleApi } from './console-api';

/**
 * DNS (3.15, 3.28): the zones' sync state at their providers, DNSSEC and failovers (cluster roles), plus the declared
 * `DnsRecord` / `DnsZone` / `DnsProvider` resources (records also for the projects that own them).
 */
@Injectable({ providedIn: 'root' })
export class DnsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  zones(): Observable<DnsZoneStatus[]> {
    return this.http.get<DnsZoneStatus[]>(this.url('/dns/zones'));
  }

  dnssec(): Observable<DnssecZone[]> {
    return this.http.get<DnssecZone[]>(this.url('/dns/dnssec'));
  }

  failovers(): Observable<DnsFailoverState[]> {
    return this.http.get<DnsFailoverState[]>(this.url('/dns/failover'));
  }

  /** Confirms a pending manual fail-back to the primary endpoint. */
  failback(name: string): Observable<{ confirmed: true }> {
    return this.http.post<{ confirmed: true }>(this.url(`/dns/failover/${encodeURIComponent(name)}/failback`), {});
  }

  records(): Observable<DnsRecordResource[]> {
    return this.http.get<DnsRecordResource[]>(this.url('/resources'), { params: { kind: 'DnsRecord' } });
  }

  zoneResources(): Observable<DnsZoneResource[]> {
    return this.http.get<DnsZoneResource[]>(this.url('/resources'), { params: { kind: 'DnsZone' } });
  }

  providers(): Observable<DnsProviderResource[]> {
    return this.http.get<DnsProviderResource[]>(this.url('/resources'), { params: { kind: 'DnsProvider' } });
  }
}
