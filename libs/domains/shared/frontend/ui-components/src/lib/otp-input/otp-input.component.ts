import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  forwardRef,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const DEFAULT_CODE_LENGTH = 6;

/**
 * One-time-code input migrated from `identity/frontend/feature-auth`. Accepts alphanumeric
 * characters, supports paste of a full code, and exposes the joined value through
 * `ControlValueAccessor`.
 *
 * Labels are plain inputs rather than `$localize` messages so each consuming app keeps
 * ownership of its own translation catalogue.
 */
@Component({
  selector: 'fpc-otp-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-otp-input' },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FpcOtpInputComponent),
      multi: true,
    },
  ],
  template: `
    <div class="otp-input d-flex align-items-center gap-2" (paste)="onPaste($event)" (focusout)="onBlur($event)">
      <div class="otp-input__digits d-flex gap-1" [class.otp-input__digits--invalid]="invalid()">
        @for (index of digits(); track index) {
          <input
            #digitInput
            type="text"
            inputmode="text"
            pattern="[A-Z0-9]*"
            maxlength="1"
            autocomplete="one-time-code"
            class="form-control text-center otp-digit"
            [attr.aria-invalid]="invalid()"
            [attr.aria-label]="ariaLabelFor(index)"
            [value]="digitAt(index)"
            [readonly]="isDisabled()"
            (input)="onInput($event, index)"
            (keydown)="onKeydown($event, index)"
          />
        }
      </div>
      @if (invalid()) {
        <i class="bi bi-exclamation-circle text-danger otp-input__error-icon" aria-hidden="true"></i>
        <span class="visually-hidden">{{ invalidText() }}</span>
      }
    </div>
  `,
  styleUrl: './otp-input.component.scss',
})
export class FpcOtpInputComponent implements ControlValueAccessor {
  readonly length = input(DEFAULT_CODE_LENGTH);
  readonly invalid = input(false);
  readonly disabled = input(false);
  readonly invalidText = input('Invalid verification code');
  /** `{index}` and `{total}` are replaced with the 1-based position and the code length. */
  readonly ariaLabelTemplate = input('Character {index} of {total}');

  private readonly digitInputs = viewChildren<ElementRef<HTMLInputElement>>('digitInput');
  private readonly internalValue = signal('');
  private readonly cvaDisabled = signal(false);
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected readonly digits = computed(() => Array.from({ length: this.length() }, (_, index) => index));
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  get value(): string {
    return this.internalValue();
  }

  writeValue(value: string | null): void {
    this.internalValue.set(this.normalise(value ?? ''));
    this.syncInputsFromValue();
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

  protected digitAt(index: number): string {
    return this.internalValue()[index] ?? '';
  }

  protected ariaLabelFor(index: number): string {
    return this.ariaLabelTemplate()
      .replace('{index}', String(index + 1))
      .replace('{total}', String(this.length()));
  }

  protected onInput(event: Event, index: number): void {
    const target = event.target as HTMLInputElement;
    const raw = this.normalise(target.value);
    const codeLength = this.length();

    if (raw.length >= codeLength) {
      this.commit(raw.slice(0, codeLength));
      this.syncInputsFromValue();
      this.focusInput(codeLength - 1);

      return;
    }

    if (raw.length === 1) {
      const current = this.internalValue();

      this.commit((current.slice(0, index) + raw + current.slice(index + 1)).slice(0, codeLength));
      target.value = raw;

      if (index < codeLength - 1) {
        this.focusInput(index + 1);
      }
    } else if (raw.length === 0) {
      const current = this.internalValue();

      this.commit(current.slice(0, index) + current.slice(index + 1));
    }
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace' && !this.digitAt(index) && index > 0) {
      this.focusInput(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focusInput(index - 1);
    } else if (event.key === 'ArrowRight' && index < this.length() - 1) {
      event.preventDefault();
      this.focusInput(index + 1);
    }
  }

  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = this.normalise(event.clipboardData?.getData('text') ?? '');

    if (pasted.length === 0) {
      return;
    }

    this.commit(pasted);
    this.syncInputsFromValue();
    this.focusInput(Math.min(pasted.length, this.length()) - 1);
  }

  protected onBlur(event: FocusEvent): void {
    const container = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as HTMLElement | null;

    if (!relatedTarget || !container.contains(relatedTarget)) {
      this.onTouched();
    }
  }

  private commit(value: string): void {
    const next = value.slice(0, this.length());

    this.internalValue.set(next);
    this.onChange(next);
  }

  private normalise(value: string): string {
    return value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, this.length());
  }

  private focusInput(index: number): void {
    // The inputs are re-rendered by the value change, so focus on the next macrotask.
    setTimeout(() => {
      this.digitInputs()[index]?.nativeElement.focus();
    }, 0);
  }

  private syncInputsFromValue(): void {
    setTimeout(() => {
      this.digitInputs().forEach((inputRef, index) => {
        inputRef.nativeElement.value = this.digitAt(index);
      });
    }, 0);
  }
}
