import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

export type FpcPagerSize = 'sm' | 'md' | 'lg';

/** Default page sizes of every list (3.38 D4: 25 by default to keep the API load light). */
export const FPC_PAGE_SIZES: readonly number[] = [25, 50, 100];
export const FPC_DEFAULT_PAGE_SIZE = 25;

/** One entry of the numbered page strip: a page number or a gap (`…`). */
export type FpcPagerEntry = number | 'gap';

/**
 * Numbered page window around `page` (1-based) of `pages`: first and last always, `…` for gaps, `max` entries at most
 * (≥ 5). E.g. page 6 of 20 → 1 … 5 6 7 … 20.
 */
export function fpcPagerWindow(page: number, pages: number, max = 7): FpcPagerEntry[] {
  const total = Math.max(1, pages);
  const slots = Math.max(5, max);

  if (total <= slots) return Array.from({ length: total }, (_, index) => index + 1);

  const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const middle = slots - 4; // 1 … [middle] … N

  if (page <= slots - 3) return [...range(1, slots - 2), 'gap', total];
  if (page >= total - (slots - 4)) return [1, 'gap', ...range(total - (slots - 3), total)];

  const start = page - Math.floor((middle - 1) / 2);
  const entries: FpcPagerEntry[] = [1, 'gap', ...range(start, start + middle - 1), 'gap', total];

  return entries;
}

/**
 * Pager of every list (3.38 D4): "x–y of N" range text, numbered pages when the `total` is known, otherwise
 * previous / next around the current page (cursor / limit-offset APIs without totals: `hasNext`), plus the page-size
 * select (25 / 50 / 100). `page` is 1-based and two-way (`[(page)]`); `previous` / `next` still fire for cursor
 * consumers that move the page themselves.
 */
@Component({
  selector: 'fpc-pager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-pager' },
  template: `
    @if (rangeText(); as range) {
      <span class="fpc-pager__range text-body-secondary" aria-live="polite" data-testid="fpc-pager-range">{{
        range
      }}</span>
    }
    <nav class="fpc-pager__nav" [attr.aria-label]="ariaLabel()">
      <ul [class]="listClasses()">
        <li class="page-item" [class.disabled]="previousDisabled()">
          <button
            type="button"
            class="page-link fpc-pager__previous"
            [disabled]="previousDisabled()"
            [attr.aria-label]="previousLabel()"
            [attr.title]="previousLabel()"
            (click)="goPrevious()"
          >
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
        </li>
        @if (pages(); as pageCount) {
          @for (entry of window(); track $index) {
            @if (entry === 'gap') {
              <li class="page-item disabled" aria-hidden="true"><span class="page-link fpc-pager__gap">…</span></li>
            } @else {
              <li class="page-item" [class.active]="entry === page()">
                <button
                  type="button"
                  class="page-link fpc-pager__number"
                  [disabled]="disabled()"
                  [attr.aria-current]="entry === page() ? 'page' : null"
                  [attr.data-page]="entry"
                  (click)="goTo(entry)"
                >
                  {{ entry }}
                </button>
              </li>
            }
          }
        } @else {
          <li class="page-item active" aria-current="page">
            <span class="page-link fpc-pager__page">
              @if (pageLabel()) {
                <span class="me-1">{{ pageLabel() }}</span>
              }
              {{ page() }}
            </span>
          </li>
        }
        <li class="page-item" [class.disabled]="nextDisabled()">
          <button
            type="button"
            class="page-link fpc-pager__next"
            [disabled]="nextDisabled()"
            [attr.aria-label]="nextLabel()"
            [attr.title]="nextLabel()"
            (click)="goNext()"
          >
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </li>
      </ul>
    </nav>

    @if (pageSizes().length > 0) {
      <select
        [class]="selectClasses()"
        [attr.aria-label]="pageSizeLabel()"
        [attr.title]="pageSizeLabel()"
        [disabled]="disabled()"
        (change)="onPageSizeChange($event)"
        data-testid="fpc-pager-size"
      >
        @for (size of pageSizes(); track size) {
          <option [value]="size" [selected]="size === pageSize()">{{ size }}</option>
        }
      </select>
    }
  `,
  styleUrl: './pager.component.scss',
})
export class FpcPagerComponent {
  /** Current page, 1-based (two-way: numbered pages and previous / next set it). */
  readonly page = model(1);
  /** Total number of rows; known → "x–y of N" + numbered pages. */
  readonly total = input<number | null>(null);
  /** Rows on the current page (range text without a total: "26–50"). */
  readonly itemCount = input<number | null>(null);
  /** Previous possible; default: `page > 1`. */
  readonly hasPrevious = input<boolean | null>(null);
  /** Next possible; default: from `total` (or `false` without one). */
  readonly hasNext = input<boolean | null>(null);
  readonly disabled = input(false);
  readonly size = input<FpcPagerSize>('md');
  /** Page sizes; the select is only rendered when non-empty. */
  readonly pageSizes = input<readonly number[]>([]);
  readonly pageSize = model<number | null>(null);
  readonly maxPages = input(7);
  readonly ariaLabel = input('Pagination');
  readonly previousLabel = input('Previous page');
  readonly nextLabel = input('Next page');
  readonly pageLabel = input<string | null>(null);
  readonly pageSizeLabel = input('Page size');
  /** `{from}`, `{to}`, `{total}` placeholders. */
  readonly rangeLabel = input('{from}–{to} of {total}');
  /** Range text without a known total. */
  readonly rangeOpenLabel = input('{from}–{to}');

