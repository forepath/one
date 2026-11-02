import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type { LiveTargets, TerminalSessionRecord, TunnelRecord } from '../types/live.types';
import { liveTargetsFromTopology } from '../utils/live-files';
import { ConsoleApi } from './console-api';
import { TopologyService } from './topology.service';

/**
 * Live interaction (3.19) over REST: what a terminal / the file browser can open (from the access-scoped topology),
 * terminal session records with their recordings, open debug tunnels.
 */
@Injectable({ providedIn: 'root' })
export class LiveService extends ConsoleApi {
  private readonly http = inject(HttpClient);
  private readonly topology = inject(TopologyService);

  /** Replicas, volumes and (cluster roles) nodes, without flows. */
  targets(): Observable<LiveTargets> {
    return this.topology.graph().pipe(map(liveTargetsFromTopology));
  }

  /** Newest first, at most 1000; auditors and cluster admins all, project admins their projects. */
  sessions(project?: string | null): Observable<TerminalSessionRecord[]> {
    const params = project ? new HttpParams().set('project', project) : new HttpParams();

    return this.http.get<TerminalSessionRecord[]>(this.url('/live/sessions'), { params });
  }

  /** The asciicast v2 recording of a session. */
  recording(id: string): Observable<string> {
    return this.http.get(this.url(`/live/sessions/${encodeURIComponent(id)}/recording`), { responseType: 'text' });
  }

  tunnels(): Observable<TunnelRecord[]> {
    return this.http.get<TunnelRecord[]>(this.url('/live/tunnels'));
  }
}
