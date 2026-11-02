import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type {
  AppCatalog,
  AppCatalogsResponse,
  AppDetail,
  AppInstallRequest,
  AppListQuery,
  AppPlanResult,
  AppSummary,
  AppUninstallRequest,
  AppUpdateRequest,
  InstalledApp,
} from '../types/apps.types';
import { ConsoleApi } from './console-api';

/** The list of a `{ <key>: T[] }` answer (a bare array is accepted too). */
function list<T>(key: string) {
  return (response: T[] | Record<string, unknown> | null | undefined): T[] => {
    if (Array.isArray(response)) return response;

    const value = response?.[key];

    return Array.isArray(value) ? (value as T[]) : [];
  };
}

const seg = (value: string) => encodeURIComponent(value);

/**
 * App store (P1): catalogs, the store, app pages, install / update / uninstall plans and the installed apps of the
 * active cluster (natively or through the fleet relay — `ConsoleApi`). Reading needs any role; plans need the rights
 * of drafting the Deployment in its project; refreshing catalogs is for cluster admins (the API decides).
 */
@Injectable({ providedIn: 'root' })
export class AppStoreService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** The catalog sources with their state and the allowed trust labels. */
  catalogs(): Observable<AppCatalogsResponse> {
    return this.http
      .get<Partial<AppCatalogsResponse>>(this.url('/apps/catalogs'))
      .pipe(map((r) => ({ catalogs: r?.catalogs ?? [], allowedTrust: r?.allowedTrust ?? [] })));
  }

  /** Re-reads and verifies the enabled catalogs' indexes (one with `catalog`; cluster admins). */
  refreshCatalogs(catalog?: string): Observable<AppCatalog[]> {
    return this.http
      .post<{ catalogs: AppCatalog[] }>(this.url('/apps/catalogs/refresh'), catalog ? { catalog } : {})
      .pipe(map(list<AppCatalog>('catalogs')));
  }

  apps(query: AppListQuery = {}): Observable<AppSummary[]> {
    let params = new HttpParams();

    if (query.q) params = params.set('q', query.q);

    if (query.catalog) params = params.set('catalog', query.catalog);

    if (query.trust) params = params.set('trust', query.trust);

    return this.http.get<{ apps: AppSummary[] }>(this.url('/apps'), { params }).pipe(map(list<AppSummary>('apps')));
  }

  /** An app's versions, manifest and README (of `version`, else the latest). */
  app(catalog: string, app: string, version?: string | null): Observable<AppDetail> {
    const params = version ? new HttpParams().set('version', version) : undefined;

    return this.http.get<AppDetail>(this.url(`/apps/${seg(catalog)}/${seg(app)}`), { params });
  }

  /** Install: parameters, secret references and the project → a draft / plan with the Deployment (+ suggestions). */
  installPlan(catalog: string, app: string, version: string, request: AppInstallRequest): Observable<AppPlanResult> {
    return this.http.post<AppPlanResult>(this.url(`/apps/${seg(catalog)}/${seg(app)}/${seg(version)}/plan`), request);
  }

  /** Installed apps the caller may read (`project`: one project's). */
  installed(project?: string): Observable<InstalledApp[]> {
    const params = project ? new HttpParams().set('project', project) : undefined;

    return this.http
      .get<{ apps: InstalledApp[] }>(this.url('/apps/installed'), { params })
      .pipe(map(list<InstalledApp>('apps')));
  }

  /** Update: backup first, then the target version's manifest migrations, as a plan. */
  updatePlan(project: string, deployment: string, request: AppUpdateRequest): Observable<AppPlanResult> {
    return this.http.post<AppPlanResult>(
      this.url(`/apps/installed/${seg(project)}/${seg(deployment)}/update-plan`),
      request,
    );
  }

  /** Uninstall with an explicit data policy (keep / backup / delete; `delete` needs `confirm` = the deployment). */
  uninstallPlan(project: string, deployment: string, request: AppUninstallRequest): Observable<AppPlanResult> {
    return this.http.post<AppPlanResult>(
      this.url(`/apps/installed/${seg(project)}/${seg(deployment)}/uninstall-plan`),
      request,
    );
  }
}
