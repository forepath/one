import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  input,
  model,
  output,
} from '@angular/core';

import { FpcButtonComponent, FpcButtonVariant } from '../button/button.component';
import { FpcButtonGroupComponent } from '../button-group/button-group.component';
import { FpcModalFooterDirective } from '../modal/modal-footer.directive';
import { FpcModalAccent, FpcModalComponent, FpcModalSize } from '../modal/modal.component';

/**
 * Confirmation prompt built on `fpc-modal`. Emits `confirmed` or `cancelled` and closes itself;
 * the caller owns the actual side effect.
 *
 * Defaults to `md` so longer copy (logout, destroy confirmations) stays readable; pass `sm` only
 * for very short prompts.
 *
 * `danger` / `warning` drive both the confirm button variant and the modal corner close accent
 * (fill + X ink match that button’s text/background colors).
 *
 * One action in the footer (no Cancel: the header X, Escape and the backdrop dismiss and emit `cancelled`). Label it
 * with the outcome's verb ("Delete", "Revoke"), never "Confirm" / "OK" / "Yes". A real second choice (e.g. "Keep
 * both" next to "Replace") goes in `alternativeLabel` / `(alternative)`, never a dismiss.
 *
 * Enter confirms while the dialog is open (unless busy, or focus is on a button / a multiline field).
 */
@Component({
  selector: 'fpc-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcModalComponent, FpcModalFooterDirective, FpcButtonComponent, FpcButtonGroupComponent],
  host: { class: 'fpc-confirm-dialog' },
  template: `
    <fpc-modal
      [open]="open()"
      [title]="title()"
      [size]="size()"
      [accent]="accent()"
      [closable]="!busy()"
      [closeOnBackdrop]="!busy()"
      [closeOnEscape]="!busy()"
      (openChange)="onModalOpenChange($event)"
    >
      @if (message()) {
        <p class="mb-0">{{ message() }}</p>
      }
      <ng-content />

      <div *fpcModalFooter>
        @if (alternativeLabel(); as alternative) {
          <fpc-button-group>
            <fpc-button variant="secondary" [disabled]="busy()" (clicked)="onAlternative()">{{
              alternative
            }}</fpc-button>
            <fpc-button [variant]="confirmVariant()" [loading]="busy()" (clicked)="onConfirm()">
              {{ confirmLabel() }}
            </fpc-button>
          </fpc-button-group>
        } @else {
          <fpc-button [variant]="confirmVariant()" [loading]="busy()" (clicked)="onConfirm()">
            {{ confirmLabel() }}
          </fpc-button>
        }
      </div>
    </fpc-modal>
  `,
})
export class FpcConfirmDialogComponent {
  readonly open = model(false);
  readonly title = input('Are you sure?');
  readonly message = input<string | null>(null);
  readonly confirmLabel = input('Confirm');
  /** Optional second action before the confirm (a real alternative outcome, not a dismiss). */
  readonly alternativeLabel = input<string | null>(null);
  readonly size = input<FpcModalSize>('md');
  /** Destructive confirm (danger button + close accent). Wins over `warning`. */
  readonly danger = input(false, { transform: booleanAttribute });
  /** Caution confirm (warning button + close accent with dark X). */
  readonly warning = input(false, { transform: booleanAttribute });
  /** Keeps the dialog open and disables the actions while the caller is working. */
  readonly busy = input(false, { transform: booleanAttribute });

  // `confirm` and `cancel` are standard DOM event names, so the outputs use the past tense.
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  readonly alternative = output<void>();

  protected readonly accent = computed<FpcModalAccent>(() => {
    if (this.danger()) {
      return 'danger';
    }

    if (this.warning()) {
      return 'warning';
    }

    return 'primary';
  });

  protected readonly confirmVariant = computed<FpcButtonVariant>(() => this.accent());

  @HostListener('document:keydown.enter', ['$event'])
  protected onEnter(event: Event): void {
    if (!this.open() || this.busy()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    // Let focused buttons/links keep native Enter activation (e.g. the header X).
    if (target.closest('button, a, [role="button"]')) {
      return;
    }

    // Multiline fields use Enter for newlines.
    if (target.closest('textarea, [contenteditable="true"]')) {
      return;
    }

    event.preventDefault();
    this.onConfirm();
  }

  protected onConfirm(): void {
    this.confirmed.emit();

    if (!this.busy()) {
      this.open.set(false);
    }
  }

  protected onAlternative(): void {
    this.alternative.emit();
    this.open.set(false);
  }

  protected onModalOpenChange(isOpen: boolean): void {
    if (!isOpen && this.open()) {
      this.open.set(false);
      this.cancelled.emit();
    }
  }
}
