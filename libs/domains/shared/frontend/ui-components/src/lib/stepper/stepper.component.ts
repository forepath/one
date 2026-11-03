import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, model, output } from '@angular/core';

import { FpcStepStripComponent } from '../step-strip/step-strip.component';
import { FpcStepStripDirective } from '../step-strip/step-strip.directive';

/** One step of `fpc-stepper`. */
export interface FpcStep {
  id: string;
  label: string;
  description?: string;
  /** The step's input is incomplete / invalid: a linear stepper does not move past it. */
  invalid?: boolean;
  optional?: boolean;
  disabled?: boolean;
}

/** Whether a stepper at `active` may jump to `target` (back always; forward only over valid, enabled steps when linear). */
export function fpcStepReachable(steps: readonly FpcStep[], active: number, target: number, linear: boolean): boolean {
  if (target < 0 || target >= steps.length || steps[target].disabled) return false;
  if (target <= active || !linear) return true;

  return steps.slice(0, target).every((step) => step.disabled || !step.invalid);
}

/**
 * Wizard steps (horizontal header, vertical on narrow hosts) with Back / Next / Finish. The
 * consumer renders the active step's content (`@switch (stepper.active())`). Linear by default:
 * the user moves forward only past steps that are not `invalid`.
 *
 * Slots: default = the active step's body, `[fpcStepperActions]` = extra footer buttons (left of
 * Back / Next, e.g. "Edit as YAML").
 */
@Component({
  selector: 'fpc-stepper',
  standalone: true,
  imports: [FpcStepStripComponent, FpcStepStripDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-stepper' },
  template: `
    <fpc-step-strip class="fpc-stepper__strip">
      <ol class="fpc-stepper__steps list-unstyled mb-0" fpcStepStrip [attr.aria-label]="ariaLabel()">
        @for (step of steps(); track step.id; let index = $index) {
          <li class="fpc-stepper__step">
            <button
              type="button"
              class="fpc-stepper__step-button"
              [class.fpc-stepper__step-button--active]="index === active()"
              [class.fpc-stepper__step-button--done]="index < active() && !step.invalid"
              [class.fpc-stepper__step-button--invalid]="step.invalid && index < active()"
              [disabled]="!reachable(index)"
              [attr.aria-current]="index === active() ? 'step' : null"
              [attr.data-step-id]="step.id"
              (click)="goTo(index)"
            >
              <span class="fpc-stepper__number" aria-hidden="true">
                @if (index < active() && !step.invalid) {
                  <i class="bi bi-check-lg"></i>
                } @else if (step.invalid && index < active()) {
                  <i class="bi bi-exclamation-lg"></i>
                } @else {
                  {{ index + 1 }}
                }
              </span>
              <span class="fpc-stepper__label">
                {{ step.label }}
                @if (step.optional && optionalLabel()) {
                  <small class="text-body-secondary">({{ optionalLabel() }})</small>
                }
              </span>
            </button>
          </li>
        }
      </ol>
    </fpc-step-strip>
    <div class="fpc-stepper__body">
      @if (current()?.description) {
        <p class="text-body-secondary small mb-3">{{ current()?.description }}</p>
      }
      <ng-content />
    </div>
    @if (showNavigation()) {
      <div class="fpc-stepper__footer">
        <ng-content select="[fpcStepperActions]" />
        <span class="flex-grow-1"></span>
        <button
          type="button"
          class="btn btn-sm btn-secondary"
          [disabled]="active() === 0"
          (click)="previous()"
          data-testid="fpc-stepper-back"
        >
          {{ backLabel() }}
        </button>
        @if (isLast()) {
          <button
            type="button"
            class="btn btn-sm btn-primary"
            [disabled]="!canFinish() || busy()"
            (click)="finished.emit()"
            data-testid="fpc-stepper-finish"
          >
            {{ finishLabel() }}
          </button>
        } @else {
          <button
            type="button"
            class="btn btn-sm btn-primary"
            [disabled]="!reachable(active() + 1)"
            (click)="next()"
            data-testid="fpc-stepper-next"
          >
            {{ nextLabel() }}
          </button>
        }
      </div>
    }
  `,
  styleUrl: './stepper.component.scss',
})
export class FpcStepperComponent {
  readonly steps = input<readonly FpcStep[]>([]);
  readonly active = model(0);
  readonly linear = input(true, { transform: booleanAttribute });
  readonly showNavigation = input(true, { transform: booleanAttribute });
  readonly busy = input(false, { transform: booleanAttribute });
  readonly ariaLabel = input('Steps');
  readonly backLabel = input('Back');
  readonly nextLabel = input('Next');
  readonly finishLabel = input('Finish');
  readonly optionalLabel = input('optional');

  readonly finished = output<void>();

  protected readonly current = computed(() => this.steps()[this.active()] ?? null);
  protected readonly isLast = computed(() => this.active() >= this.steps().length - 1);
  protected readonly canFinish = computed(() => this.steps().every((step) => step.disabled || !step.invalid));

  reachable(index: number): boolean {
    return fpcStepReachable(this.steps(), this.active(), index, this.linear());
  }

  goTo(index: number): boolean {
    if (!this.reachable(index)) return false;

    this.active.set(index);

    return true;
  }

  next(): boolean {
    for (let index = this.active() + 1; index < this.steps().length; index++) {
      if (!this.steps()[index].disabled) return this.goTo(index);
    }

    return false;
  }

  previous(): boolean {
    for (let index = this.active() - 1; index >= 0; index--) {
      if (!this.steps()[index].disabled) return this.goTo(index);
    }

    return false;
  }
}
