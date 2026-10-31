import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** One choice of an `fpc-multi-select`. */
export interface FpcMultiSelectOption {
  value: string;
  label: string;
  /** Muted second line / trailing text (e.g. a code or a short description). */
  hint?: string;
  disabled?: boolean;
}

let nextMultiSelectId = 0;

/**
 * Multi-select / chip picker (DB-08a, 2026-10-29) instead of a native `<select multiple>` ("Hold Ctrl/Cmd to select
 * multiple …"): the chosen options as removable chips on top, then a filterable check list (search appears from
 * `searchFrom` options on). Works with reactive / template forms (`formControlName`, `ngModel`; value = `string[]`) and
 * as a signal model (`[(value)]`).
 *
 * ```html
 * <fpc-form-field forId="plans" [label]="plansLabel">
 *   <fpc-multi-select controlId="plans" formControlName="planIds" [options]="planOptions()"
 *     [searchPlaceholder]="searchPlansLabel" [removeLabel]="removeLabel" [emptyLabel]="noPlansLabel" />
 * </fpc-form-field>
 * ```
 */
@Component({
  selector: 'fpc-multi-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => FpcMultiSelectComponent), multi: true }],
  host: {
    class: 'fpc-multi-select',
    '[class.fpc-multi-select--disabled]': 'isDisabled()',
  },
  template: `
    @if (selectedOptions().length > 0) {
      <div class="fpc-multi-select__chips" data-testid="fpc-multi-select-chips">
        @for (option of selectedOptions(); track option.value) {
          <span class="fpc-multi-select__chip">
            <span class="fpc-multi-select__chip-label">{{ option.label }}</span>
            <button
              type="button"
              class="fpc-multi-select__chip-remove"
              [disabled]="isDisabled()"
              [attr.aria-label]="removeLabel().replace('{label}', option.label)"
              [title]="removeLabel().replace('{label}', option.label)"
              (click)="toggle(option.value, false)"
            >
              <i class="bi bi-x" aria-hidden="true"></i>
            </button>
          </span>
        }
      </div>
    }
    <div class="fpc-multi-select__box">
      @if (showSearch()) {
        <div class="fpc-multi-select__search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input
            type="search"
            class="form-control form-control-sm border-0 shadow-none"
            [placeholder]="searchPlaceholder()"
            [attr.aria-label]="searchPlaceholder()"
            [disabled]="isDisabled()"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            data-testid="fpc-multi-select-search"
          />
        </div>
      }
      <div
        class="fpc-multi-select__list"
        role="group"
        [attr.id]="controlId()"
        [attr.aria-label]="ariaLabel()"
        [style.max-height]="maxHeight()"
      >
        @for (option of visibleOptions(); track option.value) {
          <label class="fpc-multi-select__option form-check mb-0">
            <input
              type="checkbox"
              class="form-check-input"
              [checked]="selectedSet().has(option.value)"
              [disabled]="isDisabled() || option.disabled"
              [attr.data-value]="option.value"
              (change)="toggle(option.value, $any($event.target).checked)"
              (blur)="onTouched()"
            />
            <span class="form-check-label">{{ option.label }}</span>
            @if (option.hint) {
              <span class="fpc-multi-select__hint">{{ option.hint }}</span>
            }
          </label>
        } @empty {
          <div class="fpc-multi-select__empty">{{ emptyLabel() }}</div>
        }
      </div>
    </div>
  `,
  styleUrl: './multi-select.component.scss',
})
export class FpcMultiSelectComponent implements ControlValueAccessor {
  readonly options = input<readonly FpcMultiSelectOption[]>([]);
  /** Selected option values (two-way; also the form value). */
  readonly value = model<readonly string[]>([]);
  readonly controlId = input<string>(`fpc-multi-select-${nextMultiSelectId++}`);
  readonly ariaLabel = input<string | null>(null);
  readonly searchPlaceholder = input('Search');
  /** Chip remove button label; `{label}` = the option label. */
  readonly removeLabel = input('Remove {label}');
  /** Shown when nothing matches the search / there are no options. */
  readonly emptyLabel = input('No matches');
  /** The search field appears from this many options on. */
  readonly searchFrom = input(8);
  /** Max height of the check list (scrolls beyond). */
  readonly maxHeight = input('12rem');
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly query = signal('');
  private readonly formDisabled = signal(false);

  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
  protected readonly selectedSet = computed(() => new Set(this.value()));
  protected readonly selectedOptions = computed(() => {
    const byValue = new Map(this.options().map((option) => [option.value, option]));

    return this.value()
      .map((value) => byValue.get(value))
      .filter((option): option is FpcMultiSelectOption => !!option);
  });
  protected readonly showSearch = computed(() => this.options().length >= this.searchFrom());
  protected readonly visibleOptions = computed(() => {
    const needle = this.query().trim().toLocaleLowerCase();

    if (!needle) return this.options();

    return this.options().filter((option) =>
      `${option.label} ${option.hint ?? ''}`.toLocaleLowerCase().includes(needle),
    );
  });

  private onChange: (value: string[]) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  /** Adds (`on`) or removes a value, keeping the options' order. */
  toggle(value: string, on: boolean): void {
    const selected = new Set(this.value());

    if (on) selected.add(value);
    else selected.delete(value);

    const order = this.options().map((option) => option.value);
    const next = [
      ...order.filter((entry) => selected.has(entry)),
      ...[...selected].filter((entry) => !order.includes(entry)),
    ];

    this.value.set(next);
    this.onChange(next);
    this.onTouched();
  }

  writeValue(value: readonly string[] | null | undefined): void {
    this.value.set(Array.isArray(value) ? [...value] : []);
  }

  registerOnChange(fn: (value: string[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.formDisabled.set(disabled);
  }
}
