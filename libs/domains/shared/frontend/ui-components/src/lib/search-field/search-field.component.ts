import { ChangeDetectionStrategy, Component, computed, forwardRef, input, model, output, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type FpcSearchFieldSize = 'sm' | 'md' | 'lg' | 'xl';

export type FpcSearchFieldAppearance = 'default' | 'marketing';

/**
 * Search input following the shared `search-input-container` pattern: a fixed-width leading
 * `bi-search` glyph inside a Bootstrap input group, with an optional clear button.
 *
 * `appearance="marketing"` is the landing / blog hero search: larger radius, padded control, and
 * an overlaid leading icon (no console strip chrome). Use `size="xl"` (or `lg`) for hero scale.
 */
@Component({
  selector: 'fpc-search-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-search-field',
    '[class.fpc-search-field--marketing]': 'appearance() === "marketing"',
    '[class.fpc-search-field--sm]': 'appearance() === "default" && size() === "sm"',
    '[class.fpc-search-field--clearable]': 'clearable()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FpcSearchFieldComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="containerClasses()">
      <i class="bi bi-search fpc-search-field__icon" aria-hidden="true"></i>
      <input
        type="search"
        [class]="inputClasses()"
        [id]="inputId()"
        [attr.name]="name()"
        [attr.placeholder]="placeholder()"
        [attr.aria-label]="ariaLabel()"
        [attr.autocomplete]="autocomplete()"
        [disabled]="isDisabled()"
        [value]="value()"
        (input)="onInput($event)"
        (blur)="onBlur()"
      />
      @if (clearable() && value().length > 0) {
        <button
          type="button"
          class="btn btn-link border-0 fpc-search-field__clear"
          [attr.aria-label]="clearAriaLabel()"
          (click)="clear()"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      }
    </div>
  `,
  styleUrl: './search-field.component.scss',
})
export class FpcSearchFieldComponent implements ControlValueAccessor {
  readonly value = model('');
  readonly placeholder = input<string | null>('Search');
  readonly ariaLabel = input<string | null>('Search');
  readonly clearAriaLabel = input('Clear search');
  readonly inputId = input<string | null>(null);
  readonly name = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly size = input<FpcSearchFieldSize>('md');
  readonly appearance = input<FpcSearchFieldAppearance>('default');
  readonly disabled = input(false);
  readonly bordered = input(true);
  readonly clearable = input(true);

  readonly cleared = output<void>();

  private readonly cvaDisabled = signal(false);
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  protected readonly containerClasses = computed(() => {
    if (this.appearance() === 'marketing') {
      return 'fpc-search-field__container fpc-search-field__container--marketing';
    }

    const classes = ['input-group', 'search-input-container', 'fpc-search-field__container'];
    const size = this.size();

    if (size === 'sm' || size === 'lg') {
      classes.push(`input-group-${size}`);
    }

    if (this.bordered()) {
      classes.push('border', 'rounded');
    }

    return classes.join(' ');
  });

  protected readonly inputClasses = computed(() => {
    if (this.appearance() === 'marketing') {
      const classes = ['form-control', 'fpc-search-field__input', 'fpc-search-field__input--marketing'];
      const size = this.size();

      if (size === 'sm' || size === 'lg') {
        classes.push(`form-control-${size}`);
      } else if (size === 'xl') {
        classes.push('form-control-lg', 'fpc-search-field__input--xl');
      }

      return classes.join(' ');
    }

    return 'form-control border-0 fpc-search-field__input';
  });

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
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

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
  }

  protected onBlur(): void {
    this.onTouched();
  }

  protected clear(): void {
    this.value.set('');
    this.onChange('');
    this.cleared.emit();
  }
}
