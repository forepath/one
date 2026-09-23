import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

export type FpcPaginationSize = 'sm' | 'md' | 'lg';

/**
 * 1-based pagination control. `maxVisible` caps how many numbered links are rendered; the window
 * slides so the current page stays centred.
 */
@Component({
  selector: 'fpc-pagination',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-pagination' },
  template: `
    <nav [attr.aria-label]="ariaLabel()">
      <ul [class]="listClasses()">
        <li class="page-item" [class.disabled]="isFirst()">
          <button
            type="button"
            class="page-link"
            [disabled]="isFirst() || disabled()"
            [attr.aria-label]="previousLabel()"
            (click)="goTo(page() - 1)"
          >
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
        </li>

        @for (visiblePage of visiblePages(); track visiblePage) {
          <li class="page-item" [class.active]="visiblePage === page()">
            <button
              type="button"
              class="page-link"
              [disabled]="disabled()"
              [attr.aria-current]="visiblePage === page() ? 'page' : null"
              (click)="goTo(visiblePage)"
            >
              {{ visiblePage }}
            </button>
          </li>
        }

        <li class="page-item" [class.disabled]="isLast()">
          <button
            type="button"
            class="page-link"
            [disabled]="isLast() || disabled()"
            [attr.aria-label]="nextLabel()"
            (click)="goTo(page() + 1)"
          >
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </li>
      </ul>
    </nav>
  `,
  styleUrl: './pagination.component.scss',
})
export class FpcPaginationComponent {
  readonly page = model(1);
  readonly totalPages = input(1);
  readonly maxVisible = input(7);
  readonly size = input<FpcPaginationSize>('md');
  readonly disabled = input(false);
  readonly ariaLabel = input('Pagination');
  readonly previousLabel = input('Previous page');
  readonly nextLabel = input('Next page');

  protected readonly isFirst = computed(() => this.page() <= 1);
  protected readonly isLast = computed(() => this.page() >= this.totalPages());

  protected readonly visiblePages = computed(() => {
    const total = Math.max(1, this.totalPages());
    const window = Math.max(1, Math.min(this.maxVisible(), total));
    const start = Math.min(Math.max(1, this.page() - Math.floor(window / 2)), total - window + 1);

    return Array.from({ length: window }, (_, index) => start + index);
  });

  protected readonly listClasses = computed(() => {
    const classes = ['pagination', 'mb-0'];
    const size = this.size();

    if (size === 'sm' || size === 'lg') {
      classes.push(`pagination-${size}`);
    }

    return classes.join(' ');
  });

  protected goTo(target: number): void {
    if (this.disabled()) {
      return;
    }

    const clamped = Math.min(Math.max(1, target), Math.max(1, this.totalPages()));

    if (clamped !== this.page()) {
      this.page.set(clamped);
    }
  }
}
