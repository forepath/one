import { InjectionToken, type Provider } from '@angular/core';
import type { ActionCenterGroup, ActionCenterItem } from '@forepath/shared/frontend/data-access-action-center';

/** In-app target of a to-do; the console switches into the target's mode (user / administration) on navigation. */
export interface ActionCenterLink {
  commands: readonly unknown[];
  queryParams?: Record<string, string | number | boolean | null | undefined>;
}

/** Locale-aware formatting for presenter texts. */
export interface ActionCenterFormat {
  locale: string;
  money(value: string | number | null | undefined, currency: string | null | undefined): string;
  date(value: string | Date | null | undefined): string;
  relative(value: string | Date | null | undefined): string;
  number(value: string | number | null | undefined): string;
}

/** Item / group parameter as a display string (`''` when missing). */
export function paramText(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];

  return value === null || value === undefined ? '' : String(value);
}

/**
 * How one item type looks and where it leads. Texts are localized by the application (`$localize`), so presenters
 * are created in a factory (see {@link provideActionCenterPresenters}).
 */
export interface ActionCenterPresenter {
  /** Bootstrap icon name without the `bi-` prefix. */
  icon: string;
  /** Short group title ("Invoices not sent yet"). */
  title: string;
  /** What to do about it (one sentence). */
  description?: string | ((group: ActionCenterGroup, format: ActionCenterFormat) => string);
  /** The page listing all records of the group. */
  link?: (group: ActionCenterGroup) => ActionCenterLink | null;
  /** Label of the group action button (default: "Open"). */
  actionLabel?: string;
  /** Title of one record (e.g. the invoice number). */
  itemTitle?: (item: ActionCenterItem, format: ActionCenterFormat) => string;
  /** Secondary line of one record (customer, amount, due date ...). */
  itemMeta?: (item: ActionCenterItem, format: ActionCenterFormat) => string | null;
  /** Deep link of one record (defaults to the group link). */
  itemLink?: (item: ActionCenterItem, group: ActionCenterGroup) => ActionCenterLink | null;
}

/** Presenters and category headings contributed by one application or library. */
export interface ActionCenterPresenterSet {
  categories?: Readonly<Record<string, string>>;
  types: Readonly<Record<string, ActionCenterPresenter>>;
}

export const ACTION_CENTER_PRESENTERS = new InjectionToken<readonly ActionCenterPresenterSet[]>(
  'ActionCenterPresenters',
);

/**
 * Contribute presenters. The factory runs in an injection context after the locale is loaded, so `$localize` texts
 * are translated.
 */
export function provideActionCenterPresenters(factory: () => ActionCenterPresenterSet): Provider {
  return { provide: ACTION_CENTER_PRESENTERS, useFactory: factory, multi: true };
}
