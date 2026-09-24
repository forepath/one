import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { FpcSpinnerComponent } from '../spinner/spinner.component';

/**
 * Covers its positioned ancestor while `loading` is true. Wrap the content that must stay
 * visible behind the overlay and give the wrapper `position: relative`. Pass `fixed` for a
 * viewport-covering standalone spinner (console file-only / bootstrap loading).
 */
@Component({
  selector: 'fpc-loading-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcSpinnerComponent],
  host: {
    class: 'fpc-loading-overlay',
    '[class.fpc-loading-overlay--active]': 'loading()',
    '[class.fpc-loading-overlay--fixed]': 'fixed()',
    '[attr.aria-busy]': 'loading()',
    '[attr.aria-hidden]': 'loading() ? null : "true"',
  },
  template: `
    @if (loading()) {
      <div class="fpc-loading-overlay__backdrop" [class.fpc-loading-overlay__backdrop--dim]="dim()">
        <fpc-spinner [size]="spinnerSize()" [label]="label()" />
        @if (message()) {
          <p class="fpc-loading-overlay__message mb-0">{{ message() }}</p>
        }
      </div>
    }
  `,
  styleUrl: './loading-overlay.component.scss',
})
export class FpcLoadingOverlayComponent {
  readonly loading = input(false);
  readonly message = input<string | null>(null);
  readonly label = input('Loading');
  readonly spinnerSize = input<'sm' | 'md' | 'lg'>('md');
  /** Tints the backdrop; disable for a transparent overlay that only blocks interaction. */
  readonly dim = input(true);
  /** Pin the overlay to the viewport instead of a relative ancestor. */
  readonly fixed = input(false);
}
