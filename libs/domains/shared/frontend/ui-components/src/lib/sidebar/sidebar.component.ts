import { DOCUMENT } from '@angular/common';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';

/** Below this width the rail is icon-only; expanding it then overlays the content instead of narrowing it. */
export const FPC_SIDEBAR_NARROW_QUERY = '(max-width: 767.98px)';

/** Reads the persisted collapse preference (`'true'` / `'false'`); `null` when missing, malformed or unavailable. */
export function fpcReadSidebarCollapsed(storage: Storage | null | undefined, key: string | null): boolean | null {
  if (!storage || !key) return null;

  try {
    const raw = storage.getItem(key);

    return raw === 'true' ? true : raw === 'false' ? false : null;
  } catch {
    return null;
  }
}

export function fpcWriteSidebarCollapsed(
  storage: Storage | null | undefined,
  key: string | null,
  collapsed: boolean,
): void {
  if (!storage || !key) return;

  try {
    storage.setItem(key, collapsed ? 'true' : 'false');
  } catch {
    // Storage may be full or unavailable; the in-memory state still applies.
  }
}

/**
 * Console navigation rail. Items (`.sidebar__item` anchors / buttons, `fpc-sidebar-nav-item`, `fpc-sidebar-popover`
 * group triggers) show their icon with the label next to it; the toggle at the bottom collapses the rail to the icons
 * (labels stay available to assistive tech and as tooltips). Pin account / mode triggers with `[fpcSidebarFooter]` so
 * they stay at the bottom while the items scroll.
 *
 * The collapse preference persists in `localStorage` under `storageKey`. Below `md` the rail is always icon-only;
 * expanding it there overlays the content and closes again on navigation, outside click or Escape.
 *
 * Item chrome for projected content lives in this component's styles (`::ng-deep`, as in `fpc-sidebar-popover`), so
 * every console renders the same rail.
 */
@Component({
  selector: 'fpc-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sidebar fpc-sidebar bg-body-tertiary',
    '[class.fpc-sidebar--collapsed]': 'isCollapsed()',
    '[class.fpc-sidebar--overlay]': 'overlay()',
    '[style.--fpc-sidebar-collapsed-width]': 'collapsedWidth()',
    '[style.--fpc-sidebar-expanded-width]': 'expandedWidth()',
    '[style.--fpc-sidebar-width]': 'layoutWidth()',
    '[attr.role]': '"navigation"',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <div class="fpc-sidebar__panel">
      <div class="fpc-sidebar__items">
        <ng-content />
      </div>
      <div class="fpc-sidebar__footer">
        <ng-content select="[fpcSidebarFooter]" />
        @if (collapsible()) {
          <button
            type="button"
            class="sidebar__item fpc-sidebar__toggle border-top"
            [attr.aria-expanded]="!isCollapsed()"
            [attr.aria-label]="toggleLabel()"
            [title]="toggleLabel()"
            data-testid="sidebar-collapse-toggle"
            (click)="toggleCollapsed()"
          >
            <i
              class="bi"
              [class.bi-chevron-double-left]="!isCollapsed()"
              [class.bi-chevron-double-right]="isCollapsed()"
              aria-hidden="true"
            ></i>
            <span class="small">{{ toggleLabel() }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styleUrl: './sidebar.component.scss',
})
export class FpcSidebarComponent {
  private readonly document = inject(DOCUMENT);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  /** Rail width when collapsed (icons only); matches the top bar's brand square. */
  readonly collapsedWidth = input('calc(2rem + 40.5px)');
  /** Rail width when expanded (icon + label). */
  readonly expandedWidth = input('15rem');
  readonly ariaLabel = input<string | null>('Main navigation');
  /** The collapse preference (wide screens); persisted under `storageKey`. Starts collapsed (icons only) until the
   * user expands it. */
  readonly collapsed = model(true);
  readonly collapsible = input(true, { transform: booleanAttribute });
  readonly storageKey = input<string | null>(null);
  readonly collapseLabel = input('Collapse sidebar');
  readonly expandLabel = input('Expand sidebar');

  /** Viewport below `md`: icon-only rail, expanding overlays the content. */
  protected readonly narrow = signal(false);
  /** Expanded overlay on narrow viewports (never persisted). */
  private readonly narrowExpanded = signal(false);
  private restored = false;

  /** Whether the rail currently shows icons only. */
  readonly isCollapsed = computed(() =>
    this.collapsible() ? (this.narrow() ? !this.narrowExpanded() : this.collapsed()) : false,
  );
  protected readonly overlay = computed(() => this.narrow() && !this.isCollapsed());
  /** Width the rail takes in the layout (the overlay floats over the content, so it keeps the collapsed width). */
  readonly layoutWidth = computed(() =>
    this.isCollapsed() || this.narrow() ? this.collapsedWidth() : this.expandedWidth(),
  );
  protected readonly toggleLabel = computed(() => (this.isCollapsed() ? this.expandLabel() : this.collapseLabel()));

  constructor() {
    this.watchNarrow();

    effect(() => {
      const key = this.storageKey();

      untracked(() => {
        if (this.restored || !key) return;

        this.restored = true;
        const stored = fpcReadSidebarCollapsed(this.storage(), key);

        if (stored !== null) this.collapsed.set(stored);
      });
    });
    effect(() => {
      const collapsed = this.collapsed();

      if (this.restored) fpcWriteSidebarCollapsed(this.storage(), untracked(this.storageKey), collapsed);
    });
  }

  toggleCollapsed(): void {
    if (!this.collapsible()) return;

    if (this.narrow()) {
      this.narrowExpanded.set(!this.narrowExpanded());
    } else {
      this.collapsed.set(!this.collapsed());
    }
  }

  /** Narrow overlay: picking a page (link or action button, not a group trigger) closes it again. */
  @HostListener('click', ['$event'])
  protected onClick(event: MouseEvent): void {
    if (!this.overlay()) return;

    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('a[href], button');

    if (
      control &&
      !control.classList.contains('fpc-sidebar__toggle') &&
      this.elementRef.nativeElement.contains(control)
    ) {
      this.narrowExpanded.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.overlay() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.narrowExpanded.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.overlay()) this.narrowExpanded.set(false);
  }

  private watchNarrow(): void {
    const view = this.document.defaultView;

    if (!view || typeof view.matchMedia !== 'function') return;

    const media = view.matchMedia(FPC_SIDEBAR_NARROW_QUERY);
    const listener = (event: MediaQueryListEvent): void => {
      this.narrow.set(event.matches);
      this.narrowExpanded.set(false);
    };

    this.narrow.set(media.matches);
    media.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', listener));
  }

  private storage(): Storage | null {
    try {
      return this.document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
