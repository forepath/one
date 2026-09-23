import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcSpinnerSize = 'sm' | 'md' | 'lg';

export type FpcSpinnerType = 'border' | 'grow';

/** Inline Bootstrap spinner for buttons, cells, and local loading states. */
@Component({
  selector: 'fpc-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"fpc-spinner fpc-spinner--" + size()',
  },
  template: `
    <span [class]="spinnerClasses()" role="status" aria-live="polite">
      <span class="visually-hidden">{{ label() }}</span>
    </span>
  `,
  styleUrl: './spinner.component.scss',
})
export class FpcSpinnerComponent {
  readonly size = input<FpcSpinnerSize>('md');
  readonly type = input<FpcSpinnerType>('border');
  readonly variant = input<string | null>(null);
  readonly label = input('Loading');

  protected readonly spinnerClasses = computed(() => {
    const type = this.type();
    const classes = [`spinner-${type}`];

    if (this.size() === 'sm') {
      classes.push(`spinner-${type}-sm`);
    }

    const variant = this.variant();

    if (variant) {
      classes.push(`text-${variant}`);
    }

    return classes.join(' ');
  });
}
