import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

import { FpcSpinnerComponent } from '../spinner/spinner.component';

export type FpcEmptyStateSize = 'sm' | 'md' | 'lg';

/**
 * Empty list/board placeholder with optional icon, message, and projected CTA.
 *
 * **Search empty:** when a search/filter is active and yields no rows, pass `icon="search"` and
 * message `"No search results"`. Keep domain copy + default icon for a truly empty collection.
 *
 * **Loading** (3.38 R7): `loading` puts a spinner where the icon sits, in the same centred box, so loading →
 * empty / list never jumps (`title` = the loading label, e.g. "Loading plans"). In lanes and panels use
 * `size="sm"`; the empty state fills the lane body (flex column) and centres.
 */
@Component({
  selector: 'fpc-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcSpinnerComponent],
  host: {
    class: 'fpc-empty-state',
    '[class.fpc-empty-state--loading]': 'loading()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
    '[class.fpc-empty-state--sm]': 'size() === "sm"',
    '[class.fpc-empty-state--md]': 'size() === "md"',
    '[class.fpc-empty-state--lg]': 'size() === "lg"',
  },
  template: `
    @if (loading()) {
      <fpc-spinner class="fpc-empty-state__spinner" variant="primary" [label]="title() || 'Loading'" />
    } @else if (icon()) {
      <i class="bi bi-{{ icon() }} fpc-empty-state__icon" aria-hidden="true"></i>
    }

    @if (title()) {
      <p class="fpc-empty-state__title">{{ title() }}</p>
    }

    @if (message()) {
      <p class="fpc-empty-state__message text-body-secondary">{{ message() }}</p>
    }

    <ng-content />

    <div class="fpc-empty-state__actions">
      <ng-content select="[fpcEmptyStateActions]" />
    </div>
  `,
  styleUrl: './empty-state.component.scss',
})
export class FpcEmptyStateComponent {
  /** Bootstrap icon name without the `bi-` prefix. Defaults to `inbox` for list empties (an hourglass read as "loading", X-14). */
  readonly icon = input<string | null>('inbox');
  readonly title = input<string | null>(null);
  readonly message = input<string | null>(null);
  readonly size = input<FpcEmptyStateSize>('md');
  /** Loading placeholder: spinner instead of the icon, same box. */
  readonly loading = input(false, { transform: booleanAttribute });
}
