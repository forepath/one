import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type FpcFormCheckType = 'checkbox' | 'radio';

let nextCheckId = 0;

/**
 * Bootstrap `form-check` checkbox or radio. Checkboxes implement `ControlValueAccessor` (boolean).
 * Radios are typically driven with `[checked]` / `(checkedChange)` (or `(valueSelect)`) sharing a `name`.
 */
@Component({
  selector: 'fpc-form-check',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-form-check',
    '[class.fpc-form-check--inline]': 'inline()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FpcFormCheckComponent),
      multi: true,
    },
  ],
  template: `
    <div class="form-check" [class.form-check-inline]="inline()">
      <input
        [class]="inputClasses()"
        [type]="type()"
        [id]="resolvedId()"
        [attr.name]="name()"
        [attr.value]="value()"
        [checked]="checked()"
        [disabled]="isDisabled()"
        [attr.required]="required() ? '' : null"
        [attr.aria-label]="label() ? null : ariaLabel()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        (change)="onNativeChange($event)"
        (blur)="onBlur()"
      />
      @if (label()) {
        <label class="form-check-label" [for]="resolvedId()">{{ label() }}</label>
      }
      <ng-content />
    </div>
  `,
  styleUrl: './form-check.component.scss',
})
export class FpcFormCheckComponent implements ControlValueAccessor {
  readonly type = input<FpcFormCheckType>('checkbox');
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly required = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly inline = input(false, { transform: booleanAttribute });
  readonly label = input<string | null>(null);
  readonly checkId = input<string | null>(null);
  readonly name = input<string | null>(null);
  /** Radio option value (also useful as a stable token for checkbox lists). */
  readonly value = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  /** Extra classes on the native input (e.g. `font-monospace`). */
  readonly inputClass = input<string | null>(null);

  /** Emits when a radio option is chosen (mirrors native `value`). */
  readonly valueSelect = output<string>();

  private readonly fallbackId = `fpc-form-check-${nextCheckId++}`;
  private readonly cvaDisabled = signal(false);
  private onChange: (value: boolean) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected readonly resolvedId = computed(() => this.checkId() ?? this.fallbackId);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly inputClasses = computed(() => {
    const extra = this.inputClass()?.trim();
    return extra ? `form-check-input ${extra}` : 'form-check-input';
  });

  writeValue(value: boolean | null): void {
    if (this.type() === 'checkbox') {
      this.checked.set(Boolean(value));
    }
  }

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }

  protected onNativeChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const next = inputEl.checked;

    this.checked.set(next);

    if (this.type() === 'checkbox') {
      this.onChange(next);
      return;
    }

    if (next) {
      const option = this.value() ?? inputEl.value;
      this.valueSelect.emit(option);
    }
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
