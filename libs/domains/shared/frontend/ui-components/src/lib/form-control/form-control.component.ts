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

export type FpcFormControlType = 'input' | 'select' | 'textarea';

export type FpcFormControlSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Single wrapper for the three Bootstrap form controls. Works both as a plain two-way bound
 * control (`[(value)]`) and inside reactive/template-driven forms through `ControlValueAccessor`.
 * For `controlType="select"`, project the `<option>` elements as content.
 *
 * Inside Bootstrap `input-group` / `fpc-input-group`, the host itself is the flex item
 * (see component SCSS). `display: contents` cannot bridge Bootstrap's `>` selectors —
 * those use the element tree, so a nested `.form-control` would keep `width: 100%` and
 * wrap suffixes under `flex-wrap`.
 *
 * Multi-selects that need array `ngModel` / `compareWith` / `[ngValue]` should stay native —
 * use `multiple` only for simple string / `(valuesChange)` flows. File inputs use
 * `(filesChange)` because the CVA string path cannot carry a `FileList`.
 */
@Component({
  selector: 'fpc-form-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-form-control' },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FpcFormControlComponent),
      multi: true,
    },
  ],
  template: `
    @switch (controlType()) {
      @case ('select') {
        <select
          [id]="controlId()"
          [class]="controlClasses()"
          [attr.name]="name()"
          [disabled]="isDisabled()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-describedby]="ariaDescribedBy()"
          [attr.required]="required() ? '' : null"
          [attr.multiple]="multiple() ? '' : null"
          [attr.size]="htmlSize()"
          [value]="value()"
          (change)="onSelectChange($event)"
          (blur)="onBlur()"
        >
          <ng-content />
        </select>
      }
      @case ('textarea') {
        <textarea
          [id]="controlId()"
          [class]="controlClasses()"
          [attr.name]="name()"
          [rows]="rows()"
          [disabled]="isDisabled()"
          [readOnly]="readOnly()"
          [attr.placeholder]="placeholder()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-describedby]="ariaDescribedBy()"
          [attr.required]="required() ? '' : null"
          [attr.maxlength]="maxLength()"
          [value]="value()"
          (input)="onValueChange($event)"
          (blur)="onBlur()"
        ></textarea>
      }
      @default {
        <input
          [id]="controlId()"
          [class]="controlClasses()"
          [type]="inputType()"
          [attr.name]="name()"
          [disabled]="isDisabled()"
          [readOnly]="readOnly()"
          [attr.placeholder]="placeholder()"
          [attr.autocomplete]="autocomplete()"
          [attr.accept]="accept()"
          [attr.multiple]="multiple() ? '' : null"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-describedby]="ariaDescribedBy()"
          [attr.required]="required() ? '' : null"
          [attr.min]="min()"
          [attr.max]="max()"
          [attr.step]="step()"
          [attr.pattern]="pattern()"
          [attr.maxlength]="maxLength()"
          [value]="isFileInput() ? null : value()"
          (input)="onValueChange($event)"
          (change)="onInputChange($event)"
          (blur)="onBlur()"
        />
      }
    }
  `,
  styleUrl: './form-control.component.scss',
})
export class FpcFormControlComponent implements ControlValueAccessor {
  readonly controlType = input<FpcFormControlType>('input');
  readonly controlId = input<string | null>(null);
  readonly name = input<string | null>(null);
  readonly size = input<FpcFormControlSize>('md');
  readonly inputType = input('text');
  readonly placeholder = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly accept = input<string | null>(null);
  readonly rows = input(3);
  /** Native `size` attribute for multi-select list height. */
  readonly htmlSize = input<string | number | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly readOnly = input(false, { transform: booleanAttribute });
  readonly required = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly ariaDescribedBy = input<string | null>(null);
  /** Extra classes appended to the native control (e.g. `font-monospace`, `flex-grow-1`). */
  readonly controlClass = input<string | null>(null);
  readonly min = input<string | number | null>(null);
  readonly max = input<string | number | null>(null);
  readonly step = input<string | number | null>(null);
  readonly pattern = input<string | null>(null);
  readonly maxLength = input<string | number | null>(null);

  readonly value = model('');
  /** Multi-select selected option values (string). */
  readonly valuesChange = output<string[]>();
  /** File input `FileList` (or empty). */
  readonly filesChange = output<FileList | null>();

  private readonly cvaDisabled = signal(false);
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly isFileInput = computed(() => this.controlType() === 'input' && this.inputType() === 'file');

  protected readonly controlClasses = computed(() => {
    const classes = [this.controlType() === 'select' ? 'form-select' : 'form-control'];
    const size = this.size();

    if (size === 'sm' || size === 'lg') {
      classes.push(this.controlType() === 'select' ? `form-select-${size}` : `form-control-${size}`);
    } else if (size === 'xl') {
      // Landing / marketing scale above Bootstrap `lg` (same idea as `fpc-button` / search `xl`).
      classes.push(
        this.controlType() === 'select' ? 'form-select-lg' : 'form-control-lg',
        'fpc-form-control__control--xl',
      );
    }

    if (this.invalid()) {
      classes.push('is-invalid');
    }

    const extra = this.controlClass()?.trim();

    if (extra) {
      classes.push(extra);
    }

    return classes.join(' ');
  });

  writeValue(value: string | number | null): void {
    this.value.set(value == null || value === '' ? '' : String(value));
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }

  protected onValueChange(event: Event): void {
    if (this.isFileInput()) {
      return;
    }

    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

    this.value.set(target.value);
    this.onChange(target.value);
  }

  protected onSelectChange(event: Event): void {
    const select = event.target as HTMLSelectElement;

    if (this.multiple()) {
      const selected = Array.from(select.selectedOptions).map((option) => option.value);
      this.valuesChange.emit(selected);
      this.value.set(selected.join(','));
      this.onChange(this.value());
      return;
    }

    this.value.set(select.value);
    this.onChange(select.value);
  }

  protected onInputChange(event: Event): void {
    if (!this.isFileInput()) {
      return;
    }

    const inputEl = event.target as HTMLInputElement;
    this.filesChange.emit(inputEl.files);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
