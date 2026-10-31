import { inject, Injectable, Injector, signal, type Signal, type WritableSignal } from '@angular/core';
import {
  ConsoleEndpointService,
  ConsoleSavedViewsService,
  type SavedView,
} from '@forepath/loadweaver/frontend/data-access-console';
import { firstValueFrom } from 'rxjs';

import { apiErrorMessage } from '../workspace/workspace-draft.store';
import type { SavedViewState } from './saved-views';

/**
 * The caller's saved views per scope (3.37), server-side through `/views` (fleet mode: the verified person's, relayed
 * with the signed claim). Root service on root HTTP services only; every "Views ▾" of a scope shares one list.
 */
@Injectable({ providedIn: 'root' })
export class SavedViewsStore {
  private readonly injector = inject(Injector);
  /** Resolved on first use, so pages embedding "Views ▾" need no HTTP / environment setup until it talks to the API. */
  private get api(): ConsoleSavedViewsService {
    return this.injector.get(ConsoleSavedViewsService);
  }
  private readonly lists = new Map<string, WritableSignal<SavedView[]>>();

  /** The last failure (shown in the dropdown until the next action). */
  readonly error = signal<string | null>(null);

  views(scope: string): Signal<SavedView[]> {
    return this.list(scope).asReadonly();
  }

  /** Whether views can be stored here (not on the fleet views: fleet mode without an active cluster). */
  available(): boolean {
    // The endpoint service needs no HTTP / environment setup (pages embedding "Views ▾" stay testable without it).
    // Partial endpoint stubs (page tests) count as available.
    const endpoints: Partial<ConsoleEndpointService> = this.injector.get(ConsoleEndpointService);
    const refused = this.refusedCluster();

    if (refused && endpoints.activeClusterId?.() === refused) return false;

    return endpoints.hasClusterApi?.() ?? true;
  }

  /**
   * Fleet mode: the cluster whose relay refused the views (403 / 404 — views are personal and relayed only with the
   * signed identity claim to a cluster that trusts this fleet, LW-25). "Views ▾" hides there instead of failing on
   * every page; another cluster (or a reload) asks again.
   */
  private readonly refusedCluster = signal<string | null>(null);

  private refuse(error: unknown): boolean {
    const endpoints: Partial<ConsoleEndpointService> = this.injector.get(ConsoleEndpointService);
    const status = (error as { status?: number } | null)?.status;

    if (!endpoints.fleetMode || (status !== 403 && status !== 404)) return false;

    this.refusedCluster.set(endpoints.activeClusterId?.() ?? null);

    return true;
  }

  /** (Re)loads a scope's views; the cached list stays visible meanwhile (nothing to load without a cluster API). */
  async load(scope: string): Promise<void> {
    if (!this.available()) return;

    try {
      this.list(scope).set(sortViews(await firstValueFrom(this.api.list(scope))));
    } catch (error) {
      if (!this.refuse(error)) this.error.set(apiErrorMessage(error));
    }
  }

  /** Saves the state under `name`: a new view, or the existing view of that name gets the new state. */
  async save(scope: string, name: string, state: SavedViewState): Promise<SavedView | null> {
    const existing = this.list(scope)().find((view) => view.name === name);

    return await this.run(scope, () =>
      firstValueFrom(
        existing
          ? this.api.update(existing.id, { state: { ...state } })
          : this.api.create({ scope, name, state: { ...state } }),
      ),
    );
  }

  async rename(view: SavedView, name: string): Promise<SavedView | null> {
    return await this.run(view.scope, () => firstValueFrom(this.api.update(view.id, { name })));
  }

  async remove(view: SavedView): Promise<boolean> {
    this.error.set(null);

    try {
      await firstValueFrom(this.api.remove(view.id));
      this.list(view.scope).update((list) => list.filter((entry) => entry.id !== view.id));

      return true;
    } catch (error) {
      this.error.set(apiErrorMessage(error));

      return false;
    }
  }

  private list(scope: string): WritableSignal<SavedView[]> {
    let list = this.lists.get(scope);

    if (!list) {
      list = signal<SavedView[]>([]);
      this.lists.set(scope, list);
    }

    return list;
  }

  private async run(scope: string, call: () => Promise<SavedView>): Promise<SavedView | null> {
    this.error.set(null);

    try {
      const view = await call();

      this.list(scope).update((list) => sortViews([...list.filter((entry) => entry.id !== view.id), view]));

      return view;
    } catch (error) {
      this.error.set(apiErrorMessage(error));

      return null;
    }
  }
}

function sortViews(views: readonly SavedView[]): SavedView[] {
  return [...views].sort((a, b) => a.name.localeCompare(b.name));
}
