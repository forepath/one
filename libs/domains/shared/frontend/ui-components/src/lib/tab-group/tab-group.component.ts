import {
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  DestroyRef,
  ElementRef,
  EnvironmentProviders,
  inject,
  InjectionToken,
  Injector,
  input,
  makeEnvironmentProviders,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { FpcDropdownComponent } from '../dropdown/dropdown.component';
import { FpcDropdownItemComponent } from '../dropdown-item/dropdown-item.component';
import { FpcTabComponent } from '../tab/tab.component';

/** Texts of `fpc-tab-group`; provide them once per app (localized) with `provideFpcTabGroupLabels()`. */
export interface FpcTabGroupLabels {
  /** Trailing overflow item of a horizontal bar ("More ▾"). */
  more: string;
}

const DEFAULT_TAB_GROUP_LABELS: FpcTabGroupLabels = { more: 'More' };

export const FPC_TAB_GROUP_LABELS = new InjectionToken<FpcTabGroupLabels>('FPC_TAB_GROUP_LABELS', {
  providedIn: 'root',
  factory: () => DEFAULT_TAB_GROUP_LABELS,
});

/** App-wide (localized) tab-group texts, e.g. in `app.config.ts` with `$localize`. The `moreLabel` input still wins. */
export function provideFpcTabGroupLabels(labels: Partial<FpcTabGroupLabels>): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: FPC_TAB_GROUP_LABELS, useValue: { ...DEFAULT_TAB_GROUP_LABELS, ...labels } },
  ]);
}

/** Measured natural width of one tab item (px). */
export interface FpcTabOverflowItem {
  id: string;
  width: number;
}

/** Sub-pixel slack: rounded layout widths must not push the last tab into the menu. */
const FIT_TOLERANCE = 0.5;

/**
 * Splits a horizontal tab bar into the tabs shown in the bar and the ones listed in the trailing "More" menu.
 * Everything fits → all visible. Otherwise the leading tabs that fit next to the More item stay (in order); the active
 * tab is always visible: when it would overflow it takes the last visible slot(s) (it shows just before More, like
 * the Agenstra editor brings a picked file into its tab strip). Returns ids in tab order.
 */
export function fpcSplitTabOverflow(
  items: readonly FpcTabOverflowItem[],
  available: number,
  moreWidth: number,
  activeId: string | null,
): { visible: string[]; hidden: string[] } {
  const ids = items.map((item) => item.id);
  const total = items.reduce((sum, item) => sum + item.width, 0);

  if (items.length === 0 || available <= 0 || total <= available + FIT_TOLERANCE) {
    return { visible: ids, hidden: [] };
  }

  const budget = available - moreWidth + FIT_TOLERANCE;
  const shown: FpcTabOverflowItem[] = [];
  let used = 0;

  for (const item of items) {
    if (used + item.width > budget) {
      break;
    }

    shown.push(item);
    used += item.width;
  }

  const active = activeId ? items.find((item) => item.id === activeId) : undefined;

  if (active && !shown.includes(active)) {
    while (shown.length > 0 && used + active.width > budget) {
      used -= shown.pop()?.width ?? 0;
    }

    shown.push(active);
  }

  if (shown.length === 0) {
    shown.push(items[0]);
  }

  const visibleIds = new Set(shown.map((item) => item.id));

  return { visible: ids.filter((id) => visibleIds.has(id)), hidden: ids.filter((id) => !visibleIds.has(id)) };
}

/**
 * Renders a tab bar for the projected `fpc-tab` children and keeps exactly one of them active.
 * Falls back to the first enabled tab when `activeId` is unset or invalid.
 *
 * `orientation="vertical"` lays out a left-hand tab list with section headings (via each tab's
 * optional `section` input) beside the active panel - suitable for settings-style UIs.
 *
 * Horizontal bars never scroll sideways: while every tab fits they are equal-width columns; otherwise the tabs that
 * don't fit move into a trailing "More ▾" item (same chrome as a tab, count badge) that opens a body-portaled
 * `fpc-dropdown` with them (icon, label, badge). The active tab always stays in the bar; picking a tab from the menu
 * activates it and brings it into the bar. Widths are measured (ResizeObserver on the host, re-measured when tabs,
 * labels, badges or the active tab change, and once the web fonts are in). Label: `moreLabel` input or
 * `provideFpcTabGroupLabels({ more })`.
 *
 * Selection sync runs in `afterRenderEffect` so projected tab `id` inputs are bound before we
 * read them (`contentChildren` can otherwise surface instances too early - NG0950).
 */
