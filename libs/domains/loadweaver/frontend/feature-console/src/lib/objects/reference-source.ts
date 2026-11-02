import type { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject, signal } from '@angular/core';
import {
  AccessService,
  BackupsService,
  ResourcesService,
  SecretsService,
  type AccessMe,
} from '@forepath/loadweaver/frontend/data-access-console';
import { catchError, combineLatest, defer, map, type Observable, of, shareReplay } from 'rxjs';

import { REF_TEXT, type ReferenceTarget } from './reference-fields';
import { SCHEMA_KIND_LABELS } from './schema-form-labels';

/** One suggestion: the stored value, its readable label and a detail line (kind / project / role). */
export interface ReferenceOption {
  value: string;
  label: string;
  detail: string | null;
}

/** Suggestions, or `denied` when the caller may not list the referenced kind (the field stays a plain input). */
export interface ReferenceResult {
  options: ReferenceOption[];
  denied: boolean;
}

/** Suggestions per request (the list is a picker, not a browser: typing narrows it on the server). */
export const REFERENCE_LIMIT = 20;

function failed(error: unknown): Observable<ReferenceResult> {
  const status = (error as HttpErrorResponse | null)?.status;

  return of({ options: [], denied: status === 401 || status === 403 });
}

function matches(term: string, ...texts: (string | null | undefined)[]): boolean {
  return !term || texts.some((t) => (t ?? '').toLowerCase().includes(term));
}

/**
 * Suggestions for the reference fields of one generated form (2026-10-29): readable resources of the referenced kind
 * (server-side filtered and scoped to what the caller may read; project-scoped kinds within the edited resource's
 * project), the caller's projects, the project's backups, and secret NAMES of a project (names-only endpoint; secret
 * values are never requested). Provided by `loadweaver-schema-form`; services are resolved on first use.
 */
@Injectable()
export class LoadweaverReferenceSource {
  private readonly injector = inject(Injector);
  private me$: Observable<AccessMe | null> | null = null;

  /** `metadata.project` of the edited resource (null: a cluster-level resource). */
  readonly project = signal<string | null>(null);

  /** Never errors: a failed list is an empty one (`denied` for 401 / 403), so the field stays a plain input. */
  search(target: ReferenceTarget, query: string): Observable<ReferenceResult> {
    const term = query.trim().toLowerCase();

    return defer(() => {
      switch (target.type) {
        case 'resource':
          return this.resources(target.kind, target.projectScoped, term);
        case 'project':
        case 'secret':
          return this.projects(term);
        case 'backup':
          return this.backups(term);
        case 'secretName':
          return this.secretNames(target.project, term);
      }
    }).pipe(catchError(failed));
  }

  private resources(kind: string, projectScoped: boolean, term: string): Observable<ReferenceResult> {
    const project = projectScoped ? this.project() : null;
    const kindLabel = SCHEMA_KIND_LABELS[kind] ?? kind;

    return this.injector
      .get(ResourcesService)
      .search(kind, { project, q: term, limit: REFERENCE_LIMIT })
      .pipe(
        map((list) => ({
          denied: false,
          options: list.map((r) => ({
            value: r.metadata.name,
            label: r.metadata.name,
            detail: r.metadata.project
              ? `${kindLabel} · ${REF_TEXT.projectDetail.replace('{project}', r.metadata.project)}`
              : kindLabel,
          })),
        })),
        catchError(failed),
      );
  }

  /** The caller's projects (`/access/me`) and, for cluster roles, every readable `Project` resource. */
  private projects(term: string): Observable<ReferenceResult> {
    const own$ = this.me().pipe(map((me) => me?.projects ?? {}));
    const declared$ = this.injector
      .get(ResourcesService)
      .search('Project', { q: term, limit: REFERENCE_LIMIT })
      .pipe(
        map((list) => ({ names: list.map((r) => r.metadata.name), denied: false })),
        catchError((error: unknown) => failed(error).pipe(map((r) => ({ names: [] as string[], denied: r.denied })))),
      );

    return combineLatest([own$, declared$]).pipe(
      map(([own, declared]) => {
        const names = [...new Set([...Object.keys(own), ...declared.names])]
          .filter((name) => matches(term, name))
          .sort()
          .slice(0, REFERENCE_LIMIT);

        return {
          denied: declared.denied && Object.keys(own).length === 0,
          options: names.map((name) => ({
            value: name,
            label: name,
            detail: own[name] ? REF_TEXT.yourRole.replace('{role}', own[name]) : SCHEMA_KIND_LABELS['Project'],
          })),
        };
      }),
    );
  }

  /**
   * Secret names of `project` (names only: `SecretsService.listNames`, the same permission as reading secrets; a
   * caller without it gets `denied` and types the name). No project yet: nothing to list.
   */
  private secretNames(project: string | null, term: string): Observable<ReferenceResult> {
    if (!project) return of({ options: [], denied: false });

    return this.injector
      .get(SecretsService)
      .listNames(project, { q: term || undefined, limit: REFERENCE_LIMIT })
      .pipe(
        map((res) => ({
          denied: false,
          options: res.items.map((item) => ({ value: item.name, label: item.name, detail: null })),
        })),
        catchError(failed),
      );
  }

  /** Backups of the edited resource's project, newest first (id stored, volume + time shown). */
  private backups(term: string): Observable<ReferenceResult> {
    const project = this.project();

    return this.injector
      .get(BackupsService)
      .catalog({ project, limit: 200 })
      .pipe(
        map((list) => ({
          denied: false,
          options: list
            .filter((b) => b.status === 'succeeded')
            .filter((b) => matches(term, b.id, b.resource))
            .slice(0, REFERENCE_LIMIT)
            .map((b) => ({
              value: b.id,
              label: b.resource,
              detail: `${b.startedAt.slice(0, 16).replace('T', ' ')} · ${b.id}`,
            })),
        })),
        catchError(failed),
      );
  }

  private me(): Observable<AccessMe | null> {
    this.me$ ??= this.injector
      .get(AccessService)
      .me()
      .pipe(
        catchError(() => of(null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    return this.me$;
  }
}
