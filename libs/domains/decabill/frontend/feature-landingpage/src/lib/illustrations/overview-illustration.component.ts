import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';

/** Hero scene: the customer overview with plans, running services and recent invoices. */
@Component({
  selector: 'framework-portal-overview-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedAppIllustrationComponent,
    FpcBadgeComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSummaryCardComponent,
  ],
  template: `
    <shared-app-illustration [label]="label()" address="billing.decabill.com/overview" [width]="1200" [height]="680">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-receipt"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-grid-1x2"></i></span>
        <span class="sai-rail__item"><i class="bi bi-box-seam"></i></span>
        <span class="sai-rail__item"><i class="bi bi-kanban"></i></span>
        <span class="sai-rail__item"><i class="bi bi-file-earmark-text"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-person-circle"></i></span>
      </nav>

      <div class="sai-col sai-col--grow">
        <fpc-page-header title="Overview" />
        <div class="overview-illustration__summary">
          <fpc-summary-card label="Active plans" value="4" />
          <fpc-summary-card label="Active projects" value="2" />
          <fpc-summary-card label="Open and overdue invoices" value="1" tone="warning" />
          <fpc-summary-card label="Revenue this month" value="€12,480.00" tone="success" />
        </div>
        <div class="d-flex flex-grow-1 min-h-0">
          <section class="sai-col sai-col--grow overview-illustration__services">
            <fpc-lane-header title="Services" flush />
            <fpc-list [flush]="true" class="sai-body">
              @for (service of services; track service.name) {
                <fpc-list-item>
                  <span fpcListItemTitle>{{ service.name }}</span>
                  <span fpcListItemMeta>{{ service.meta }}</span>
                  <fpc-badge fpcListItemActions [color]="service.color" variant="info" size="sm">{{
                    service.state
                  }}</fpc-badge>
                  @if (service.progress !== null) {
                    <fpc-progress [value]="service.progress" height="0.375rem" />
                  }
                </fpc-list-item>
              }
            </fpc-list>
          </section>
          <section class="sai-col sai-col--grow">
            <fpc-lane-header title="Invoices" flush />
            <fpc-list [flush]="true" class="sai-body">
              @for (invoice of invoices; track invoice.number) {
                <fpc-list-item>
                  <span fpcListItemTitle>{{ invoice.number }}</span>
                  <span fpcListItemMeta>{{ invoice.meta }}</span>
                  <span fpcListItemActions class="d-flex align-items-center gap-2">
                    <span class="fw-semibold">{{ invoice.amount }}</span>
                    <fpc-badge [color]="invoice.color" variant="info" size="sm">{{ invoice.state }}</fpc-badge>
                  </span>
                </fpc-list-item>
              }
            </fpc-list>
          </section>
        </div>
      </div>
    </shared-app-illustration>
  `,
  styles: [
    `
      .overview-illustration__summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);

        fpc-summary-card + fpc-summary-card {
          border-left: var(--bs-border-width) solid var(--bs-border-color);
        }
      }

      .overview-illustration__services {
        border-right: var(--bs-border-width) solid var(--bs-border-color);
      }
    `,
  ],
})
export class OverviewIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly services = [
    {
      name: 'Managed hosting M',
      meta: 'Falkenstein, renews 1 Nov',
      state: 'Running',
      color: 'success' as const,
      progress: null,
    },
    {
      name: 'Website care',
      meta: 'Monthly retainer, 6 hours',
      state: 'Active',
      color: 'success' as const,
      progress: null,
    },
    {
      name: 'Cloud server CX32',
      meta: 'Provisioning, 2 of 3 steps',
      state: 'Provisioning',
      color: 'primary' as const,
      progress: 66,
    },
    {
      name: 'Shop relaunch',
      meta: 'Project, 3 milestones',
      state: 'In progress',
      color: 'info' as const,
      progress: null,
    },
  ];

  protected readonly invoices = [
    {
      number: 'INV-2026-0142',
      meta: 'Issued 1 Oct, due 15 Oct',
      amount: '€1,240.00',
      state: 'Open',
      color: 'primary' as const,
    },
    { number: 'INV-2026-0131', meta: 'Issued 1 Sep', amount: '€980.00', state: 'Paid', color: 'success' as const },
    {
      number: 'INV-2026-0118',
      meta: 'Issued 15 Aug, due 29 Aug',
      amount: '€320.00',
      state: 'Overdue',
      color: 'danger' as const,
    },
    { number: 'INV-2026-0104', meta: 'Issued 1 Aug', amount: '€980.00', state: 'Paid', color: 'success' as const },
  ];
}
