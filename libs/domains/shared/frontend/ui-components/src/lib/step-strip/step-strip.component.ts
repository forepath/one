import {
  ChangeDetectionStrategy,
  Component,
  contentChild,
  type EnvironmentProviders,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
} from '@angular/core';

import { FpcStepStripDirective } from './step-strip.directive';

/** Texts of `fpc-step-strip`; provide them once per app (localized) with `provideFpcStepStripLabels()`. */
export interface FpcStepStripLabels {
  previous: string;
  next: string;
}

const DEFAULT_STEP_STRIP_LABELS: FpcStepStripLabels = { previous: 'Earlier steps', next: 'Later steps' };

export const FPC_STEP_STRIP_LABELS = new InjectionToken<FpcStepStripLabels>('FPC_STEP_STRIP_LABELS', {
  providedIn: 'root',
  factory: () => DEFAULT_STEP_STRIP_LABELS,
});

export function provideFpcStepStripLabels(labels: Partial<FpcStepStripLabels>): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: FPC_STEP_STRIP_LABELS, useValue: { ...DEFAULT_STEP_STRIP_LABELS, ...labels } },
  ]);
}

/**
 * Chevrons around a step list (`<ol fpcStepStrip>` projected inside): shown only while the steps overflow, each one
 * disabled (still visible) at its end. The strip itself keeps the current step in view; the chevrons page through
 * the rest.
 *
 * `<fpc-step-strip><ol class="…" fpcStepStrip>…</ol></fpc-step-strip>`
 */
@Component({
  selector: 'fpc-step-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-step-strip-nav' },
  template: `
    @if (strip(); as s) {
      @if (s.overflowing()) {
        <button
          type="button"
          class="fpc-step-strip-nav__button"
          [disabled]="s.atStart()"
          [attr.aria-label]="labels.previous"
          [title]="labels.previous"
          (click)="s.page(-1)"
          data-testid="fpc-step-strip-previous"
        >
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
      }
    }
    <div class="fpc-step-strip-nav__viewport"><ng-content /></div>
    @if (strip(); as s) {
      @if (s.overflowing()) {
        <button
          type="button"
          class="fpc-step-strip-nav__button"
          [disabled]="s.atEnd()"
          [attr.aria-label]="labels.next"
          [title]="labels.next"
          (click)="s.page(1)"
          data-testid="fpc-step-strip-next"
        >
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      min-width: 0;
    }

    .fpc-step-strip-nav__viewport {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
    }

    .fpc-step-strip-nav__viewport > ::ng-deep .fpc-step-strip {
      flex: 1 1 auto;
      min-width: 0;
    }

    .fpc-step-strip-nav__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 2rem;
      height: 2rem;
      padding: 0;
      border: 0;
      border-radius: var(--bs-border-radius);
      background: transparent;
      color: var(--bs-secondary-color);

      &:hover:not(:disabled) {
        color: var(--bs-emphasis-color);
        background: var(--bs-tertiary-bg);
      }

      &:focus-visible {
        outline: 0;
        box-shadow: var(--bs-focus-ring-x, 0) var(--bs-focus-ring-y, 0) var(--bs-focus-ring-blur, 0)
          var(--bs-focus-ring-width) var(--bs-focus-ring-color);
      }

      &:disabled {
        opacity: 0.35;
      }
    }
  `,
})
export class FpcStepStripComponent {
  readonly strip = contentChild(FpcStepStripDirective);
  readonly labels = inject(FPC_STEP_STRIP_LABELS);
}
