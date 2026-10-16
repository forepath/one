import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';

interface PipelineStep {
  name: string;
  duration: string;
}

/**
 * Company evolution scene: one routine change done three ways, by hand (2016), through a pipeline
 * (2023) and by a coding agent with an engineer's review (2025).
 */
@Component({
  selector: 'framework-forepath-evolution-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent],
  template: `
    <shared-app-illustration [label]="label()" windowTitle="ForePath, 2016 to today" [width]="760" [height]="600">
      <section class="sai-col sai-col--grow evolution-illustration">
        <header class="evolution-illustration__header">
          <span class="small text-body-secondary">Change request</span>
          <span class="fw-semibold">Renew TLS certificates on 40 services</span>
        </header>

        <div class="evolution-illustration__eras">
          <article class="evolution-illustration__era">
            <div class="evolution-illustration__era-head">
              <span class="evolution-illustration__year">2016</span>
              <span class="fw-semibold">Hands-on</span>
              <span class="evolution-illustration__time"><i class="bi bi-clock"></i> about a day</span>
            </div>
            <div class="evolution-illustration__terminal">
              @for (line of terminalLines; track line) {
                <span class="d-block"><span class="evolution-illustration__prompt">$</span> {{ line }}</span>
              }
              <span class="d-block text-body-secondary">... 39 more servers</span>
            </div>
          </article>

          <article class="evolution-illustration__era">
            <div class="evolution-illustration__era-head">
              <span class="evolution-illustration__year">2023</span>
              <span class="fw-semibold">Automated</span>
              <span class="evolution-illustration__time"><i class="bi bi-clock"></i> about 20 minutes</span>
            </div>
            <ol class="evolution-illustration__pipeline list-unstyled mb-0">
              @for (step of pipelineSteps; track step.name) {
                <li class="evolution-illustration__step">
                  <i class="bi bi-check-circle-fill"></i>
                  <span class="flex-grow-1">{{ step.name }}</span>
                  <span class="small text-body-secondary">{{ step.duration }}</span>
                </li>
              }
            </ol>
          </article>

          <article class="evolution-illustration__era evolution-illustration__era--now">
            <div class="evolution-illustration__era-head">
              <span class="evolution-illustration__year">2025</span>
              <span class="fw-semibold">AI native</span>
              <span class="evolution-illustration__time"><i class="bi bi-clock"></i> minutes, with review</span>
            </div>
            <div class="evolution-illustration__agent">
              <span class="evolution-illustration__avatar"><i class="bi bi-robot"></i></span>
              <p class="mb-0">
                Renewal prepared for all 40 services. Tests are green and the rollout plan is attached. Ready for your
                review.
              </p>
            </div>
            <div class="evolution-illustration__review">
              <span class="evolution-illustration__avatar evolution-illustration__avatar--human"
                ><i class="bi bi-person"></i
              ></span>
              <span class="flex-grow-1 small text-body-secondary">Engineer reviewed the change</span>
              <span class="evolution-illustration__approve"><i class="bi bi-check-lg"></i> Approve and roll out</span>
            </div>
          </article>
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .evolution-illustration__header {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.875rem 1.25rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .evolution-illustration__eras {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 0.875rem;
        padding: 1rem 1.25rem 1.25rem;
      }

      .evolution-illustration__era {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        padding: 0.875rem 1rem;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 0.5rem;
      }

      .evolution-illustration__era--now {
        flex: 1 1 auto;
        border-color: color-mix(in srgb, var(--bs-primary) 45%, transparent);
        background-color: color-mix(in srgb, var(--bs-primary) 6%, transparent);
      }

      .evolution-illustration__era-head {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        font-size: 0.875rem;
      }

      .evolution-illustration__year {
        padding: 0.125rem 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--bs-primary);
        background-color: color-mix(in srgb, var(--bs-primary) 12%, transparent);
        border-radius: 999px;
      }

      .evolution-illustration__time {
        margin-left: auto;
        font-size: 0.75rem;
        color: var(--bs-secondary-color);
      }

      .evolution-illustration__terminal {
        padding: 0.625rem 0.75rem;
        font-family: var(--bs-font-monospace);
        font-size: 0.75rem;
        line-height: 1.6;
        background-color: var(--bs-tertiary-bg);
        border-radius: 0.375rem;
      }

      .evolution-illustration__prompt {
        color: var(--bs-primary);
      }

      .evolution-illustration__pipeline {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.5rem;
      }

      .evolution-illustration__step {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.625rem;
        font-size: 0.8125rem;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 0.375rem;

        > .bi {
          color: var(--bs-success);
        }
      }

      .evolution-illustration__agent {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        font-size: 0.8125rem;
      }

      .evolution-illustration__avatar {
        display: grid;
        flex-shrink: 0;
        place-items: center;
        width: 2rem;
        height: 2rem;
        color: #fff;
        background-color: var(--bs-primary);
        border-radius: 50%;
      }

      .evolution-illustration__avatar--human {
        color: var(--bs-body-color);
        background-color: var(--bs-tertiary-bg);
        border: var(--bs-border-width) solid var(--bs-border-color);
      }

      .evolution-illustration__review {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: auto;
        padding-top: 0.75rem;
        border-top: var(--bs-border-width) solid var(--bs-border-color);
      }

      .evolution-illustration__approve {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.4375rem 0.875rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: #fff;
        background-color: var(--bs-primary);
        border-radius: 0.375rem;
      }
    `,
  ],
})
export class EvolutionIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly terminalLines = ['ssh web-01', 'certbot renew', 'systemctl reload nginx'];
  protected readonly pipelineSteps: readonly PipelineStep[] = [
    { name: 'Plan', duration: '1 min' },
    { name: 'Apply', duration: '14 min' },
    { name: 'Verify', duration: '3 min' },
  ];
}
