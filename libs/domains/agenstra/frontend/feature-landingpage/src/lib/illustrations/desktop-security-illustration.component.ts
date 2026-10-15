import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/** Desktop security scene: an SSO-backed connection, its role and what that role may and may not do. */
@Component({
  selector: 'framework-portal-desktop-security-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent, FpcLaneHeaderComponent, FpcListComponent, FpcListItemComponent],
  styles: [
    `
      .desktop-security-illustration__dot {
        font-size: 0.5rem;
        vertical-align: middle;
      }
    `,
  ],
  template: `
    <shared-app-illustration [label]="label()" windowTitle="Agenstra Desktop" [width]="820" [height]="620">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-robot"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-hdd-network"></i></span>
        <span class="sai-rail__item"><i class="bi bi-chat-square-text"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col sai-col--grow">
        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle
            ><i class="bi bi-circle-fill text-success me-2 desktop-security-illustration__dot"></i>Production,
            connected</span
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

        <fpc-lane-header title="Permissions for your role" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (permission of permissions; track permission.title) {
            <fpc-list-item>
              <span fpcListItemTitle>
                <i
                  class="bi me-2"
                  [class]="
                    permission.allowed ? 'bi-check-circle-fill text-success' : 'bi-dash-circle text-body-secondary'
                  "
                ></i
                >{{ permission.title }}
              </span>
              <span fpcListItemMeta>{{ permission.note }}</span>
            </fpc-list-item>
          }
        </fpc-list>
      </section>
    </shared-app-illustration>
  `,
})
export class DesktopSecurityIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly facts = [
    { icon: 'bi-person-badge', title: 'Signed in with company SSO', value: 'alex@example.com, role Developer' },
    {
      icon: 'bi-shield-lock',
      title: 'Encrypted connection',
      value: 'TLS 1.3 to agents.example.com, certificate verified',
    },
    { icon: 'bi-key', title: 'Secrets stay on the server', value: 'Nothing sensitive is stored on this device' },
  ];

  protected readonly permissions = [
    { title: 'View agents and runs', note: 'All workspaces you are a member of', allowed: true },
    { title: 'Chat with agents', note: 'platform-api, web-app', allowed: true },
    { title: 'Change environment secrets', note: 'Platform team only, through the web console', allowed: false },
    { title: 'Delete workspaces', note: 'Requires an administrator', allowed: false },
  ];
}
