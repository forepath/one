import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcProgressVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';

/** One segment of a stacked progress bar; `value` is relative to the component's `max`. */
export interface FpcProgressSegment {
  value: number;
  variant?: FpcProgressVariant;
  /** Accessible label / tooltip of the segment. */
  label?: string | null;
}

/**
 * Determinate Bootstrap progress bar for uploads, wizards, and similar flows.
 * Pass `segments` to render a stacked bar (Bootstrap `.progress-stacked`) instead of a single value.
 */
@Component({
  selector: 'fpc-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-progress' },
  template: `
    @if (stackedSegments().length) {
      <div class="progress-stacked" [style.height]="height()" [attr.aria-label]="ariaLabel()" role="group">
        @for (segment of stackedSegments(); track $index) {
          <div
            class="progress"
            role="progressbar"
            [style.width.%]="segment.percentage"
            [style.height]="height()"
            [attr.title]="segment.label"
            [attr.aria-label]="segment.label ?? ariaLabel()"
            [attr.aria-valuenow]="segment.value"
            [attr.aria-valuemin]="0"
            [attr.aria-valuemax]="max()"
          >
            <div [class]="segment.classes"></div>
          </div>
        }
      </div>
      @if (showLabel()) {
        <span class="fpc-progress__label fpc-progress__label--stacked">{{ label() ?? percentage() + '%' }}</span>
      }
    } @else {
      <div
        class="progress"
        role="progressbar"
        [style.height]="height()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-valuenow]="value()"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="max()"
      >
        <div [class]="barClasses()" [style.width.%]="percentage()">
          @if (showLabel()) {
            <span class="fpc-progress__label">{{ label() ?? percentage() + '%' }}</span>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './progress.component.scss',
})
export class FpcProgressComponent {
  readonly value = input(0);
  readonly max = input(100);
  readonly variant = input<FpcProgressVariant>('primary');
  readonly striped = input(false);
  readonly animated = input(false);
  readonly showLabel = input(false);
  readonly label = input<string | null>(null);
  readonly height = input('1rem');
  readonly ariaLabel = input<string | null>('Progress');
  /** Stacked segments; when non-empty `value` is ignored and the total is the sum of all segments. */
  readonly segments = input<FpcProgressSegment[] | null>(null);

  protected readonly stackedSegments = computed(() => {
    const max = this.max();
    const segments = this.segments() ?? [];

    if (max <= 0 || segments.length === 0) {
      return [];
    }

    let remaining = 100;

    return segments.map((segment) => {
      const raw = (Math.max(segment.value, 0) / max) * 100;
      const percentage = Math.min(raw, remaining);

      remaining -= percentage;

      return {
        value: segment.value,
        label: segment.label ?? null,
        percentage,
        classes: this.classesFor(segment.variant ?? this.variant()),
      };
    });
  });

  protected readonly percentage = computed(() => {
    const max = this.max();

    if (max <= 0) {
      return 0;
    }

    const segments = this.segments() ?? [];
    const total = segments.length
      ? segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0)
      : this.value();
    const clamped = Math.min(Math.max(total, 0), max);

    return Math.round((clamped / max) * 100);
  });

  protected readonly barClasses = computed(() => this.classesFor(this.variant()));

  private classesFor(variant: FpcProgressVariant): string {
    const classes = ['progress-bar', `bg-${variant}`];

    if (this.striped() || this.animated()) {
      classes.push('progress-bar-striped');
    }

    if (this.animated()) {
      classes.push('progress-bar-animated');
    }

    return classes.join(' ');
  }
}
