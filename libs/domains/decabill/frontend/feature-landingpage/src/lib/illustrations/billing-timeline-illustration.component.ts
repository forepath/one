import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcLaneHeaderComponent } from '@forepath/shared/frontend/ui-components';

interface TimelineEvent {
  title: string;
  meta: string;
  time: string;
  /** Integration logo, or a Bootstrap icon when Decabill does the step itself. */
  logo?: string;
  icon?: string;
}

/** "How it works" scene: one subscription's activity from sign-in to the DATEV export. */
@Component({
  selector: 'framework-portal-billing-timeline-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent, FpcBadgeComponent, FpcLaneHeaderComponent],
  template: `
    <shared-app-illustration
      [label]="label()"
      address="billing.decabill.com/admin/subscriptions"
      [width]="760"
      [height]="600"
    >
      <section class="sai-col sai-col--grow">
        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle>SUB-1042, Managed hosting M</span>
          <fpc-badge fpcLaneHeaderActions color="success" variant="info" size="sm">Active</fpc-badge>
        </fpc-lane-header>
        <ol class="billing-timeline-illustration__events list-unstyled mb-0 sai-body">
          @for (event of events; track event.title) {
            <li class="billing-timeline-illustration__event">
              <span class="billing-timeline-illustration__marker">
                @if (event.logo) {
                  <img [src]="event.logo" alt="" />
                } @else {
                  <i class="bi" [class]="event.icon"></i>
                }
              </span>
              <span class="billing-timeline-illustration__body">
                <span class="fw-semibold d-block">{{ event.title }}</span>
                <span class="small text-body-secondary">{{ event.meta }}</span>
              </span>
              <span class="small text-body-secondary">{{ event.time }}</span>
            </li>
          }
        </ol>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .billing-timeline-illustration__events {
        position: relative;
        padding: 1rem 1.25rem;

        // The vertical line the markers sit on.
        &::before {
          content: '';
          position: absolute;
          top: 2rem;
          bottom: 2rem;
          left: calc(1.25rem + 1.25rem - 1px);
          border-left: 2px solid var(--bs-border-color);
        }
      }

      .billing-timeline-illustration__event {
        position: relative;
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.625rem 0;
      }

      .billing-timeline-illustration__marker {
        display: grid;
        flex: 0 0 2.5rem;
        place-items: center;
        height: 2.5rem;
        color: var(--bs-primary);
        background-color: #fff;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: 50%;

        img {
          max-width: 1.375rem;
          max-height: 1.375rem;
        }
      }

      .billing-timeline-illustration__body {
        flex: 1 1 auto;
        min-width: 0;
      }
    `,
  ],
})
export class BillingTimelineIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly events: TimelineEvent[] = [
    {
      title: 'Customer signed in',
      meta: 'Single sign-on with OpenID Connect',
      time: '09:12',
      logo: 'assets/images/logos/oidc.svg',
    },
    {
      title: 'Subscribed to Managed hosting M',
      meta: 'Ordered from the pricing page',
      time: '09:14',
      icon: 'bi-cart-check',
    },
    {
      title: 'Payment received',
      meta: '€58.31 by card through Stripe',
      time: '09:14',
      logo: 'assets/images/logos/stripe.svg',
    },
    {
      title: 'Server provisioned',
      meta: 'CX32 in Falkenstein, ready in 48 seconds',
      time: '09:15',
      logo: 'assets/images/logos/hetzner.svg',
    },
    {
      title: 'Invoice INV-2026-0142 issued',
      meta: 'E-invoice with ZUGFeRD data',
      time: '09:15',
      icon: 'bi-file-earmark-check',
    },
    { title: 'Exported to DATEV', meta: 'October booking batch', time: '1 Nov', logo: 'assets/images/logos/datev.svg' },
  ];
}
