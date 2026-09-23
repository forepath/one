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
 * Renders a `btn-group-options` tab bar for the projected `fpc-tab` children and keeps exactly
 * one of them active. Falls back to the first enabled tab when `activeId` is unset or invalid.
 *
 * Selection sync runs in `afterRenderEffect` so projected tab `id` inputs are bound before we
 * read them (`contentChildren` can otherwise surface instances too early — NG0950).
 */
@Component({
  selector: 'fpc-tab-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-tab-group' },
  template: `
    <div class="btn-group btn-group-options fpc-tab-group__bar w-100" role="tablist" [attr.aria-label]="ariaLabel()">
      @for (tab of readyTabs(); track tab) {
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

  private readonly tabs = contentChildren(FpcTabComponent);

  /** Tabs whose `id` binding is available (filters the pre-bind contentChildren window). */
  protected readonly readyTabs = computed(() => this.tabs().filter((tab) => !!tab.id()));

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
