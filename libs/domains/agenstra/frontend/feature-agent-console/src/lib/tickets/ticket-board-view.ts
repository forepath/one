import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/** The two views of a ticket overview: the data table (default) or the kanban lanes. */
export type TicketBoardView = 'table' | 'lanes';

export const TICKET_BOARD_VIEW_PARAM = 'view';
export const TICKET_BOARD_VIEW_STORAGE_KEY = 'agenstra-tickets-view';

export function parseTicketBoardView(value: string | null | undefined): TicketBoardView | null {
  return value === 'table' || value === 'lanes' ? value : null;
}

function readStoredView(key: string): TicketBoardView | null {
  try {
    return parseTicketBoardView(globalThis.localStorage?.getItem(key));
  } catch {
    return null;
  }
}

function storeView(key: string, view: TicketBoardView): void {
  try {
    globalThis.localStorage?.setItem(key, view);
  } catch {
    // Storage unavailable (private mode / quota): the URL still carries the view.
  }
}

export interface TicketBoardViewState {
  readonly view: Signal<TicketBoardView>;
  /** Switches the view, remembers it per user (localStorage) and writes `view=` into the URL. */
  set(view: TicketBoardView): void;
}

/**
 * Table | Lanes view of a ticket overview (injection context). Priority: URL `view=` → localStorage → `table`.
 * Back / forward and shared links follow the URL; the switch writes both.
 */
export function ticketBoardViewState(storageKey = TICKET_BOARD_VIEW_STORAGE_KEY): TicketBoardViewState {
  const router = inject(Router, { optional: true });
  const route = inject(ActivatedRoute, { optional: true });
  const fromUrl = parseTicketBoardView(route?.snapshot?.queryParamMap.get(TICKET_BOARD_VIEW_PARAM));
  const view = signal<TicketBoardView>(fromUrl ?? readStoredView(storageKey) ?? 'table');

  if (fromUrl) storeView(storageKey, fromUrl);

  const subscription = route?.queryParamMap.subscribe((params) => {
    const next = parseTicketBoardView(params.get(TICKET_BOARD_VIEW_PARAM));

    if (next && next !== view()) {
      view.set(next);
      storeView(storageKey, next);
    }
  });

  inject(DestroyRef).onDestroy(() => subscription?.unsubscribe());

  return {
    view: view.asReadonly(),
    set(next: TicketBoardView): void {
      view.set(next);
      storeView(storageKey, next);
      void router?.navigate([], {
        relativeTo: route ?? undefined,
        queryParams: { [TICKET_BOARD_VIEW_PARAM]: next },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    },
  };
}
