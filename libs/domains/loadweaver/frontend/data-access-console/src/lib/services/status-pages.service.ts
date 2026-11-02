import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { CreateIncident, Incident, StatusPageResource, UpdateIncident } from '../types/status-pages.types';
import { ConsoleApi } from './console-api';

function incidentsPath(project: string): string {
  return `/projects/${encodeURIComponent(project)}/incidents`;
}

/** Status pages (`StatusPage` resources) and the projects' incident notes (3.25). */
@Injectable({ providedIn: 'root' })
export class StatusPagesService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** Every `StatusPage` the caller may read. */
  pages(): Observable<StatusPageResource[]> {
    return this.http.get<StatusPageResource[]>(this.url('/resources'), {
      params: new HttpParams().set('kind', 'StatusPage'),
    });
  }

  /** A project's incidents, newest first (at most 200). */
  incidents(project: string): Observable<Incident[]> {
    return this.http.get<Incident[]>(this.url(incidentsPath(project)));
  }

  /** Operators and admins of the project. */
  createIncident(project: string, incident: CreateIncident): Observable<Incident> {
    return this.http.post<Incident>(this.url(incidentsPath(project)), incident);
  }

  /** Appends a status and note; `resolved` sets the resolution time, a later status reopens it. */
  updateIncident(project: string, id: string, update: UpdateIncident): Observable<Incident> {
    return this.http.put<Incident>(this.url(`${incidentsPath(project)}/${encodeURIComponent(id)}`), update);
  }
}