  readonly previous = output<void>();
  readonly next = output<void>();

  protected readonly pages = computed(() => {
    const total = this.total();
    const size = this.pageSize();

    return total !== null && size ? Math.max(1, Math.ceil(total / size)) : null;
  });
  protected readonly window = computed(() => fpcPagerWindow(this.page(), this.pages() ?? 1, this.maxPages()));
  protected readonly previousDisabled = computed(() => this.disabled() || !(this.hasPrevious() ?? this.page() > 1));
  protected readonly nextDisabled = computed(() => {
    const pages = this.pages();

    return this.disabled() || !(this.hasNext() ?? (pages !== null && this.page() < pages));
  });
  protected readonly rangeText = computed(() => {
    const size = this.pageSize();
    const total = this.total();
    const count = this.itemCount();

    if (!size || (total === null && count === null)) return null;

    const from = (this.page() - 1) * size + 1;
    const to = total !== null ? Math.min(total, this.page() * size) : from + (count ?? 0) - 1;

    if (to < from) return null;

    return (total !== null ? this.rangeLabel() : this.rangeOpenLabel())
      .replace('{from}', String(from))
      .replace('{to}', String(to))
      .replace('{total}', String(total ?? ''));
  });

  protected readonly listClasses = computed(() => {
    const classes = ['pagination', 'mb-0'];
    const size = this.size();

    if (size === 'sm' || size === 'lg') {
      classes.push(`pagination-${size}`);
    }

    return classes.join(' ');
  });

  protected readonly selectClasses = computed(() => {
    const classes = ['form-select', 'w-auto', 'fpc-pager__size'];
    const size = this.size();

    if (size === 'sm' || size === 'lg') {
      classes.push(`form-select-${size}`);
    }

    return classes.join(' ');
  });

  protected goTo(target: number): void {
    const pages = this.pages() ?? target;
    const clamped = Math.min(Math.max(1, target), pages);

    if (!this.disabled() && clamped !== this.page()) this.page.set(clamped);
  }

  protected goPrevious(): void {
    if (this.previousDisabled()) return;

    this.page.set(Math.max(1, this.page() - 1));
    this.previous.emit();
  }

  protected goNext(): void {
    if (this.nextDisabled()) return;

    this.page.set(this.page() + 1);
    this.next.emit();
  }

  protected onPageSizeChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);

    if (Number.isFinite(value) && value !== this.pageSize()) {
      this.pageSize.set(value);
    }
  }
}
