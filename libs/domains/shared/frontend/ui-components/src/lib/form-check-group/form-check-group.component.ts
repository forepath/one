import { booleanAttribute, ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { FPC_CONTROL_SIZE } from '../control-size/control-size';
import { FpcFormTextDirective } from '../truncate-title/form-text.directive';
import { FpcTruncateTitleDirective } from '../truncate-title/truncate-title.directive';

/**
 * Optional fieldset wrapper for related `fpc-form-check` radios or checkboxes.
 * Use `inline` when the projected checks should sit on one row.
 */
@Component({
  selector: 'fpc-form-check-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcTruncateTitleDirective, FpcFormTextDirective],
  host: {
    class: 'fpc-form-check-group',
    '[class.fpc-form-check-group--inline]': 'inline()',
    role: 'group',
    '[attr.aria-labelledby]': 'legendId()',
  },
  template: `
    @if (label()) {
      <div
        class="fpc-form-check-group__legend form-label"
        [class.fpc-form-label--sm]="compactLabel"
        [id]="legendId()"
        fpcTruncateTitle
      >
        {{ label() }}
      </div>
    }
    <div
      class="fpc-form-check-group__items"
      [class.d-flex]="inline()"
      [class.flex-wrap]="inline()"
      [class.gap-3]="inline()"
    >
      <ng-content />
    </div>
    @if (hint()) {
      <p class="form-text mb-0">{{ hint() }}</p>
    }
  `,
  styleUrl: './form-check-group.component.scss',
})
export class FpcFormCheckGroupComponent {
  protected readonly compactLabel = inject(FPC_CONTROL_SIZE) === 'sm';

  readonly label = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly inline = input(false, { transform: booleanAttribute });
  readonly legendId = input('fpc-form-check-group-legend');
}
