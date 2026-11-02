import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/** The two views of a ticket overview: the data table (default) or the kanban lanes. */
export type ProjectBoardView = 'table' | 'lanes';

export const PROJECT_BOARD_VIEW_PARAM = 'view';
export const PROJECT_BOARD_VIEW_STORAGE_KEY = 'decabill-project-board-view';

export function parseProjectBoardView(value: string | null | undefined): ProjectBoardView | null {
  return value === 'table' || value === 'lanes' ? value : null;
}

function readStoredView(key: string): ProjectBoardView | null {
  try {
    return parseProjectBoardView(globalThis.localStorage?.getItem(key));
  } catch {
    return null;
  }
}

function storeView(key: string, view: ProjectBoardView): void {
  try {
    globalThis.localStorage?.setItem(key, view);
  } catch {
    // Storage unavailable (private mode / quota): the URL still carries the view.
  }
}

export interface ProjectBoardViewState {
  readonly view: Signal<ProjectBoardView>;
  /** Switches the view, remembers it per user (localStorage) and writes `view=` into the URL. */
  set(view: ProjectBoardView): void;
}

/**
 * Table | Lanes view of a ticket overview (injection context). Priority: URL `view=` → localStorage → `table`.
 * Back / forward and shared links follow the URL; the switch writes both.
 */
export function projectBoardViewState(storageKey = PROJECT_BOARD_VIEW_STORAGE_KEY): ProjectBoardViewState {
  const router = inject(Router, { optional: true });
  const route = inject(ActivatedRoute, { optional: true });
  const fromUrl = parseProjectBoardView(route?.snapshot?.queryParamMap.get(PROJECT_BOARD_VIEW_PARAM));
  const view = signal<ProjectBoardView>(fromUrl ?? readStoredView(storageKey) ?? 'table');

  if (fromUrl) storeView(storageKey, fromUrl);

  const subscription = route?.queryParamMap.subscribe((params) => {
    const next = parseProjectBoardView(params.get(PROJECT_BOARD_VIEW_PARAM));

    if (next && next !== view()) {
      view.set(next);
      storeView(storageKey, next);
    }
  });

  inject(DestroyRef).onDestroy(() => subscription?.unsubscribe());

  return {
    view: view.asReadonly(),
    set(next: ProjectBoardView): void {
      view.set(next);
      storeView(storageKey, next);
      void router?.navigate([], {
        relativeTo: route ?? undefined,
        queryParams: { [PROJECT_BOARD_VIEW_PARAM]: next },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    },
  };
}
