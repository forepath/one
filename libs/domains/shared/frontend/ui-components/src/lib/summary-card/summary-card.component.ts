import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { FpcButtonGroupComponent } from '../button-group/button-group.component';

export type FpcSummaryCardTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info';

/**
 * Single metric inside an `fpc-summary-bar`. Use the `value` input for plain text, or project
 * richer markup through `[fpcSummaryCardValue]` (import `FpcSummaryCardValueDirective`);
 * `[fpcSummaryCardActions]` sits to the right of the value on the same row, wrapped in an
 * `fpc-button-group` so icon/action buttons share alignment and gap.
 */
@Component({
  selector: 'fpc-summary-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcButtonGroupComponent],
  host: {
    '[class]': '"fpc-summary-card fpc-summary-card--" + tone()',
  },
  template: `
    <span class="fpc-summary-card__label text-body-secondary">{{ label() }}</span>

    <div class="fpc-summary-card__row">
      <div class="fpc-summary-card__value">
        @if (value() !== null) {
          <span class="fpc-summary-card__value-text">{{ value() }}</span>
        }
        <ng-content select="[fpcSummaryCardValue]" />
      </div>

      <div class="fpc-summary-card__actions">
        <fpc-button-group size="sm">
          <ng-content select="[fpcSummaryCardActions]" />
        </fpc-button-group>
      </div>
    </div>

    <ng-content />
  `,
  styleUrl: './summary-card.component.scss',
})
export class FpcSummaryCardComponent {
  readonly label = input('');
  readonly value = input<string | null>(null);
  readonly tone = input<FpcSummaryCardTone>('default');
}
