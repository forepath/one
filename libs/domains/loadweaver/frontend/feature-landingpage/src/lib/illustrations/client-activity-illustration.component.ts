import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

interface ClientConnection {
  client: string;
  target: string;
  detail: string;
  allowed: boolean;
}

/**
 * Remote access visibility scene (3.31, 3.14): active sessions and proxy / firewall decisions that name
 * user and device instead of an IP, including a connection the restricted group does not allow.
 */
@Component({
  selector: 'loadweaver-portal-client-activity-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent, FpcLaneHeaderComponent, FpcListComponent, FpcListItemComponent],
  template: `
    <shared-app-illustration [label]="label()" address="console.example.com/remote-access" [width]="820" [height]="600">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-bounding-box-circles"></i></span>
        <span class="sai-rail__item"><i class="bi bi-diagram-3"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-person-lock"></i></span>
        <span class="sai-rail__item"><i class="bi bi-journal-text"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col sai-col--grow">
        <fpc-lane-header title="Active sessions" flush />
        <fpc-list [flush]="true">
          @for (session of sessions; track session.device) {
            <fpc-list-item>
              <span fpcListItemTitle><i class="bi bi-person-badge me-2 text-primary"></i>{{ session.device }}</span>
              <span fpcListItemMeta>{{ session.meta }}</span>
            </fpc-list-item>
          }
        </fpc-list>

        <fpc-lane-header title="Decisions, last minutes" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (connection of connections; track $index) {
            <fpc-list-item>
              <span fpcListItemTitle>
                <i
                  class="bi me-2"
                  [class]="connection.allowed ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-danger'"
                ></i
                >{{ connection.client }} → {{ connection.target }}
              </span>
              <span fpcListItemMeta>{{ connection.detail }}</span>
            </fpc-list-item>
          }
        </fpc-list>
      </section>
    </shared-app-illustration>
  `,
})
export class ClientActivityIllustrationComponent {
  /** Accessible description of the scene. */
  readonly label = input.required<string>();

  protected readonly sessions = [
    { device: 'alice@laptop', meta: 'group sales, via gw1 in fra1, posture ok' },
    { device: 'bob@phone', meta: 'group restricted, via gw2 in ams1, OS outdated' },
  ];

  protected readonly connections: readonly ClientConnection[] = [
    { client: 'alice@laptop', target: 'crm:443', detail: 'allowed by policy sales-to-crm', allowed: true },
    { client: 'bob@phone', target: 'crm:443', detail: 'no policy for group restricted', allowed: false },
    { client: 'bob@phone', target: 'helpdesk:443', detail: 'allowed by policy restricted-to-helpdesk', allowed: true },
    { client: 'office-berlin', target: 'intranet:443', detail: 'allowed by policy office-to-intranet', allowed: true },
  ];
}
