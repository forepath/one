import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  InjectionToken,
  input,
  makeEnvironmentProviders,
  model,
  output,
  signal,
  viewChild,
  type EnvironmentProviders,
} from '@angular/core';

import { DOCUMENT } from '@angular/common';

import { FpcBadgeComponent } from '../badge/badge.component';
import { FPC_OVERLAY_PORTAL, FpcBodyPortal } from '../overlay/body-portal';
import { FpcFilterChip, FpcFilterChipsComponent } from '../filter-chips/filter-chips.component';

/** Texts of `fpc-list-toolbar`; provide them once per app (localized) with `provideFpcListToolbarLabels()`. */
export interface FpcListToolbarLabels {
  filters: string;
  clearAll: string;
  activeFilters: string;
  removeFilter: string;
}

export const FPC_LIST_TOOLBAR_LABELS = new InjectionToken<FpcListToolbarLabels>('FPC_LIST_TOOLBAR_LABELS', {
  providedIn: 'root',
  factory: () => ({
    filters: 'Filters',
    clearAll: 'Clear all',
    activeFilters: 'Active filters',
    removeFilter: 'Remove filter',
  }),
});

/** App-wide (localized) list-toolbar texts, e.g. in `app.config.ts` with `$localize`. Inputs still win. */
export function provideFpcListToolbarLabels(labels: Partial<FpcListToolbarLabels>): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: FPC_LIST_TOOLBAR_LABELS,
      useValue: {
        filters: 'Filters',
        clearAll: 'Clear all',
        activeFilters: 'Active filters',
        removeFilter: 'Remove filter',
        ...labels,
      },
    },
  ]);
}

/** Clicks inside these (body-portaled menus, list boxes, dialogs opened from a filter) don't close the drawer. */
const OVERLAY_SELECTOR = '.dropdown-menu, [role="listbox"], [role="menu"], .modal, .fpc-modal, .fpc-context-menu';

/**
 * The list toolbar strip (3.38 R12): the one search / filter pattern of every list in all apps.
 *
 * One flush row: `[fpcListToolbarLead]` (the list's `fpc-search-field`: unbordered, grows, live-debounced by the
 * consumer: search is not a filter) → active filter `chips` (removable) → **Filters** toggle (funnel, label, count
 * badge of the *applied* filters, chevron) → **Clear all** (only while filters / chips are applied) →
 * `[fpcListToolbarActions]` (Views ▾, column chooser, Refresh: quiet `.fpc-toolbar-btn` controls like the toggle). With
 * `filterable="false"` the toggle and the drawer go away and the same strip is a plain search strip.
 *
 * The drawer (default content) overlays the list below the strip; its fields sit in a `.fpc-filter-grid`
 * (`repeat(auto-fit, minmax(14rem, 1fr))`, labels above via `fpc-form-field`). Filters apply **live** (user,
 * 2026-10-29; no Apply button, no drawer footer): every `change` in the drawer emits `applied` right away, typing
 * (`input`) after a short debounce; Enter in a field applies and closes the drawer. Esc / outside click close it,
 * focus returns to the toggle. Keep values and the URL in sync with `fpcListQueryState()` (its `patch` applies too,
 * which also covers controls whose menus render outside the drawer).
 */
