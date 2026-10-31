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

/** Cloud scene: the managed console with usage figures and environments being provisioned. */
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
    <shared-app-illustration [label]="label()" address="cloud.agenstra.com/overview" [width]="1000" [height]="600">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-cloud"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-grid-1x2"></i></span>
        <span class="sai-rail__item"><i class="bi bi-hdd-stack"></i></span>
        <span class="sai-rail__item"><i class="bi bi-receipt"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col sai-col--grow">
        <div class="cloud-illustration__summary">
          <fpc-summary-card icon="boxes" label="Workspaces" value="4" />
          <fpc-summary-card icon="robot" label="Agents running" value="7" tone="success" />
          <fpc-summary-card icon="geo-alt" label="Region" value="Falkenstein" />
          <fpc-summary-card icon="activity" label="Uptime (30 days)" value="99.98%" />
        </div>
        <fpc-lane-header title="Environments" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (environment of environments; track environment.name) {
            <fpc-list-item>
              <span fpcListItemTitle>{{ environment.name }}</span>
              <span fpcListItemMeta>{{ environment.meta }}</span>
              <fpc-badge fpcListItemActions [color]="environment.color" variant="info" size="sm">{{
                environment.state
              }}</fpc-badge>
              @if (environment.progress !== null) {
                <fpc-progress [value]="environment.progress" height="0.375rem" />
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

  protected readonly environments = [
    {
      name: 'platform-api',
      meta: '3 agents, 4 vCPU, 8 GB',
      state: 'Running',
      color: 'success' as const,
      progress: null,
    },
    { name: 'web-app', meta: '2 agents, 2 vCPU, 4 GB', state: 'Running', color: 'success' as const, progress: null },
    {
      name: 'data-pipeline',
      meta: 'Provisioning workspace',
      state: 'Provisioning',
      color: 'primary' as const,
      progress: 64,
    },
    { name: 'docs', meta: 'Scaled to zero', state: 'Paused', color: 'secondary' as const, progress: null },
  ];
}
