import { Injectable, LOCALE_ID, inject } from '@angular/core';
import type { ActionCenterGroup, ActionCenterItem } from '@forepath/shared/frontend/data-access-action-center';
import {
  fpcFormatDate,
  fpcFormatMoney,
  fpcFormatNumber,
  fpcFormatRelative,
} from '@forepath/shared/frontend/ui-components';

import {
  ACTION_CENTER_PRESENTERS,
  type ActionCenterFormat,
  type ActionCenterLink,
  type ActionCenterPresenter,
} from './action-center-presenter.types';

/**
 * Resolves presenters / category headings and renders group and item texts. Provided by `provideActionCenter()` in
 * the same injector as the presenters (route providers are not visible to root services).
 */
@Injectable()
export class ActionCenterPresentersService {
  private readonly locale = inject(LOCALE_ID);
  private readonly sets = inject(ACTION_CENTER_PRESENTERS, { optional: true }) ?? [];
  private readonly types = new Map<string, ActionCenterPresenter>();
  private readonly categories = new Map<string, string>();

  readonly format: ActionCenterFormat = {
    locale: this.locale,
    money: (value, currency) => fpcFormatMoney(value, currency, this.locale),
    date: (value) => fpcFormatDate(value ?? null, this.locale),
    relative: (value) => fpcFormatRelative(value ?? null, this.locale),
    number: (value) => fpcFormatNumber(value, this.locale),
  };

  constructor() {
    for (const set of this.sets) {
      for (const [type, presenter] of Object.entries(set.types)) {
        this.types.set(type, presenter);
      }

      for (const [category, label] of Object.entries(set.categories ?? {})) {
        this.categories.set(category, label);
      }
    }
  }

  /** The presenter of a type; unknown types (e.g. a newer backend) get a neutral fallback with the raw type. */
  presenter(type: string): ActionCenterPresenter {
    return this.types.get(type) ?? { icon: 'bell', title: type };
  }

  categoryLabel(category: string): string {
    return this.categories.get(category) ?? category;
  }

  title(group: ActionCenterGroup): string {
    return this.presenter(group.type).title;
  }

  description(group: ActionCenterGroup): string | null {
    const description = this.presenter(group.type).description;

    return typeof description === 'function' ? description(group, this.format) : (description ?? null);
  }

  groupLink(group: ActionCenterGroup): ActionCenterLink | null {
    return this.presenter(group.type).link?.(group) ?? null;
  }

  itemTitle(group: ActionCenterGroup, item: ActionCenterItem): string {
    return this.presenter(group.type).itemTitle?.(item, this.format) || this.presenter(group.type).title;
  }

  itemMeta(group: ActionCenterGroup, item: ActionCenterItem): string | null {
    return this.presenter(group.type).itemMeta?.(item, this.format) || null;
  }

  itemLink(group: ActionCenterGroup, item: ActionCenterItem): ActionCenterLink | null {
    const presenter = this.presenter(group.type);

    return presenter.itemLink?.(item, group) ?? presenter.link?.(group) ?? null;
  }
}
