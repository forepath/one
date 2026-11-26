import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/**
 * Desktop update scene: the connection and channel, then the checks a release passes before it installs
 * (signed manifest, signature, version, checksum), as described in the native billing console docs.
 */
@Component({
  selector: 'framework-portal-desktop-update-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedAppIllustrationComponent,
    FpcBadgeComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
  ],
  template: `
    <shared-app-illustration [label]="label()" windowTitle="Decabill Desktop" [width]="820" [height]="620">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><img src="assets/images/icon_light.svg" alt="" /></span>
        <span class="sai-rail__item"><i class="bi bi-grid-1x2"></i></span>
        <span class="sai-rail__item"><i class="bi bi-file-earmark-text"></i></span>
        <span class="sai-rail__item sai-rail__item--active mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col sai-col--grow">
        <fpc-lane-header title="Settings" flush />
        <fpc-list [flush]="true">
          @for (fact of facts; track fact.title) {
            <fpc-list-item>
              <span fpcListItemTitle><i class="bi me-2 text-primary" [class]="fact.icon"></i>{{ fact.title }}</span>
              <span fpcListItemMeta>{{ fact.value }}</span>
            </fpc-list-item>
          }
        </fpc-list>

        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle>Update to 5.7.1</span>
          <fpc-badge
            fpcLaneHeaderActions
            class="sai-motion-enter"
            style="--sai-delay: 4s"
            color="success"
            variant="info"
            size="sm"
            >Ready to install</fpc-badge
          >
        </fpc-lane-header>
        <fpc-list [flush]="true" class="sai-body">
          @for (check of checks; track check.title; let index = $index) {
            <fpc-list-item class="sai-motion-select sai-motion-select--4" [style.--sai-step]="index">
              <span fpcListItemTitle><i class="bi bi-check-circle-fill text-success me-2"></i>{{ check.title }}</span>
              <span fpcListItemMeta>{{ check.note }}</span>
            </fpc-list-item>
          }
        </fpc-list>
      </section>
    </shared-app-illustration>
  `,
})
export class DesktopUpdateIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly facts = [
    { icon: 'bi-hdd-network', title: 'Server', value: 'billing.example.com, your roles and permissions' },
    { icon: 'bi-broadcast', title: 'Update channel', value: 'Stable, checked every six hours' },
    { icon: 'bi-box-seam', title: 'Installed version', value: '5.7.0' },
  ];

  protected readonly checks = [
    { title: 'Release manifest downloaded', note: 'Stable channel, Linux x64' },
    { title: 'Signature verified', note: 'Against the release keys built into the app' },
    { title: 'Newer than the installed version', note: '5.7.0 to 5.7.1' },
    { title: 'Checksum and size match', note: 'SHA-256 from the signed manifest' },
  ];
}
