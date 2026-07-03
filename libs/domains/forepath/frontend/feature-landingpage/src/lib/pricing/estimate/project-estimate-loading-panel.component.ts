import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProjectEstimatorFacade } from '@forepath/forepath/frontend/data-access-project-estimator';
import { auditTime, distinctUntilChanged } from 'rxjs';

import {
  OVERLAY_MESSAGE_ROTATION_MS,
  PROJECT_ESTIMATE_GENERATING_MESSAGES,
  PROJECT_ESTIMATE_WARMUP_MESSAGES,
} from './project-estimate-overlay.messages';

export type EstimateLoadingMode = 'checking' | 'warmup' | 'generating';

@Component({
  selector: 'framework-forepath-project-estimate-loading-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .estimate-loading__spinner-wrap {
        display: flex;
        justify-content: center;
        margin-bottom: 1rem;
      }

      .estimate-loading__spinner-wrap .spinner-border {
        width: 3rem;
        height: 3rem;
        animation-duration: 0.75s;
        animation-timing-function: linear;
      }

      .estimate-loading__message-wrap {
        min-height: 3rem;
        margin-top: 0.75rem;
      }

      .estimate-loading__message {
        margin: 0;
        color: var(--bs-secondary-color);
      }

      .estimate-loading__progress {
        height: 0.65rem;
      }

      .estimate-loading__progress .progress-bar {
        transition: none;
      }

      .estimate-notice-alert {
        --bs-alert-bg: rgba(var(--bs-warning-rgb), 0.12);
        --bs-alert-border-color: rgba(var(--bs-warning-rgb), 0.35);
        --bs-alert-color: var(--bs-body-color);
        text-align: start;
      }

      .estimate-notice-alert p:last-child {
        margin-bottom: 0;
      }
    `,
  ],
  template: `
    <div
      class="estimate-chat__overlay-card text-center w-100"
      role="status"
      aria-live="polite"
      [attr.aria-busy]="mode() !== 'checking' ? true : null"
      [attr.aria-label]="
        mode() === 'warmup' ? warmupOverlayAriaLabel : mode() === 'generating' ? generatingOverlayAriaLabel : null
      "
    >
      <div class="estimate-loading__spinner-wrap" aria-hidden="true">
        <div class="spinner-border text-primary"></div>
      </div>

      @if (mode() === 'checking') {
        <p class="mb-0" i18n="@@featureForepathProjectEstimate-checkingDevice">
          Checking whether this device can run the local estimation model...
        </p>
      } @else {
        @if (mode() === 'warmup') {
          <h3 class="h5 fw-semibold mb-2" i18n="@@featureForepathProjectEstimate-warmupTitle">
            Preparing your local estimator
          </h3>
        } @else {
          <h3 class="h5 fw-semibold mb-2" i18n="@@featureForepathProjectEstimate-generatingTitle">
            Building your estimate
          </h3>
        }

        <div class="estimate-loading__message-wrap">
          <p class="estimate-loading__message">{{ rotatingMessage() }}</p>
        </div>

        @if (mode() === 'warmup') {
          <div
            class="alert alert-warning estimate-notice-alert mt-3 mb-0 text-start"
            role="note"
            i18n-aria-label="@@featureForepathProjectEstimate-warmupCacheDisclaimerAriaLabel"
            aria-label="Model load time notice"
          >
            <p class="mb-0" i18n="@@featureForepathProjectEstimate-warmupCacheDisclaimer">
              The first load downloads the model to your device and can take a minute or longer. Later visits load from
              your browser cache and start much faster.
            </p>
          </div>
        }

        @if (mode() === 'warmup') {
          <div
            class="progress estimate-loading__progress mt-3 mb-2"
            role="progressbar"
            [attr.aria-valuenow]="progressPercent()"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="progress-bar" [style.width.%]="progressPercent()"></div>
          </div>
          <p class="small text-muted mb-0">
            <span i18n="@@featureForepathProjectEstimate-warmupProgressLabel">Progress:</span>
            {{ progressPercent() }}%
          </p>
        } @else {
          <p class="small text-muted mb-0 mt-3" i18n="@@featureForepathProjectEstimate-generatingHint">
            Your request is processed locally on this device.
          </p>
        }
      }
    </div>
  `,
})
export class ForepathProjectEstimateLoadingPanelComponent {
  readonly mode = input.required<EstimateLoadingMode>();

  readonly rotatingMessage = signal('');
  readonly progressPercent = signal(0);

  readonly warmupOverlayAriaLabel = $localize`:@@featureForepathProjectEstimate-warmupOverlayAriaLabel:Preparing the local project estimator`;
  readonly generatingOverlayAriaLabel = $localize`:@@featureForepathProjectEstimate-generatingOverlayAriaLabel:Generating your project estimate`;

  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly facade = inject(ProjectEstimatorFacade);

  private messageIndex = 0;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const mode = this.mode();

      if (mode === 'checking') {
        this.stopMessageRotation();
        this.rotatingMessage.set('');
        return;
      }

      const messages = this.getMessages(mode);

      this.messageIndex = 0;
      this.rotatingMessage.set(messages[0] ?? '');
      this.restartMessageRotation(mode);
    });

    this.facade.modelLoadProgress$
      .pipe(
        auditTime(500),
        distinctUntilChanged((previous, current) => Math.round(previous * 10) === Math.round(current * 10)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((progress) => {
        if (this.mode() !== 'warmup') {
          return;
        }

        this.progressPercent.set(Math.min(100, Math.max(0, Math.round(progress * 100))));
      });

    this.destroyRef.onDestroy(() => this.stopMessageRotation());
  }

  private restartMessageRotation(mode: EstimateLoadingMode): void {
    this.stopMessageRotation();

    const messages = this.getMessages(mode);

    if (messages.length <= 1) {
      return;
    }

    this.rotationTimer = this.ngZone.runOutsideAngular(() =>
      setInterval(() => {
        this.messageIndex = (this.messageIndex + 1) % messages.length;
        this.ngZone.run(() => {
          this.rotatingMessage.set(messages[this.messageIndex] ?? '');
        });
      }, OVERLAY_MESSAGE_ROTATION_MS),
    );
  }

  private stopMessageRotation(): void {
    if (this.rotationTimer !== null) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  private getMessages(mode: EstimateLoadingMode): readonly string[] {
    return mode === 'warmup' ? PROJECT_ESTIMATE_WARMUP_MESSAGES : PROJECT_ESTIMATE_GENERATING_MESSAGES;
  }
}
