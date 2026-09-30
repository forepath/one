import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  input,
  model,
} from '@angular/core';

import { FpcTabComponent } from '../tab/tab.component';

/**
 * Renders a tab bar for the projected `fpc-tab` children and keeps exactly one of them active.
 * Falls back to the first enabled tab when `activeId` is unset or invalid.
 *
 * `orientation="vertical"` lays out a left-hand tab list with section headings (via each tab's
 * optional `section` input) beside the active panel — suitable for settings-style UIs.
 *
 * Selection sync runs in `afterRenderEffect` so projected tab `id` inputs are bound before we
 * read them (`contentChildren` can otherwise surface instances too early — NG0950).
 */
@Component({
  selector: 'fpc-tab-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-tab-group',
    '[class.fpc-tab-group--vertical]': 'orientation() === "vertical"',
    '[class.fpc-tab-group--horizontal]': 'orientation() === "horizontal"',
  },
  template: `
    <div
      class="btn-group btn-group-options fpc-tab-group__bar"
      [class.w-100]="orientation() === 'horizontal'"
      role="tablist"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-orientation]="orientation()"
    >
      @for (group of sectionedTabs(); track group.section ?? '__root__') {
        @if (group.section) {
          <div class="fpc-tab-group__section-title" role="presentation">{{ group.section }}</div>
        }
        @for (tab of group.tabs; track tab) {
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
          >
            @if (tab.icon()) {
              <i class="bi bi-{{ tab.icon() }}" aria-hidden="true"></i>
            }
            <span>{{ tab.label() }}</span>
          </button>
        }
      }
    </div>

    <div class="fpc-tab-group__panels">
      <ng-content />
    </div>
  `,
  styleUrl: './tab-group.component.scss',
})
export class FpcTabGroupComponent {
  readonly activeId = model<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');

  private readonly tabs = contentChildren(FpcTabComponent);

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
  }

  protected selectTab(tab: FpcTabComponent): void {
    const id = tab.id();

    if (tab.disabled() || !id) {
      return;
    }

    this.activeId.set(id);
    tab.selected.emit(id);
  }
}
