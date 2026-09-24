import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcProgressVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';

/** Determinate Bootstrap progress bar for uploads, wizards, and similar flows. */
@Component({
  selector: 'fpc-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-progress' },
  template: `
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

  protected readonly percentage = computed(() => {
    const max = this.max();

    if (max <= 0) {
      return 0;
    }

    const clamped = Math.min(Math.max(this.value(), 0), max);

    return Math.round((clamped / max) * 100);
  });

  protected readonly barClasses = computed(() => {
    const classes = ['progress-bar', `bg-${this.variant()}`];

    if (this.striped() || this.animated()) {
      classes.push('progress-bar-striped');
    }

    if (this.animated()) {
      classes.push('progress-bar-animated');
    }

    return classes.join(' ');
  });
}