@Component({
  selector: 'fpc-tab-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-tab-group',
    '[class.fpc-tab-group--vertical]': 'orientation() === "vertical"',
    '[class.fpc-tab-group--horizontal]': 'orientation() === "horizontal"',
    '[class.fpc-tab-group--stretch]': 'stretch()',
  },
  template: `
    <div
      #bar
      class="btn-group btn-group-options fpc-tab-group__bar"
      [class.w-100]="orientation() === 'horizontal'"
      [class.fpc-tab-group__bar--overflowing]="hiddenTabs().length > 0"
      role="tablist"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-orientation]="orientation()"
    >
      @for (group of sectionedTabs(); track group.section ?? '__root__') {
        @if (group.section) {
          <div class="fpc-tab-group__section-title" role="presentation">{{ group.section }}</div>
        }
        @for (tab of group.tabs; track tab) {
          <div
            class="fpc-tab-group__item"
            [attr.data-fpc-tab-id]="tab.id()"
            [class.fpc-tab-group__item--active]="tab.id() === activeId()"
            [class.fpc-tab-group__item--has-action]="!!tab.actionIcon()"
            [class.fpc-tab-group__item--overflow]="hiddenIds().has(tab.id())"
          >
            <button
              type="button"
              class="btn btn-options"
              role="tab"
              [id]="'fpc-tab-' + tab.id()"
              [class.active]="tab.id() === activeId()"
              [attr.aria-selected]="tab.id() === activeId()"
              [attr.aria-controls]="'fpc-tabpanel-' + tab.id()"
              [disabled]="tab.disabled()"
              (click)="selectTab(tab)"
              (mouseenter)="syncOverflowTitle($event, tab)"
              (focus)="syncOverflowTitle($event, tab)"
            >
              @if (tab.icon()) {
                <i class="bi bi-{{ tab.icon() }}" aria-hidden="true"></i>
              }
              <span class="fpc-tab-group__label">{{ tab.label() }}</span>
              @if (tab.badge()) {
                <span
                  class="badge rounded-pill text-bg-secondary fpc-tab-group__badge"
                  [attr.aria-label]="tab.badgeLabel() || null"
                  >{{ tab.badge() }}</span
                >
              }
            </button>
            @if (tab.actionIcon()) {
              <button
                type="button"
                class="fpc-tab-group__action btn btn-link"
                [class.text-warning]="tab.actionPressed()"
                [attr.aria-pressed]="tab.actionPressed()"
                [attr.aria-label]="tab.actionAriaLabel() || null"
                [title]="tab.actionTitle() || tab.actionAriaLabel() || null"
                (click)="onTabAction(tab, $event)"
              >
                <i class="bi bi-{{ tab.actionIcon() }}" aria-hidden="true"></i>
              </button>
            }
          </div>
        }
      }
      @if (orientation() === 'horizontal') {
        <!-- Overflow (LW-11, like the Agenstra editor's open files): tabs that don't fit go into a trailing "More" menu. -->
        <div class="fpc-tab-group__item fpc-tab-group__item--more" role="presentation">
          <fpc-dropdown appendTo="body" alignment="end" [(open)]="moreOpen">
            <button
              fpcDropdownTrigger
              type="button"
              class="btn btn-options fpc-tab-group__more"
              aria-haspopup="menu"
              [attr.aria-expanded]="moreOpen()"
              [attr.tabindex]="hiddenTabs().length > 0 ? null : -1"
            >
              <span class="fpc-tab-group__label">{{ resolvedMoreLabel() }}</span>
              <span class="badge rounded-pill text-bg-secondary fpc-tab-group__badge" aria-hidden="true">{{
                hiddenTabs().length
              }}</span>
              <i class="bi bi-chevron-down fpc-tab-group__more-caret" aria-hidden="true"></i>
            </button>
            @for (tab of hiddenTabs(); track tab) {
              <fpc-dropdown-item [icon]="tab.icon()" [disabled]="tab.disabled()" (selected)="selectFromMore(tab)">
                {{ tab.label() }}
                @if (tab.badge()) {
                  <span
                    fpcDropdownItemEnd
                    class="badge rounded-pill text-bg-secondary"
                    [attr.aria-label]="tab.badgeLabel() || null"
                    >{{ tab.badge() }}</span
                  >
                }
              </fpc-dropdown-item>
            }
          </fpc-dropdown>
        </div>
      }
    </div>

    <div class="fpc-tab-group__panels">
      <ng-content />
    </div>
  `,
  imports: [FpcDropdownComponent, FpcDropdownItemComponent],
  styleUrl: './tab-group.component.scss',
})
export class FpcTabGroupComponent {
  readonly activeId = model<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  /**
   * Vertical only: the tab list fills its container (width and height) instead of the fixed 14rem rail — for a side
   * nav that lives in a resizable column (e.g. the start pane of `fpc-split-pane`); no own right border.
   */
  readonly stretch = input(false, { transform: booleanAttribute });
  /** Label of the trailing overflow item (horizontal); default from `FPC_TAB_GROUP_LABELS` ("More"). */
  readonly moreLabel = input<string | null>(null);

  private readonly labels = inject(FPC_TAB_GROUP_LABELS);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly tabs = contentChildren(FpcTabComponent);
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');

  protected readonly resolvedMoreLabel = computed(() => this.moreLabel() || this.labels.more);
  protected readonly moreOpen = signal(false);
  /** Ids of the tabs currently listed in the "More" menu (horizontal overflow). */
  protected readonly hiddenIds = signal<ReadonlySet<string>>(new Set());

  /** Tabs whose `id` binding is available (filters the pre-bind contentChildren window). */
  protected readonly readyTabs = computed(() => this.tabs().filter((tab) => !!tab.id()));

