import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/**
 * Desktop app scene (3.31): the tunnel the app runs itself, the SSO sign-in behind the key, posture
 * checks and the services the user's policies let them reach. Drawn from `fpc-*` components like
 * Agenstra's desktop scenes, not a screenshot.
 */
@Component({
  selector: 'loadweaver-portal-desktop-tunnel-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent, FpcLaneHeaderComponent, FpcListComponent, FpcListItemComponent],
  styles: [
    `
      .desktop-tunnel-illustration__dot {
        font-size: 0.5rem;
        vertical-align: middle;
      }
    `,
  ],
  template: `
    <shared-app-illustration [label]="label()" windowTitle="Loadweaver Desktop" [width]="820" [height]="640">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-bounding-box-circles"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-shield-lock"></i></span>
        <span class="sai-rail__item"><i class="bi bi-diagram-3"></i></span>
        <span class="sai-rail__item"><i class="bi bi-bell"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col sai-col--grow">
        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle
            ><i class="bi bi-circle-fill text-success me-2 desktop-tunnel-illustration__dot"></i>Tunnel connected</span
          >
        </fpc-lane-header>
        <fpc-list [flush]="true">
          @for (fact of facts; track fact.title) {
            <fpc-list-item>
              <span fpcListItemTitle><i class="bi me-2 text-primary" [class]="fact.icon"></i>{{ fact.title }}</span>
              <span fpcListItemMeta>{{ fact.value }}</span>
            </fpc-list-item>
          }
        </fpc-list>

        <fpc-lane-header title="Posture" flush />
        <fpc-list [flush]="true">
          @for (check of posture; track check) {
            <fpc-list-item>
              <span fpcListItemTitle><i class="bi bi-check-circle-fill text-success me-2"></i>{{ check }}</span>
            </fpc-list-item>
          }
        </fpc-list>

        <fpc-lane-header title="Services you may reach" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (service of services; track service.name) {
            <fpc-list-item>
              <span fpcListItemTitle><i class="bi bi-hdd-network me-2 text-primary"></i>{{ service.name }}</span>
              <span fpcListItemMeta>{{ service.via }}</span>
            </fpc-list-item>
          }
        </fpc-list>
      </section>
    </shared-app-illustration>
  `,
})
export class DesktopTunnelIllustrationComponent {
  /** Accessible description of the scene. */
  readonly label = input.required<string>();

  protected readonly facts = [
    { icon: 'bi-hdd-rack', title: 'Gateway', value: 'vpn.example.com, gw1 in fra1' },
    { icon: 'bi-person-badge', title: 'Signed in with company SSO', value: 'alice@example.com, group sales' },
    { icon: 'bi-key', title: 'Device key', value: 'Renews in 27 days after a fresh sign-in' },
  ];

  protected readonly posture = ['Disk encryption on', 'OS patched', 'Screen lock and firewall on'];

  protected readonly services = [
    { name: 'crm', via: '443/tcp, policy sales-to-crm' },
    { name: 'wiki', via: '443/tcp, policy staff-to-wiki' },
  ];
}
