import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcProgressRingTone = 'primary' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Circular, determinate progress indicator (pure SVG + CSS). Use for compact capacity / quota /
 * health gauges in cards and tables. The ring colour comes from the Bootstrap tone variable, so it
 * follows the active brand and colour mode.
 */
@Component({
  selector: 'fpc-progress-ring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-progress-ring',
    '[attr.data-tone]': 'tone()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    role: 'progressbar',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'clampedValue()',
    '[attr.aria-valuemin]': '0',
    '[attr.aria-valuemax]': 'safeMax()',
    '[attr.aria-valuetext]': 'percentage() + "%"',
  },
  template: `
    <svg
      class="fpc-progress-ring__svg"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox()"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        class="fpc-progress-ring__track"
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        [attr.stroke-width]="strokeWidth()"
      />
      <circle
        class="fpc-progress-ring__indicator"
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        [attr.stroke-width]="strokeWidth()"
        [attr.stroke-dasharray]="circumference()"
        [attr.stroke-dashoffset]="dashOffset()"
        [attr.transform]="rotation()"
      />
    </svg>
    @if (showLabel()) {
      <span class="fpc-progress-ring__label" aria-hidden="true" [style.font-size.px]="labelFontSize()">{{
        centerText()
      }}</span>
    }
  `,
  styleUrl: './progress-ring.component.scss',
})
export class FpcProgressRingComponent {
  readonly value = input(0);
  readonly max = input(100);
  /** Outer diameter in pixels. */
  readonly size = input(48);
  /** Ring thickness in pixels. */
  readonly strokeWidth = input(4);
  readonly tone = input<FpcProgressRingTone>('primary');
  /** Accessible name of the gauge (e.g. "CPU usage"). */
  readonly label = input<string | null>('Progress');
  /** Show text in the centre of the ring. */
  readonly showLabel = input(true);
  /** Centre text; defaults to the rounded percentage. */
  readonly centerLabel = input<string | null>(null);

  protected readonly safeMax = computed(() => Math.max(this.max(), 0));
  protected readonly clampedValue = computed(() => Math.min(Math.max(this.value(), 0), this.safeMax()));
  protected readonly percentage = computed(() => {
    const max = this.safeMax();

    return max === 0 ? 0 : Math.round((this.clampedValue() / max) * 100);
  });

  protected readonly center = computed(() => this.size() / 2);
  protected readonly radius = computed(() => Math.max((this.size() - this.strokeWidth()) / 2, 0));
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());
  protected readonly dashOffset = computed(() => {
    const max = this.safeMax();
    const fraction = max === 0 ? 0 : this.clampedValue() / max;

    return this.circumference() * (1 - fraction);
  });

  protected readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
  protected readonly rotation = computed(() => `rotate(-90 ${this.center()} ${this.center()})`);
  protected readonly labelFontSize = computed(() => Math.min(Math.max(Math.round(this.size() * 0.24), 9), 28));
  protected readonly centerText = computed(() => this.centerLabel() ?? `${this.percentage()}%`);
}