  protected readonly sectionedTabs = computed(() => {
    const groups: Array<{ section: string | null; tabs: FpcTabComponent[] }> = [];

    for (const tab of this.readyTabs()) {
      const section = tab.section() || null;
      const last = groups[groups.length - 1];

      if (last && last.section === section) {
        last.tabs.push(tab);
      } else {
        groups.push({ section, tabs: [tab] });
      }
    }

    return groups;
  });

  protected readonly hiddenTabs = computed(() => {
    const hidden = this.hiddenIds();

    return hidden.size === 0 ? [] : this.readyTabs().filter((tab) => hidden.has(tab.id()));
  });

  constructor() {
    afterRenderEffect(() => {
      const tabs = this.readyTabs();

      if (tabs.length === 0) {
        return;
      }

      const requested = this.activeId();
      const isValid = tabs.some((tab) => tab.id() === requested && !tab.disabled());
      const resolved = isValid ? requested : (tabs.find((tab) => !tab.disabled())?.id() ?? null);

      if (resolved !== requested) {
        this.activeId.set(resolved);
      }

      tabs.forEach((tab) => tab.active.set(tab.id() === resolved));
    });

    // Horizontal overflow: re-measure whenever the tabs, their labels / icons / badges or the active tab change.
    afterRenderEffect(() => {
      if (this.orientation() !== 'horizontal') {
        if (untracked(this.hiddenIds).size > 0) {
          this.hiddenIds.set(new Set());
        }

        return;
      }

      this.activeId();

      for (const tab of this.readyTabs()) {
        tab.label();
        tab.icon();
        tab.badge();
        tab.actionIcon();
      }

      this.resolvedMoreLabel();
      untracked(() => this.measureOverflow());
    });

    const view = this.host.nativeElement.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    const Observer = view?.ResizeObserver;

    if (Observer) {
      const observer = new Observer(() => this.measureOverflow());

      observer.observe(this.host.nativeElement);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }

    // Labels widen once the web fonts are in: measure again then.
    this.host.nativeElement.ownerDocument.fonts?.ready.then(() => this.measureOverflow());
  }

  /**
   * Measures the horizontal bar and moves the tabs that don't fit into the "More" menu. Runs on resize and on tab
   * changes; call it after an outside change that alters a tab's width without changing its inputs.
   */
  measureOverflow(): void {
    const bar = this.bar()?.nativeElement;

    if (!bar || this.orientation() !== 'horizontal') {
      return;
    }

    const available = bar.clientWidth;

    // Not laid out (hidden tab, detached): keep the last split until the ResizeObserver reports a size.
    if (available <= 0) {
      return;
    }

    // Natural widths: every item (also the hidden ones and the More item) at its content width, read synchronously in
    // one layout pass before paint, so the measuring state never shows.
    bar.classList.add('fpc-tab-group__bar--measuring');

    const items: FpcTabOverflowItem[] = [];
    let moreWidth = 0;

    try {
      for (const element of Array.from(bar.children) as HTMLElement[]) {
        const id = element.getAttribute('data-fpc-tab-id');

        if (id) {
          items.push({ id, width: element.getBoundingClientRect().width });
        } else if (element.classList.contains('fpc-tab-group__item--more')) {
          moreWidth = element.getBoundingClientRect().width;
        }
      }
    } finally {
      bar.classList.remove('fpc-tab-group__bar--measuring');
    }

    const { hidden } = fpcSplitTabOverflow(items, available, moreWidth, this.activeId());
    const current = this.hiddenIds();

    if (hidden.length !== current.size || hidden.some((id) => !current.has(id))) {
      this.hiddenIds.set(new Set(hidden));
    }

    if (hidden.length === 0 && this.moreOpen()) {
      this.moreOpen.set(false);
    }
  }

  /** A tab picked from "More": activate it; once it is in the bar, focus it (the menu closed, focus would be lost). */
  protected selectFromMore(tab: FpcTabComponent): void {
    this.selectTab(tab);
    afterNextRender(
      () => {
        this.measureOverflow();
        afterNextRender(
          () =>
            Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]'))
              .find((button) => button.id === `fpc-tab-${tab.id()}`)
              ?.focus(),
          { injector: this.injector },
        );
      },
      { injector: this.injector },
    );
  }

  protected selectTab(tab: FpcTabComponent): void {
    const id = tab.id();

    if (tab.disabled() || !id) {
      return;
    }

    this.activeId.set(id);
    tab.selected.emit(id);
  }

  /** A truncated label (narrow vertical rails) shows the full label as a tooltip, only while it is cut off. */
  protected syncOverflowTitle(event: Event, tab: FpcTabComponent): void {
    const button = event.currentTarget as HTMLElement | null;
    const label = button?.querySelector<HTMLElement>('.fpc-tab-group__label');

    if (!button || !label) {
      return;
    }

    if (label.scrollWidth > label.clientWidth) {
      button.title = tab.label();
    } else {
      button.removeAttribute('title');
    }
  }

  protected onTabAction(tab: FpcTabComponent, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    tab.action.emit();
  }
}
