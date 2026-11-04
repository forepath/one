import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { FPC_CONTROL_SIZE, FpcControlSize } from '../control-size/control-size';
import { FpcTruncateTitleDirective } from '../truncate-title/truncate-title.directive';

export type FpcLabelSize = FpcControlSize;

/**
 * Bootstrap form label with optional required marker. Prefer `fpc-form-field` when hints/errors are needed.
 * Always one line: longer text ellipsizes (full text on hover); the required marker stays visible. The text size
 * follows the control tier (`size`, else `FPC_CONTROL_SIZE`), so an `sm` field gets an `sm` label.
 */
@Component({
  selector: 'fpc-label',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcTruncateTitleDirective],
  host: { class: 'fpc-label' },
  template: `
    <label class="form-label" [class]="sizeClass()" [attr.for]="forId()">
      <span class="fpc-label__text" fpcTruncateTitle><ng-content /></span>
      @if (required()) {
        <span class="fpc-label__required text-danger" aria-hidden="true">*</span>
        <span class="visually-hidden">{{ requiredText() }}</span>
      }
    </label>
  `,
  styleUrl: './label.component.scss',
})
export class FpcLabelComponent {
  private readonly defaultSize = inject(FPC_CONTROL_SIZE);

  /** `for` attribute of the rendered label; must match the control id. */
  readonly forId = input<string | null>(null);
  readonly required = input(false);
  /** Screen-reader text appended after the asterisk. */
  readonly requiredText = input('required');
  /** Tier of the labelled control; defaults to `FPC_CONTROL_SIZE`. */
  readonly size = input<FpcLabelSize | undefined>(undefined);

  protected readonly sizeClass = computed(() => {
    const size = this.size() ?? this.defaultSize;

    if (size === 'sm') {
      return 'fpc-form-label--sm';
    }

    return size === 'lg' || size === 'xl' ? 'fpc-form-label--lg' : null;
  });
}
