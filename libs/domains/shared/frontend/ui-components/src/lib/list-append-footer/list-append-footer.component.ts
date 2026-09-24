import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { FpcSpinnerComponent } from '../spinner/spinner.component';

/**
 * Footer for paginated lists: shows a spinner while the next page loads and a retry affordance
 * when the last append failed. Migrated from `shared/frontend/ui-lists`.
 */
@Component({
  selector: 'fpc-list-append-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcSpinnerComponent],
  host: { class: 'fpc-list-append-footer' },
  template: `
    <div class="fpc-list-append-footer__inner py-3 d-flex justify-content-center align-items-center">
      @if (loading()) {
        <fpc-spinner [label]="loadingLabel()" />
      } @else if (error()) {
        <button
          type="button"
          class="btn btn-link p-0"
          [attr.aria-label]="retryLabel()"
          [title]="retryLabel()"
          (click)="retry.emit()"
        >
          <i class="bi bi-arrow-repeat fs-4" aria-hidden="true"></i>
        </button>
      }
    </div>
  `,
  styleUrl: './list-append-footer.component.scss',
})
export class FpcListAppendFooterComponent {
  readonly loading = input(false);
  readonly error = input(false);
  readonly loadingLabel = input('Loading');
  readonly retryLabel = input('Retry loading more');

  readonly retry = output<void>();
}
