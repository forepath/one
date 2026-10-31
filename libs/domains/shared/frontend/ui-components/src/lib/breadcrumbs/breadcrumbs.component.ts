import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { FpcBreadcrumbItemComponent } from '../breadcrumb-item/breadcrumb-item.component';
import { FpcDropdownComponent } from '../dropdown/dropdown.component';
import { FpcDropdownItemComponent } from '../dropdown-item/dropdown-item.component';

export type FpcBreadcrumbsSize = 'sm' | 'md';

/** Dividers drawn as a small muted `bi-chevron-right` instead of a text glyph. */
const CHEVRON_DIVIDERS = new Set(['›', '>', '»', 'chevron']);
const COLLAPSED = 'fpc-breadcrumb-item--collapsed';
const OVERFLOW_SHOWN = 'fpc-breadcrumbs__overflow--shown';
const MEASURING = 'fpc-breadcrumbs__list--measuring';

/**
 * Breadcrumb trail: ancestors as quiet chips, the current item as plain semibold text, a muted separator, one line.
 * When the line is too short, middle `fpc-breadcrumb-item`s collapse (from the root side) into an "…" overflow menu
 * (body-portaled `fpc-dropdown`) after the first crumb; first and current crumb always stay. Crumbs still truncate with
 * their full name as `title`.
 *
 * The item container uses `role="list"` on a `div` so consumers can project `fpc-breadcrumb-item` components without
 * producing an invalid `ol > custom-element` tree. Hand-written crumbs (`.breadcrumb-item.fpc-breadcrumb-item` with an
 * `<a>` / `<span>` child) get the same look but do not collapse.
 *
 * `divider`: `›` (also `>`, `»`, `chevron`) draws the chevron; any other character (e.g. `/` for path-style trails) is
 * drawn as text.
 */
@Component({
  selector: 'fpc-breadcrumbs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcDropdownComponent, FpcDropdownItemComponent],
  host: {
    class: 'fpc-breadcrumbs',
    '[class.fpc-breadcrumbs--sm]': 'size() === "sm"',
    '[class.fpc-breadcrumbs--chevron]': 'chevron()',
  },
  template: `
    <nav [attr.aria-label]="ariaLabel()">
      <div
        #list
        class="breadcrumb mb-0 fpc-breadcrumbs__list"
        role="list"
        [style.--bs-breadcrumb-divider]="dividerValue()"
      >
        <ng-content />
        @if (collapseEnabled()) {
          <fpc-dropdown
            #overflow
            #overflowMenu
            class="fpc-breadcrumbs__overflow"
            role="listitem"
            alignment="start"
            appendTo="body"
          >
            <button
              fpcDropdownTrigger
              type="button"
              class="fpc-breadcrumbs__more"
              aria-haspopup="menu"
              [attr.aria-expanded]="overflowMenu.open()"
              [attr.aria-controls]="overflowMenu.open() ? overflowMenu.menuId() : null"
              [attr.aria-label]="overflowLabel()"
              [attr.title]="overflowLabel()"
            >
              <i class="bi bi-three-dots" aria-hidden="true"></i>
            </button>
            @for (item of hidden(); track item) {
              <fpc-dropdown-item
                [icon]="item.icon()"
                [title]="item.title() ?? item.label()"
                (selected)="item.activateFromMenu()"
                >{{ item.label() }}</fpc-dropdown-item
              >
            }
          </fpc-dropdown>
        }
      </div>
    </nav>
  `,
  styleUrl: './breadcrumbs.component.scss',
})
export class FpcBreadcrumbsComponent {
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly overflow = viewChild<string, ElementRef<HTMLElement>>('overflow', { read: ElementRef });
  private readonly items = contentChildren(FpcBreadcrumbItemComponent);

  readonly ariaLabel = input('Breadcrumb');
  /** Character between items: `›` (chevron icon) for object trails, `/` (text) for path-style trails. */
  readonly divider = input('/');
  readonly size = input<FpcBreadcrumbsSize>('md');
  /** Collapse middle crumbs into an "…" menu when the line is too short (otherwise they only truncate). */
  readonly collapse = input(true);
  /** Accessible name / tooltip of the "…" overflow button. */
  readonly overflowLabel = input('Show hidden levels');

  /** Crumbs currently collapsed into the overflow menu (root side first). */
  protected readonly hidden = signal<readonly FpcBreadcrumbItemComponent[]>([]);
  protected readonly chevron = computed(() => CHEVRON_DIVIDERS.has(this.divider().trim()));
  protected readonly collapseEnabled = computed(() => this.collapse() && this.items().length >= 3);

  constructor() {
    let frame: number | null = null;
    let observer: ResizeObserver | null = null;
    const schedule = () => {
      if (frame !== null || typeof requestAnimationFrame === 'undefined') return;

      frame = requestAnimationFrame(() => {
        frame = null;
        this.measure();
      });
    };

    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    });

    afterRenderEffect(() => {
      // Re-measure when the crumbs, their labels / icons or the divider change.
      for (const item of this.items()) {
        item.label();
        item.icon();
        item.active();
      }
      this.divider();
      this.size();
      this.collapseEnabled();
      const list = this.list().nativeElement;
      this.overflow();

      if (!observer && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(schedule);
        observer.observe(list);
      }

      untracked(() => this.measure());
    });
  }

  protected dividerValue(): string {
    return `"${this.divider()}"`;
  }

  /**
   * Collapses middle crumbs (from the root side) until the trail fits at the crumbs' natural (capped) widths. DOM
   * classes are toggled directly so each step can be measured synchronously; only the result goes into `hidden`.
   */
  private measure(): void {
    const list = this.list().nativeElement;
    const items = this.items();
    const overflow = this.overflow()?.nativeElement ?? null;

    for (const item of items) item.host.classList.remove(COLLAPSED);
    overflow?.classList.remove(OVERFLOW_SHOWN);

    const hidden: FpcBreadcrumbItemComponent[] = [];

    if (overflow && this.collapseEnabled()) {
      list.classList.add(MEASURING);
      const fits = () => list.scrollWidth <= list.clientWidth + 1;

      if (!fits()) {
        overflow.classList.add(OVERFLOW_SHOWN);

        for (let i = 1; i < items.length - 1; i++) {
          items[i].host.classList.add(COLLAPSED);
          hidden.push(items[i]);

          if (fits()) break;
        }
      }

      list.classList.remove(MEASURING);
    }

    const previous = this.hidden();

    if (previous.length !== hidden.length || previous.some((item, i) => item !== hidden[i])) {
      this.hidden.set(hidden);
    }
  }
}
