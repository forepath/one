import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import type { ActionCenterGroup, ActionCenterItem } from '@forepath/shared/frontend/data-access-action-center';
import { FpcBadgeComponent, FpcButtonComponent, type FpcBadgeColor } from '@forepath/shared/frontend/ui-components';

import {
  ActionCenterSilenceMenuComponent,
  type ActionCenterSilenceChoice,
} from '../action-center-silence-menu/action-center-silence-menu.component';
import type { ActionCenterLink } from '../presenters/action-center-presenter.types';
import { ActionCenterPresentersService } from '../presenters/action-center-presenters.service';

/** A silence request of a stack: the whole type (`itemId` null) or one item. */
export interface ActionCenterStackSilence extends ActionCenterSilenceChoice {
  itemType: string;
  itemId: string | null;
}

const SEVERITY_COLOR: Record<ActionCenterGroup['severity'], FpcBadgeColor> = {
  danger: 'danger',
  warning: 'warning',
  info: 'primary',
};

/**
 * One item type of the action center as a stack of cards: the top card shows the type, its count and the newest
 * record; more records sit visibly "below" it. Expanding lists the records with their own links and silence menus.
 * Setup suggestions (`highlight`) render as a single highlighted card.
 */
@Component({
  selector: 'shared-action-center-stack',
  standalone: true,
  imports: [FpcBadgeComponent, FpcButtonComponent, ActionCenterSilenceMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './action-center-stack.component.html',
  styleUrl: './action-center-stack.component.scss',
  host: {
    class: 'ac-stack',
    '[class.ac-stack--stacked]': 'stacked()',
    '[class.ac-stack--expanded]': 'expanded()',
    '[class.ac-stack--highlight]': 'highlight()',
    '[attr.data-severity]': 'group().severity',
    '[attr.data-type]': 'group().type',
    'data-testid': 'action-center-stack',
  },
})
export class ActionCenterStackComponent {
  private readonly presenters = inject(ActionCenterPresentersService);

  readonly group = input.required<ActionCenterGroup>();
  readonly canSilenceForEveryone = input(false);
  readonly disabled = input(false);
  /** Onboarding / configuration suggestion (highlighted, no item list). */
  readonly highlight = input(false);

  readonly navigate = output<ActionCenterLink>();
  readonly silence = output<ActionCenterStackSilence>();

  protected readonly expanded = signal(false);
  protected readonly showListLabel = $localize`:@@featureActionCenter-showList:Show list`;
  protected readonly collapseLabel = $localize`:@@featureActionCenter-collapse:Collapse`;
  protected readonly format = this.presenters.format;

  protected readonly presenter = computed(() => this.presenters.presenter(this.group().type));
  protected readonly title = computed(() => this.presenters.title(this.group()));
  protected readonly description = computed(() => this.presenters.description(this.group()));
  protected readonly groupLink = computed(() => this.presenters.groupLink(this.group()));
  protected readonly openItems = computed(() => this.group().items.filter((item) => item.silencedBy === null));
  protected readonly topItem = computed(() => this.openItems()[0] ?? null);
  /** Records beyond the listed ones (the panel lists up to 25; the linked page shows all). */
  protected readonly hiddenCount = computed(() => Math.max(0, this.group().openCount - this.openItems().length));
  protected readonly stacked = computed(() => !this.highlight() && this.group().openCount > 1 && !this.expanded());
  protected readonly badgeColor = computed(() => SEVERITY_COLOR[this.group().severity]);
  protected readonly canExpand = computed(() => !this.highlight() && this.openItems().length > 1);
  protected readonly actionLabel = computed(
    () =>
      this.presenter().actionLabel ??
      (this.highlight() ? $localize`:@@featureActionCenter-setUp:Set up` : $localize`:@@featureActionCenter-open:Open`),
  );
  protected readonly silenceGroupLabel = computed(
    () => $localize`:@@featureActionCenter-silenceGroupLabel:Silence "${this.title()}:title:"`,
  );

  protected itemTitle(item: ActionCenterItem): string {
    return this.presenters.itemTitle(this.group(), item);
  }

  protected itemMeta(item: ActionCenterItem): string | null {
    return this.presenters.itemMeta(this.group(), item);
  }

  protected itemLink(item: ActionCenterItem): ActionCenterLink | null {
    return this.presenters.itemLink(this.group(), item);
  }

  protected silenceItemLabel(item: ActionCenterItem): string {
    return $localize`:@@featureActionCenter-silenceItemLabel:Silence "${this.itemTitle(item)}:title:"`;
  }

  protected toggle(): void {
    if (this.canExpand()) {
      this.expanded.update((value) => !value);
    }
  }

  protected open(link: ActionCenterLink | null): void {
    if (link) {
      this.navigate.emit(link);
    }
  }

  protected silenceGroup(choice: ActionCenterSilenceChoice): void {
    this.silence.emit({ ...choice, itemType: this.group().type, itemId: null });
  }

  protected silenceItem(item: ActionCenterItem, choice: ActionCenterSilenceChoice): void {
    this.silence.emit({ ...choice, itemType: this.group().type, itemId: item.id });
  }
}
