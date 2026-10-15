import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';

interface RentalItem {
  icon: string;
  name: string;
  meta: string;
  rate: string;
  /** ForePath managed services folded into the same monthly rate. */
  service?: boolean;
}

/** Hardware rental scene: a topi checkout for a ForePath setup, from hardware to delivery. */
@Component({
  selector: 'framework-forepath-rental-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent],
  template: `
    <shared-app-illustration [label]="label()" address="topi.eu/checkout" [width]="620" [height]="600">
      <section class="sai-col sai-col--grow rental-illustration">
        <header class="rental-illustration__header">
          <img src="assets/images/logos/topi.svg" alt="" class="rental-illustration__logo" />
          <span class="small text-body-secondary">Rental for ForePath customers</span>
        </header>

        <ol class="rental-illustration__steps list-unstyled mb-0">
          @for (step of steps; track step; let index = $index) {
            <li
              class="rental-illustration__step"
              [class.rental-illustration__step--done]="index < activeStep"
              [class.rental-illustration__step--active]="index === activeStep"
            >
              <span class="rental-illustration__step-dot">
                @if (index < activeStep) {
                  <i class="bi bi-check-lg"></i>
                } @else {
                  {{ index + 1 }}
                }
              </span>
              {{ step }}
            </li>
          }
        </ol>

        <div class="rental-illustration__body sai-body">
          <p class="rental-illustration__label">Your setup</p>
          <ul class="list-unstyled mb-0 rental-illustration__items">
            @for (item of items; track item.name) {
              <li class="rental-illustration__item" [class.rental-illustration__item--service]="item.service">
                <i class="bi" [class]="item.icon"></i>
                <span class="flex-grow-1">
                  <span class="d-block fw-semibold">{{ item.name }}</span>
                  <span class="small text-body-secondary">{{ item.meta }}</span>
                </span>
                <span class="text-nowrap">{{ item.rate }}</span>
              </li>
            }
          </ul>

          <p class="rental-illustration__label">Rental term</p>
          <div class="rental-illustration__terms">
            @for (term of terms; track term) {
              <span class="rental-illustration__term" [class.rental-illustration__term--active]="term === activeTerm"
                >{{ term }} months</span
              >
            }
          </div>
        </div>

        <footer class="rental-illustration__footer">
          <span>
            <span class="small text-body-secondary d-block">Monthly rate, 24 months</span>
            <span class="rental-illustration__total">€ 512 / month</span>
          </span>
          <span class="rental-illustration__cta">Request rental</span>
        </footer>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .rental-illustration__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.875rem 1.25rem;
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .rental-illustration__logo {
        height: 1.375rem;
      }

      .rental-illustration__steps {
        display: flex;
        gap: 1.25rem;
        padding: 0.875rem 1.25rem;
        font-size: 0.8125rem;
        color: var(--bs-secondary-color);
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .rental-illustration__step {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }

      .rental-illustration__step-dot {
        display: grid;
        place-items: center;
        width: 1.375rem;
        height: 1.375rem;
        font-size: 0.75rem;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 50%;
      }

      .rental-illustration__step--done .rental-illustration__step-dot {
        color: #fff;
        background-color: var(--bs-primary);
        border-color: var(--bs-primary);
      }

      .rental-illustration__step--active {
        color: var(--bs-body-color);
        font-weight: 600;

        .rental-illustration__step-dot {
          border-color: var(--bs-primary);
          color: var(--bs-primary);
        }
      }

      .rental-illustration__body {
        padding: 0 1.25rem 0.75rem;
      }

      .rental-illustration__label {
        margin: 1rem 0 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--bs-secondary-color);
      }

      .rental-illustration__items {
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 0.5rem;
      }

      .rental-illustration__item {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.625rem 0.875rem;

        & + & {
          border-top: var(--bs-border-width) solid var(--bs-border-color);
        }

        > .bi {
          font-size: 1.25rem;
          color: var(--bs-secondary-color);
        }
      }

      .rental-illustration__item--service {
        background-color: color-mix(in srgb, var(--bs-primary) 10%, transparent);

        > .bi {
          color: var(--bs-primary);
        }
      }

      .rental-illustration__terms {
        display: flex;
        gap: 0.5rem;
      }

      .rental-illustration__term {
        flex: 1 1 0;
        padding: 0.5rem;
        font-size: 0.8125rem;
        text-align: center;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 0.5rem;
      }

      .rental-illustration__term--active {
        color: var(--bs-body-color);
        font-weight: 600;
        border-color: var(--bs-primary);
        box-shadow: inset 0 0 0 1px var(--bs-primary);
      }

      .rental-illustration__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
        border-top: var(--bs-border-width) solid var(--bs-border-color);
      }

      .rental-illustration__total {
        font-size: 1.25rem;
        font-weight: 600;
      }

      .rental-illustration__cta {
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
export class RentalIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly steps = ['Hardware', 'Rental term', 'Company check', 'Delivery'];
  protected readonly activeStep = 1;
  protected readonly terms = [12, 24, 36];
  protected readonly activeTerm = 24;

  protected readonly items: readonly RentalItem[] = [
    { icon: 'bi-laptop', name: 'Business laptop', meta: '5 devices, 14 inch', rate: '€ 195' },
    { icon: 'bi-hdd-rack', name: 'Rack server', meta: '1 device, 2 sockets', rate: '€ 149' },
    { icon: 'bi-router', name: 'Network switch', meta: '2 devices, 24 ports', rate: '€ 48' },
    {
      icon: 'bi-headset',
      name: 'ForePath managed services',
      meta: 'Monitoring, patching, support',
      rate: '€ 120',
      service: true,
    },
  ];
}
