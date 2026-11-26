import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcProgressComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';

/** Cloud scene: the managed administration overview, a platform update applied for you and a billing run. */
@Component({
  selector: 'framework-portal-cloud-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedAppIllustrationComponent,
    FpcBadgeComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcProgressComponent,
    FpcSummaryCardComponent,
  ],
  template: `
    <shared-app-illustration
      [label]="label()"
      address="billing.decabill.com/administration"
      [width]="1000"
      [height]="600"
    >
      <nav class="sai-rail">
        <span class="sai-rail__brand"><img src="assets/images/icon_light.svg" alt="" /></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-grid-1x2"></i></span>
        <span class="sai-rail__item"><i class="bi bi-people"></i></span>
        <span class="sai-rail__item"><i class="bi bi-receipt"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col sai-col--grow">
        <div class="cloud-illustration__summary">
          <fpc-summary-card icon="people" label="Customers" value="128" />
          <fpc-summary-card icon="arrow-repeat" label="Active subscriptions" value="214" tone="success" />
          <fpc-summary-card icon="cash-coin" label="Revenue this month" value="€38,920.00" tone="success" />
          <fpc-summary-card icon="activity" label="Uptime (30 days)" value="99.98%" />
        </div>
        <fpc-lane-header title="Platform" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (job of jobs; track job.name) {
            <fpc-list-item>
              <span fpcListItemTitle>{{ job.name }}</span>
              <span fpcListItemMeta>{{ job.meta }}</span>
              <fpc-badge
                fpcListItemActions
                [class.sai-motion-pulse]="job.progress !== null"
                [color]="job.color"
                variant="info"
                size="sm"
                >{{ job.state }}</fpc-badge
              >
              @if (job.progress !== null) {
                <fpc-progress class="sai-motion-progress" [value]="job.progress" height="0.375rem" />
              }
            </fpc-list-item>
          }
        </fpc-list>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .cloud-illustration__summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);

        fpc-summary-card + fpc-summary-card {
          border-left: var(--bs-border-width) solid var(--bs-border-color);
        }
      }
    `,
  ],
})
export class CloudIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly jobs = [
    {
      name: 'Decabill 5.7.0',
      meta: 'Updated for you overnight',
      state: 'Current',
      color: 'success' as const,
      progress: null,
    },
    {
      name: 'Monthly billing run',
      meta: '161 of 214 subscriptions invoiced',
      state: 'Running',
      color: 'primary' as const,
      progress: 75,
    },
    {
      name: 'E-invoices',
      meta: 'ZUGFeRD and XRechnung attached to every invoice',
      state: 'Active',
      color: 'success' as const,
      progress: null,
    },
    {
      name: 'Payment reconciliation',
      meta: 'Last bank import 12 minutes ago',
      state: 'Synced',
      color: 'success' as const,
      progress: null,
    },
  ];
}
