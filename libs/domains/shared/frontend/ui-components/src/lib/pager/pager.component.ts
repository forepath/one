import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

export type FpcPagerSize = 'sm' | 'md' | 'lg';

/**
 * Cursor pager for result sets with an unknown total (keyset / cursor APIs): previous / next buttons around the
 * current 1-based page number and an optional page-size select. Use `fpc-pagination` when the total is known.
 */
@Component({
  selector: 'fpc-pager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-pager' },
  template: `
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
        <li class="page-item active" aria-current="page">
          <span class="page-link fpc-pager__page">
            @if (pageLabel()) {
              <span class="me-1">{{ pageLabel() }}</span>
            }
            {{ page() }}
          </span>
        </li>
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
  /** Current page, 1-based. */
  readonly page = input(1);
  readonly hasPrevious = input(false);
  readonly hasNext = input(false);
  readonly disabled = input(false);
  readonly size = input<FpcPagerSize>('md');
  /** Optional page sizes; the select is only rendered when non-empty. */
  readonly pageSizes = input<readonly number[]>([]);
  readonly pageSize = model<number | null>(null);
  readonly ariaLabel = input('Pagination');
  readonly previousLabel = input('Previous page');
  readonly nextLabel = input('Next page');
  readonly pageLabel = input<string | null>(null);
  readonly pageSizeLabel = input('Page size');

  readonly previous = output<void>();
  readonly next = output<void>();

  protected readonly previousDisabled = computed(() => this.disabled() || !this.hasPrevious());
  protected readonly nextDisabled = computed(() => this.disabled() || !this.hasNext());

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

  protected goPrevious(): void {
    if (!this.previousDisabled()) {
      this.previous.emit();
    }
  }

  protected goNext(): void {
    if (!this.nextDisabled()) {
      this.next.emit();
    }
  }

  protected onPageSizeChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);

    if (Number.isFinite(value) && value !== this.pageSize()) {
      this.pageSize.set(value);
    }
  }
}
