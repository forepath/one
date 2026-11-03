import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { FpcBadgeComponent, type FpcBadgeTone } from '../badge/badge.component';
import { FpcProgressComponent, type FpcProgressVariant } from '../progress/progress.component';

/** State of the tracked operation; picks the bar tone and turns the striped animation on while `running`. */
export type FpcProgressRowState = 'running' | 'success' | 'failed' | 'paused' | 'idle';

/** `stacked`: text line above the bar (Agenstra modal / cell style). `inline`: one line, the bar grows in between. */
export type FpcProgressRowLayout = 'stacked' | 'inline';

const STATE_VARIANT: Record<FpcProgressRowState, FpcProgressVariant> = {
  running: 'primary',
  success: 'success',
  failed: 'danger',
  paused: 'warning',
  idle: 'secondary',
};

const STATE_TONE: Record<FpcProgressRowState, FpcBadgeTone> = {
  running: 'info',
  success: 'success',
  failed: 'danger',
  paused: 'warning',
  idle: 'neutral',
};

/**
 * Compact progress row (the Agenstra environment-progress pattern): a slim `fpc-progress` bar (0.375rem) with a small
 * status text, an optional status badge and an optional percent / count text. Tone by `state`; striped + animated only
 * while `running`. Meant as a full-width row (under a page header, in a modal footer) instead of a panel / column of its
 * own.
 *
 * Slots: `[fpcProgressRowAside]` (trailing meta / small actions on the text line), default content (details below the
 * bar: cause, failure, a disclosure).
 */
@Component({
  selector: 'fpc-progress-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent, FpcProgressComponent],
  host: {
    class: 'fpc-progress-row small',
    '[class.fpc-progress-row--inline]': "layout() === 'inline'",
    '[attr.data-state]': 'state()',
  },
  template: `
    <div class="fpc-progress-row__main">
      <div
        class="fpc-progress-row__text"
        [attr.role]="live() ? 'status' : null"
        [attr.aria-live]="live() ? 'polite' : null"
      >
        @if (status()) {
          <fpc-badge class="fpc-progress-row__status" size="sm" [tone]="badgeTone()">{{ status() }}</fpc-badge>
        }
        @if (label()) {
          <span class="fpc-progress-row__label text-truncate" [attr.title]="label()">{{ label() }}</span>
        }
        @if (valueLabel()) {
          <span class="fpc-progress-row__value text-body-secondary">{{ valueLabel() }}</span>
        }
      </div>
      <fpc-progress
        class="fpc-progress-row__bar"
        height="0.375rem"
        [value]="value()"
        [max]="max()"
        [variant]="barVariant()"
        [striped]="state() === 'running'"
        [animated]="state() === 'running'"
        [ariaLabel]="ariaLabel() ?? label() ?? status()"
      />
      <div class="fpc-progress-row__aside">
        <ng-content select="[fpcProgressRowAside]" />
      </div>
    </div>
    <ng-content />
  `,
  styleUrl: './progress-row.component.scss',
})
export class FpcProgressRowComponent {
  readonly value = input(0);
  readonly max = input(100);
  readonly state = input<FpcProgressRowState>('running');
  /** Overrides the state's bar tone (e.g. `warning` for a running rollback). */
  readonly variant = input<FpcProgressVariant | null>(null);
  /** Status text (the current step / phase). */
  readonly label = input<string | null>(null);
  /** Optional status badge before the text (toned by `state`). */
  readonly status = input<string | null>(null);
  /** Percent / count text; `null` = the percentage, `''` = none. */
  readonly valueText = input<string | null>(null);
  readonly layout = input<FpcProgressRowLayout>('stacked');
  /** Accessible name of the bar; defaults to `label`, then `status`. */
  readonly ariaLabel = input<string | null>(null);
  /** The text line is a polite live region (step changes are announced). */
  readonly live = input(true);

  protected readonly percentage = computed(() => {
    const max = this.max();

    if (max <= 0) return 0;

    return Math.round((Math.min(Math.max(this.value(), 0), max) / max) * 100);
  });
  protected readonly valueLabel = computed(() => this.valueText() ?? `${this.percentage()}%`);
  protected readonly barVariant = computed(() => this.variant() ?? STATE_VARIANT[this.state()]);
  protected readonly badgeTone = computed(() => STATE_TONE[this.state()]);
}
