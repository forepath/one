import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';

export type OperationsSceneStatus = 'ok' | 'scheduled' | 'attention';

export interface OperationsSceneItem {
  icon: string;
  name: string;
  meta: string;
  status: OperationsSceneStatus;
}

export interface OperationsScene {
  /** Heading of the board, e.g. "Network and connectivity". */
  title: string;
  items: readonly OperationsSceneItem[];
  /** Upcoming change in the footer, e.g. the next maintenance window. */
  nextLabel: string;
  nextValue: string;
}

const STATUS_LABELS: Record<OperationsSceneStatus, string> = {
  ok: 'Healthy',
  scheduled: 'Scheduled',
  attention: 'Attention',
};

/** Managed IT scene: the operations board ForePath runs for one IT domain, from health to the next change. */
@Component({
  selector: 'framework-forepath-operations-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent],
  template: `
    <shared-app-illustration [label]="label()" windowTitle="ForePath operations" [width]="760" [height]="600">
      <div class="operations-illustration__shell">
        <nav class="sai-rail">
          <span class="sai-rail__brand"><i class="bi bi-activity"></i></span>
          @for (icon of railIcons(); track icon) {
            <span class="sai-rail__item" [class.sai-rail__item--active]="icon === activeIcon()">
              <i class="bi" [class]="icon"></i>
            </span>
          }
        </nav>

        <section class="sai-col sai-col--grow operations-illustration">
          <header class="operations-illustration__header">
            <span class="fw-semibold">{{ scene().title }}</span>
            <span
              class="operations-illustration__summary"
              [class.operations-illustration__summary--attention]="attentionCount() > 0"
            >
              <i
                class="bi"
                [class]="attentionCount() > 0 ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill'"
              ></i>
              {{ attentionCount() > 0 ? attentionCount() + ' item needs attention' : 'All systems operational' }}
            </span>
          </header>

          <div class="operations-illustration__body sai-body">
            <p class="operations-illustration__label">Managed by ForePath</p>
            <ul class="list-unstyled mb-0 operations-illustration__items">
              @for (item of scene().items; track item.name) {
                <li class="operations-illustration__item">
                  <i class="bi" [class]="item.icon"></i>
                  <span class="flex-grow-1">
                    <span class="d-block fw-semibold">{{ item.name }}</span>
                    <span class="small text-body-secondary">{{ item.meta }}</span>
                  </span>
                  <span
                    class="operations-illustration__status"
                    [class]="'operations-illustration__status--' + item.status"
                  >
                    {{ statusLabels[item.status] }}
                  </span>
                </li>
              }
            </ul>

            <p class="operations-illustration__label">Service level, last 30 days</p>
            <div class="operations-illustration__bars">
              @for (bar of uptimeBars; track $index) {
                <span class="operations-illustration__bar" [class.operations-illustration__bar--dip]="bar"></span>
              }
            </div>
          </div>

          <footer class="operations-illustration__footer">
            <span>
              <span class="small text-body-secondary d-block">{{ scene().nextLabel }}</span>
              <span class="fw-semibold">{{ scene().nextValue }}</span>
            </span>
            <span class="operations-illustration__cta"
              ><i class="bi bi-file-earmark-bar-graph"></i> Monthly report</span
            >
          </footer>
        </section>
      </div>
    </shared-app-illustration>
  `,
  styles: [
    `
      // The canvas lays its children out in a row: the shell takes the full design width and height,
      // the board column grows into everything right of the rail.
      .operations-illustration__shell {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
      }

      .operations-illustration__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.875rem 1.25rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .operations-illustration__summary {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--bs-success);
        background-color: color-mix(in srgb, var(--bs-success) 12%, transparent);
        border-radius: 999px;
      }

      .operations-illustration__summary--attention {
        color: var(--bs-warning-text-emphasis);
        background-color: color-mix(in srgb, var(--bs-warning) 16%, transparent);
      }

      .operations-illustration__body {
        padding: 0 1.25rem 0.75rem;
      }

      .operations-illustration__label {
        margin: 1rem 0 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--bs-secondary-color);
      }

      .operations-illustration__items {
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 0.5rem;
      }

      .operations-illustration__item {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.625rem 0.875rem;

        & + & {
          border-top: var(--bs-border-width) solid var(--bs-border-color);
        }

        > .bi {
          font-size: 1.25rem;
          color: var(--bs-primary);
        }
      }

      .operations-illustration__status {
        padding: 0.1875rem 0.5rem;
        font-size: 0.6875rem;
        font-weight: 600;
        white-space: nowrap;
        border-radius: 999px;
      }

      .operations-illustration__status--ok {
        color: var(--bs-success);
        background-color: color-mix(in srgb, var(--bs-success) 12%, transparent);
      }

      .operations-illustration__status--scheduled {
        color: var(--bs-primary);
        background-color: color-mix(in srgb, var(--bs-primary) 12%, transparent);
      }

      .operations-illustration__status--attention {
        color: var(--bs-warning-text-emphasis);
        background-color: color-mix(in srgb, var(--bs-warning) 16%, transparent);
      }

      .operations-illustration__bars {
        display: flex;
        gap: 0.1875rem;
        height: 1.75rem;
      }

      .operations-illustration__bar {
        flex: 1 1 0;
        border-radius: 0.125rem;
        background-color: color-mix(in srgb, var(--bs-success) 55%, transparent);
      }

      .operations-illustration__bar--dip {
        background-color: color-mix(in srgb, var(--bs-warning) 65%, transparent);
      }

      .operations-illustration__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: auto;
        padding: 1rem 1.25rem;
        border-top: var(--bs-border-width) solid var(--bs-border-color);
      }

      .operations-illustration__cta {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5625rem 1.125rem;
        font-size: 0.875rem;
        font-weight: 600;
        color: #fff;
        background-color: var(--bs-primary);
        border-radius: 0.375rem;
      }
    `,
  ],
})
export class OperationsIllustrationComponent {
  readonly label = input.required<string>();
  readonly scene = input.required<OperationsScene>();
  /** Icons of all IT domains for the rail; `activeIcon` marks the one shown. */
  readonly railIcons = input.required<readonly string[]>();
  readonly activeIcon = input.required<string>();

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly attentionCount = computed(
    () => this.scene().items.filter((item) => item.status === 'attention').length,
  );
  // One short dip in an otherwise steady month.
  protected readonly uptimeBars = Array.from({ length: 30 }, (_, day) => day === 17);
}
