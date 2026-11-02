import { inject, Injectable, signal } from '@angular/core';
import { type ActivatedRouteSnapshot, type CanActivateFn, Router } from '@angular/router';
import type { ResourceKey } from '@forepath/loadweaver/frontend/data-access-console';

import { objectRefFromUrl } from './object-route';

/** What the resource modal is opened for: a new resource (kind / project preset or null) or an existing one. */
export type ResourceModalRequest =
  | { mode: 'create'; kind: string | null; project: string | null }
  /** `step`: open on that step (e.g. the Integrations hub's Edit → Cluster "services"), when the kind has it. */
  | { mode: 'edit'; key: ResourceKey; step?: string };

/**
 * The project a top-bar create starts in (2026-10-29: the top-bar "+" is the only create entry, so it takes over the
 * removed page-level presets): the project page or a project resource in the URL, else a section's `?project=`.
 */
export function createProjectFromUrl(url: string): string | null {
  const ref = objectRefFromUrl(url);

  if (ref?.kind === 'project') return ref.name;

  if (ref?.project) return ref.project;

  const query = url.split('#')[0].split('?')[1] ?? '';

  return new URLSearchParams(query).get('project') || null;
}

/**
 * Opens the resource create / edit modal (3.37 / 3.38, 2026-10-29: modal like Decabill's order wizard and Agenstra's
 * workspace modal). Create: only the top-bar Create ▾ and the `/create` deep links (2026-10-29); edit: object headers,
 * row menus, `e`. The container hosts the one modal instance.
 */
@Injectable({ providedIn: 'root' })
export class ResourceModalService {
  readonly request = signal<ResourceModalRequest | null>(null);

  openCreate(kind: string | null = null, project: string | null = null): void {
    // A non-creatable kind (the cluster itself) never presets the wizard; it opens on the kind table instead.
    this.request.set({ mode: 'create', kind: kind && isCreatableKind(kind) ? kind : null, project });
  }

  openEdit(key: ResourceKey, step?: string): void {
    this.request.set({
      mode: 'edit',
      key: { kind: key.kind, name: key.name, project: key.project ?? null },
      ...(step ? { step } : {}),
    });
  }

  close(): void {
    this.request.set(null);
  }
}

/**
 * Deep links `/create` and `/create/<kind>?project=` (search actions, bookmarks): open the create modal over its parent
 * page — the project's page with `?project=`, else the cluster page.
 */
export const openCreateModalGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const project = route.queryParamMap.get('project') || null;

  inject(ResourceModalService).openCreate(route.paramMap.get('kind') || null, project);

  return inject(Router).createUrlTree(project ? ['/resources', 'project', project] : ['/resources', 'cluster']);
};

/**
 * Kinds that can't be created from the console (user, 2026-10-29): the Cluster is the root object, exactly one per
 * control plane, and is edited in place; creating another one from inside a cluster makes no sense.
 */
export const NON_CREATABLE_KINDS: ReadonlySet<string> = new Set(['Cluster']);

export function isCreatableKind(kind: string): boolean {
  return !NON_CREATABLE_KINDS.has(kind);
}
