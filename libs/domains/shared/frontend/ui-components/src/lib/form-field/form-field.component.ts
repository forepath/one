import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { FpcLabelComponent } from '../label/label.component';

/**
 * Label + control + hint/error wrapper. The control is projected as default content; hint and
 * error can be supplied either as plain strings or as richer projected content via the
 * `[fpcFormFieldHint]` and `[fpcFormFieldError]` attribute slots.
 */
@Component({
  selector: 'fpc-form-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcLabelComponent],
  host: { class: 'fpc-form-field' },
  template: `
    @if (label()) {
      <fpc-label [forId]="forId()" [required]="required()">{{ label() }}</fpc-label>
    }

    <div class="fpc-form-field__control">
      <ng-content />
    </div>

    @if (error()) {
      <p class="fpc-form-field__error invalid-feedback d-block" [id]="errorId()" role="alert">{{ error() }}</p>
    }
    <div class="fpc-form-field__error-slot invalid-feedback d-block">
      <ng-content select="[fpcFormFieldError]" />
    </div>

    @if (hint() && !error()) {
      <p class="fpc-form-field__hint form-text" [id]="hintId()">{{ hint() }}</p>
    }
    <div class="fpc-form-field__hint-slot form-text">
      <ng-content select="[fpcFormFieldHint]" />
    </div>
  `,
  styleUrl: './form-field.component.scss',
})
export class FpcFormFieldComponent {
  readonly label = input<string | null>(null);
  /** Id of the projected control; wired to the label's `for` attribute. */
  readonly forId = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);

  /** Convenience id consumers can point `aria-describedby` at. */
  protected readonly hintId = computed(() => (this.forId() ? `${this.forId()}-hint` : null));
  protected readonly errorId = computed(() => (this.forId() ? `${this.forId()}-error` : null));
}
