import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { FpcTabComponent, FpcTabGroupComponent } from '@forepath/shared/frontend/ui-components';

export type BackupsSection = 'overview' | 'restores' | 'deletions' | 'platform' | 'keys';

const SECTION_URLS: Record<BackupsSection, string> = {
  overview: '/backups',
  restores: '/backups/restores',
  deletions: '/backups/deletions',
  platform: '/backups/platform',
  keys: '/backups/keys',
};

/**
 * Section bar of the backup pages (overview, restores, deletion requests, platform backups, recovery kit): a flush
 * tab bar under the page header that navigates between the routes. Platform backups need a cluster role, the recovery
 * kit a cluster admin; the page passes what the caller may see.
 */
@Component({
  selector: 'loadweaver-backups-nav',
  imports: [FpcTabGroupComponent, FpcTabComponent],
  template: `
    <fpc-tab-group [activeId]="active()" (activeIdChange)="go($event)" [ariaLabel]="ariaLabel">
      <fpc-tab id="overview" [label]="overviewLabel" icon="safe" data-testid="backups-overview" />
      <fpc-tab id="restores" [label]="restoresLabel" icon="arrow-counterclockwise" data-testid="backups-restores" />
      <fpc-tab
        id="deletions"
        [label]="deletionsLabel + (deletions() > 0 ? ' (' + deletions() + ')' : '')"
        icon="trash"
        data-testid="backups-deletions"
      />
      @if (platform() || active() === 'platform') {
        <fpc-tab id="platform" [label]="platformLabel" icon="database-check" data-testid="backups-platform" />
      }
      @if (keys() || active() === 'keys') {
        <fpc-tab id="keys" [label]="keysLabel" icon="key" data-testid="backups-keys" />
      }
    </fpc-tab-group>
  `,
  host: { class: 'd-block flex-shrink-0' },
  standalone: true,
})
export class LoadweaverBackupsNavComponent {
  private readonly router = inject(Router);

  readonly active = input<BackupsSection>('overview');
  /** The caller has a cluster role (platform backups). */
  readonly platform = input(false);
  /** The caller is a cluster admin (recovery kit). */
  readonly keys = input(false);
  /** Open deletion requests, shown on the tab. */
  readonly deletions = input(0);

  readonly ariaLabel = $localize`:@@lwConsoleBackups-sections:Backup sections`;
  readonly overviewLabel = $localize`:@@lwConsoleBackups-overviewTab:Overview`;
  readonly restoresLabel = $localize`:@@lwConsoleBackups-restoresLink:Restores`;
  readonly deletionsLabel = $localize`:@@lwConsoleBackups-deletionsLink:Deletion requests`;
  readonly platformLabel = $localize`:@@lwConsoleBackups-platformLink:Platform backups`;
  readonly keysLabel = $localize`:@@lwConsoleBackups-keysLink:Recovery kit`;

  go(section: string | null): void {
    if (!section || section === this.active() || !(section in SECTION_URLS)) return;

    void this.router.navigateByUrl(SECTION_URLS[section as BackupsSection]);
  }
}
