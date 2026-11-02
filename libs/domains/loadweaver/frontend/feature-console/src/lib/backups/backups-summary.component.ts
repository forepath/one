import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  type BackupDeletion,
} from '@forepath/loadweaver/frontend/data-access-console';
import { backendMessageLabel } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  type FpcBadgeTone,
  FpcPageHeaderComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import { MasterDetailState } from '../section/master-detail.component';
import { backupKitState, backupKitStateLabel, backupTotals, backupUsage } from './backup-format';

/**
 * The Backups page head (3.38 R2 / R8) in the master-detail shell's full-width `summary` slot: the page header, the
 * cluster pins and the recovery-kit warning (flush alerts), then the KPI bar (kit, backups, data, stored, target
 * copies, pending deletions) spanning the list and the detail lane. Reads the catalog's `?project=` filter from the
 * URL (the list writes it). Below xl, while a backup is open, the detail takes the screen and this head hides.
 */
@Component({
  selector: 'loadweaver-backups-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcPageHeaderComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
  ],
  host: {
    class: 'fpc-page flex-grow-0',
    '[class.d-none]': 'detailOpen()',
    '[class.d-xl-flex]': 'detailOpen()',
  },
  template: `
    <fpc-page-header [title]="title" />

    @if (status(); as s) {
      @for (pin of s.pins; track pin) {
        <fpc-alert [flush]="true" variant="danger" [showIcon]="true" data-testid="backups-pin">
          {{ pinText(pin) }}
        </fpc-alert>
      }

      @if (kitState() === 'unconfirmed') {
        <fpc-alert [flush]="true" variant="warning" [showIcon]="true" data-testid="backups-kit-warning">
          <span>{{ kitWarning }}</span>
          @if (isClusterAdmin()) {
            <a class="ms-1" routerLink="/operate/backups/keys">{{ kitWarningLink }}</a>
          }
        </fpc-alert>
      }

      <fpc-summary-bar [columns]="6" data-testid="backups-summary">
        <!-- The kit is a state, not a number (LW-15): a status badge, not large coloured text. -->
        <fpc-summary-card icon="key" [label]="keyLabel" data-testid="backups-summary-kit">
          <span fpcSummaryCardValue class="d-inline-flex align-items-center gap-2">
            <fpc-badge [tone]="kitTone()">{{ kitLabel() }}</fpc-badge>
            @if (s.keys.generation !== null) {
              <span class="small text-body-secondary">G{{ s.keys.generation }}</span>
            }
          </span>
        </fpc-summary-card>
        <fpc-summary-card icon="archive" [label]="backupsLabel" [value]="'' + totals().backups" />
        <fpc-summary-card icon="device-hdd" [label]="sizeLabel" [value]="bytes(totals().bytes)" />
        <fpc-summary-card icon="database" [label]="storedLabel" [value]="bytes(totals().stored)" />
        <fpc-summary-card
          icon="cloud-check"
          [label]="targetsLabel"
          [value]="targetCopies().ok + ' / ' + targetCopies().total"
          [tone]="targetCopies().ok < targetCopies().total ? 'danger' : 'default'"
          data-testid="backups-summary-targets"
        />
        <fpc-summary-card
          icon="trash"
          [label]="deletionsLabel"
          [value]="'' + openDeletions().length"
          [tone]="openDeletions().length > 0 ? 'warning' : 'default'"
        />
      </fpc-summary-bar>
    }
  `,
})
export class LoadweaverBackupsSummaryComponent {
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });

  readonly status = toSignal(this.facade.status$, { initialValue: null });
  readonly openDeletions = toSignal(this.facade.openDeletions$, { initialValue: [] as BackupDeletion[] });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly project = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => p.get('project'))), {
    initialValue: null,
  });

  readonly detailOpen = computed(() => !!this.masterDetail?.selectedId());
  readonly kitState = computed(() => backupKitState(this.status()));
  readonly kitLabel = computed(() => backupKitStateLabel(this.kitState()));
  readonly kitTone = computed<FpcBadgeTone>(() => {
    const state = this.kitState();

    return state === 'confirmed'
      ? 'success'
      : state === 'escrowed'
        ? 'info'
        : state === 'unconfirmed'
          ? 'warning'
          : 'neutral';
  });
  readonly totals = computed(() => backupTotals(backupUsage(this.status(), this.project())));
  /** Off-cluster copies reported by the targets: healthy / all. */
  readonly targetCopies = computed(() => {
    const targets = this.status()?.targets ?? [];

    return { ok: targets.filter((t) => t.ok).length, total: targets.length };
  });

  readonly bytes = formatBytes;
  /** A cluster pin as a sentence (LW-15): the server's English pins translated, never raw lower case. */
  readonly pinText = backendMessageLabel;
  readonly title = $localize`:@@lwConsoleBackups-title:Backups`;
  readonly kitWarning = $localize`:@@lwConsoleBackups-kitWarning:Backups are not recoverable without the cluster until a recovery kit of the backup key is downloaded and confirmed (or the key is escrowed in a KMS).`;
  readonly kitWarningLink = $localize`:@@lwConsoleBackups-kitWarningLink:Open the recovery kit`;
  readonly keyLabel = $localize`:@@lwConsoleBackups-keyCard:Recovery kit`;
  readonly backupsLabel = $localize`:@@lwConsoleBackups-backupsCard:Backups`;
  readonly sizeLabel = $localize`:@@lwConsoleBackups-sizeCard:Backed-up data`;
  readonly storedLabel = $localize`:@@lwConsoleBackups-storedCard:Stored after deduplication`;
  readonly targetsLabel = $localize`:@@lwConsoleBackups-targetsCard:Target copies OK`;
  readonly deletionsLabel = $localize`:@@lwConsoleBackups-deletionsCard:Pending deletions`;
}