@Component({
  selector: 'fpc-list-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent, FpcFilterChipsComponent],
  host: {
    class: 'fpc-list-toolbar',
    '[class.fpc-list-toolbar--open]': 'filterable() && open()',
    '(document:keydown.escape)': 'onEscape()',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
  template: `
    <div class="fpc-list-toolbar__strip">
      <div class="fpc-list-toolbar__lead"><ng-content select="[fpcListToolbarLead]" /></div>
      @if (chips().length > 0) {
        <fpc-filter-chips
          class="fpc-list-toolbar__chips"
          [chips]="chips()"
          clearLabel=""
          [ariaLabel]="text().chips"
          [removeLabel]="text().removeChip"
          (removeChip)="chipRemove.emit($event)"
        />
      }
      @if (filterable()) {
        <button
          #toggleButton
          type="button"
          class="btn btn-link fpc-toolbar-btn fpc-list-toolbar__toggle"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="bodyId"
          [title]="text().title"
          [attr.aria-label]="activeCount() > 0 ? text().title + ' (' + activeCount() + ')' : text().title"
          (click)="toggle()"
          data-testid="fpc-list-toolbar-toggle"
        >
          <!-- Icon only (user): funnel + applied-filter count + chevron; the label is title / aria-label. -->
          <i class="bi bi-funnel" aria-hidden="true"></i>
          @if (activeCount() > 0) {
            <fpc-badge color="primary" [pill]="true" aria-hidden="true">{{ activeCount() }}</fpc-badge>
          }
          <i class="bi" [class.bi-chevron-down]="!open()" [class.bi-chevron-up]="open()" aria-hidden="true"></i>
        </button>
      }
      @if (showClear() && (activeCount() > 0 || chips().length > 0)) {
        <button
          type="button"
          class="btn btn-link fpc-toolbar-btn fpc-list-toolbar__clear"
          [title]="text().clear"
          [attr.aria-label]="text().clear"
          (click)="cleared.emit()"
          data-testid="fpc-list-toolbar-clear"
        >
          <!-- Icon only (user): a struck-through funnel ("no filters"); Bootstrap Icons has no funnel-slash glyph. -->
          <span class="fpc-list-toolbar__clear-icon" aria-hidden="true"><i class="bi bi-funnel"></i></span>
        </button>
      }
      <div class="fpc-list-toolbar__actions"><ng-content select="[fpcListToolbarActions]" /></div>
    </div>

    @if (filterable() && open()) {
      <!-- Portaled to <body> where the app enables overlay portals: a drawer opened from a sticky table head or a
           scrolling lane is never clipped or covered (fixed below the strip, the strip's width). -->
      <div
        #drawer
        class="fpc-list-toolbar__body"
        [class.fpc-list-toolbar__body--portaled]="portaled"
        role="region"
        [id]="bodyId"
        [attr.aria-label]="text().title"
        [style.max-height.px]="bodyMaxHeightPx()"
        [style.top.px]="portaled ? bodyRect()?.top : null"
        [style.left.px]="portaled ? bodyRect()?.left : null"
        [style.width.px]="portaled ? bodyRect()?.width : null"
        (keydown.enter)="onEnter($event)"
        (input)="onFieldInput()"
        (change)="onFieldChange()"
      >
        <div class="fpc-list-toolbar__fields">
          <div class="fpc-filter-grid"><ng-content /></div>
        </div>
      </div>
    }
  `,
  styleUrl: './list-toolbar.component.scss',
})
export class FpcListToolbarComponent {
  private static nextId = 0;

  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toggleButton = viewChild<ElementRef<HTMLButtonElement>>('toggleButton');
  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');
  private readonly portal = new FpcBodyPortal(inject(DOCUMENT));
  /** The drawer renders at `<body>` level (apps with `provideFpcOverlayPortal()`; specs keep it inline). */
  protected readonly portaled = inject(FPC_OVERLAY_PORTAL);
  /** Fixed position of the portaled drawer (below the strip, its width). */
  protected readonly bodyRect = signal<{ top: number; left: number; width: number } | null>(null);

  /** Drawer open state (an overlay: not persisted). */
  readonly open = model(false);
  /** `false`: search-only strip (no Filters toggle, no drawer). */
  readonly filterable = input(true, { transform: booleanAttribute });
  /** Toggle label (default: the app's `FPC_LIST_TOOLBAR_LABELS.filters`). */
  readonly title = input<string | null>(null);
  /** Number of **applied** filters (count badge). */
  readonly activeCount = input(0);
  /** Applied filters as removable chips inline in the strip. */
  readonly chips = input<readonly FpcFilterChip[]>([]);
  readonly showClear = input(true, { transform: booleanAttribute });
  readonly clearLabel = input<string | null>(null);
  readonly chipsLabel = input<string | null>(null);
  readonly removeChipLabel = input<string | null>(null);

  private readonly labels = inject(FPC_LIST_TOOLBAR_LABELS);
  protected readonly text = computed(() => ({
    title: this.title() ?? this.labels.filters,
    clear: this.clearLabel() ?? this.labels.clearAll,
    chips: this.chipsLabel() ?? this.labels.activeFilters,
    removeChip: this.removeChipLabel() ?? this.labels.removeFilter,
  }));

  /** Live apply (a drawer field changed; typing debounced; Enter): copy the drawer's values to the applied filters. */
  readonly applied = output<void>();
  /** Clear all: reset the applied filters (and chips). */
  readonly cleared = output<void>();
  readonly chipRemove = output<FpcFilterChip>();

  /** Remaining viewport pixels below the host; drives body `max-height`. */
  protected readonly bodyMaxHeightPx = signal<number | null>(null);

  protected readonly bodyId = `fpc-list-toolbar-${FpcListToolbarComponent.nextId++}`;

  constructor() {
    afterRenderEffect(() => {
      const drawer = this.drawer()?.nativeElement;

      if (!this.open() || !drawer) {
        this.bodyMaxHeightPx.set(null);
        this.portal.dispose();
        return;
      }

      if (this.portaled) this.portal.attach(drawer);
      this.syncBodyMaxHeight();
    });
    this.destroyRef.onDestroy(() => {
      this.portal.dispose();
      this.cancelPendingInput();
    });

    const onViewportChange = (): void => {
      if (this.open()) {
        this.syncBodyMaxHeight();
      }
    };

    window.addEventListener('resize', onViewportChange);
    // Capture scrolls from nested overflow containers that move this host.
    window.addEventListener('scroll', onViewportChange, true);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
    });
  }

  /** Typing in a drawer field: apply after this pause (ms). */
  private static readonly INPUT_DEBOUNCE_MS = 300;
  private inputTimer: ReturnType<typeof setTimeout> | null = null;

  /** Applies the drawer now (also callable from a parent), closes it and returns focus to the toggle. */
  apply(): void {
    this.cancelPendingInput();
    this.applied.emit();
    this.close(true);
  }

  /** Text-like fields: apply once typing pauses (the field's own listener has updated the value by then). */
  protected onFieldInput(): void {
    this.cancelPendingInput();
    this.inputTimer = setTimeout(() => {
      this.inputTimer = null;
      this.applied.emit();
    }, FpcListToolbarComponent.INPUT_DEBOUNCE_MS);
  }

  /** Selects, check boxes, dates, committed text: apply right away (after the field's own handlers ran). */
  protected onFieldChange(): void {
    this.cancelPendingInput();
    setTimeout(() => this.applied.emit());
  }

  private cancelPendingInput(): void {
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = null;
  }

  protected toggle(): void {
    this.open.set(!this.open());
  }

  protected onEnter(event: Event): void {
    const target = event.target as HTMLElement | null;

    if (!target || target.closest('textarea, button, a, [contenteditable="true"]')) return;

    event.preventDefault();
    this.apply();
  }

  protected onEscape(): void {
    if (this.open()) this.close(true);
  }

  protected onDocumentPointerDown(event: Event): void {
    if (!this.open()) return;

    const target = event.target as Element | null;

    if (
      !target ||
      this.hostRef.nativeElement.contains(target) ||
      this.drawer()?.nativeElement.contains(target) ||
      target.closest?.(OVERLAY_SELECTOR)
    )
      return;

    this.close(false);
  }

  private close(returnFocus: boolean): void {
    this.open.set(false);

    if (returnFocus) this.toggleButton()?.nativeElement.focus();
  }

  private syncBodyMaxHeight(): void {
    const rect = this.hostRef.nativeElement.getBoundingClientRect();
    const hostBottom = rect.bottom;
    const viewport = window.visualViewport;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const availablePx = Math.max(0, Math.floor(viewportBottom - hostBottom));

    this.bodyMaxHeightPx.set(availablePx);
    if (this.portaled) {
      const current = this.bodyRect();

      if (!current || current.top !== hostBottom || current.left !== rect.left || current.width !== rect.width)
        this.bodyRect.set({ top: hostBottom, left: rect.left, width: rect.width });
    }
  }
}
