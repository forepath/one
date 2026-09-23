import { ChangeDetectionStrategy, Component, computed, forwardRef, input, model, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextSwitchId = 0;

/** Bootstrap form-switch (on/off) with ControlValueAccessor support. */
@Component({
  selector: 'fpc-form-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-form-switch' },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FpcFormSwitchComponent),
      multi: true,
    },
  ],
  template: `
    <div class="form-check form-switch">
      <input
        class="form-check-input"
        type="checkbox"
        role="switch"
        [id]="resolvedId()"
        [checked]="checked()"
        [disabled]="isDisabled()"
        [attr.aria-label]="label() ? null : ariaLabel()"
        (change)="onToggle($event)"
        (blur)="onBlur()"
      />
      @if (label()) {
        <label class="form-check-label" [for]="resolvedId()">{{ label() }}</label>
      }
      <ng-content />
    </div>
  `,
  styleUrl: './form-switch.component.scss',
})
export class FpcFormSwitchComponent implements ControlValueAccessor {
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly label = input<string | null>(null);
  readonly switchId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);

  private readonly fallbackId = `fpc-form-switch-${nextSwitchId++}`;
  private readonly cvaDisabled = signal(false);
  private onChange: (value: boolean) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected readonly resolvedId = computed(() => this.switchId() ?? this.fallbackId);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  writeValue(value: boolean | null): void {
    this.checked.set(Boolean(value));
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

  protected onToggle(event: Event): void {
    const next = (event.target as HTMLInputElement).checked;

    this.checked.set(next);
    this.onChange(next);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
