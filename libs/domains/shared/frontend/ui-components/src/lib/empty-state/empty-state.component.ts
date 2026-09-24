import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type FpcEmptyStateSize = 'sm' | 'md' | 'lg';

/**
 * Empty list/board placeholder with optional icon, message, and projected CTA.
 *
 * **Search empty:** when a search/filter is active and yields no rows, pass `icon="search"` and
 * message `"No search results"`. Keep domain copy + default icon for a truly empty collection.
 */
@Component({
  selector: 'fpc-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-empty-state',
    '[class.fpc-empty-state--sm]': 'size() === "sm"',
    '[class.fpc-empty-state--md]': 'size() === "md"',
    '[class.fpc-empty-state--lg]': 'size() === "lg"',
  },
  template: `
    @if (icon()) {
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
  /** Bootstrap icon name without the `bi-` prefix. Defaults to `hourglass-split` for list empties. */
  readonly icon = input<string | null>('hourglass-split');
  readonly title = input<string | null>(null);
  readonly message = input<string | null>(null);
  readonly size = input<FpcEmptyStateSize>('md');
}
