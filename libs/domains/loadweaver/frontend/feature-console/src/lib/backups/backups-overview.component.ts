import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ConsoleAccessFacade, ConsoleBackupsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { backupUsage, scopeLabel } from './backup-format';

type UsageRow = { project: string; bytes: number; uploadedBytes: number; backups: number };
type TargetRow = { target: string; scope: string; at: string; ok: boolean; error?: string };

/**
 * The Backups detail lane while no backup is open (≥ xl, the master-detail shell's `empty` component; 3.38: Usage and
 * Targets as their own lanes): usage per project (`fpc-data-table`) | the off-cluster copies per backup target, with
 * the links to the targets (cluster admins).
 */
@Component({
  selector: 'loadweaver-backups-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
  ],
  host: { class: 'fpc-page' },
  template: `
    <fpc-tab-group class="fpc-lane-tabs" [activeId]="lane()" (activeIdChange)="lane.set($any($event))">
      <fpc-tab id="usage" [label]="usageTitle" />
      <fpc-tab id="targets" [label]="targetsTitle" />
    </fpc-tab-group>
    <fpc-section-row class="flex-grow-1 min-h-0">
      <loadweaver-lane [title]="usageTitle" [flush]="true" [off]="lane() !== 'usage'" data-testid="backups-usage-lane">
        @if (usage().length === 0) {
          <fpc-empty-state icon="database" size="sm" [title]="noUsageLabel" />
        } @else {
          <fpc-data-table
            class="flex-grow-1 min-h-0"
            [columns]="usageColumns"
            [rows]="usage()"
            [rowId]="usageId"
            [rowLink]="projectLink"
            [ariaLabel]="usageTitle"
            [searchable]="false"
            [showColumnChooser]="false"
            paging="client"
            persistKey="lw-backups-usage"
            data-testid="backups-usage"
          >
            <ng-template fpcTableCell="bytes" let-row>{{ bytes(row.bytes) }}</ng-template>
            <ng-template fpcTableCell="stored" let-row>
              <span [title]="storedHint">{{ bytes(row.uploadedBytes) }}</span>
            </ng-template>
          </fpc-data-table>
        }
      </loadweaver-lane>

      <loadweaver-lane
        [title]="targetsTitle"
        [flush]="true"
        [off]="lane() !== 'targets'"
        data-testid="backups-targets-lane"
      >
        <ng-container ngProjectAs="[lwLaneActions]">
          @if (isClusterAdmin()) {
            <fpc-button
              variant="dark"
              size="sm"
              iconOnly
              [ariaLabel]="targetsLinkLabel"
              [title]="targetsLinkLabel"
              [routerLink]="['/resources', 'cluster']"
              [queryParams]="{ tab: 'contents', kind: 'BackupTarget' }"
              data-testid="backups-targets-link"
            >
              <i class="bi bi-hdd-stack" aria-hidden="true"></i>
            </fpc-button>
          }
        </ng-container>
        @if (targets().length === 0) {
          <fpc-empty-state icon="cloud-slash" size="sm" [title]="noTargetsLabel" />
        } @else {
          <!-- Off-cluster copies (3.38 D1): State · Target (link) · scope · last copy · error. -->
          <fpc-data-table
            class="flex-grow-1 min-h-0"
            [columns]="targetColumns"
            [rows]="targets()"
            [rowId]="targetId"
            [rowLink]="targetLink"
            [ariaLabel]="targetsTitle"
            [searchable]="false"
            paging="client"
            persistKey="lw-backups-targets"
            data-testid="backups-targets"
          >
            <ng-template fpcTableCell="at" let-t>{{ t.at | date: 'short' }}</ng-template>
            <ng-template fpcTableCell="error" let-t>
              @if (t.error) {
                <span class="text-danger text-break">{{ t.error }}</span>
              }
            </ng-template>
          </fpc-data-table>
        }
      </loadweaver-lane>
    </fpc-section-row>
  `,
})
export class LoadweaverBackupsOverviewComponent {
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly access = inject(ConsoleAccessFacade);

  readonly status = toSignal(this.facade.status$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly project = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => p.get('project'))), {
    initialValue: null,
  });
  readonly lane = signal<'usage' | 'targets'>('usage');

  readonly usage = computed(() => backupUsage(this.status(), this.project()));
  readonly targets = computed(() => this.status()?.targets ?? []);
  readonly usageId = (row: UsageRow) => row.project;
  readonly bytes = formatBytes;

  readonly usageTitle = $localize`:@@lwConsoleBackups-usageTitle:Usage per project`;
  readonly targetsTitle = $localize`:@@lwConsoleBackups-targetsTitle:Backup targets`;
  readonly noUsageLabel = $localize`:@@lwConsoleBackups-noUsage:No backups yet`;
  readonly noTargetsLabel = $localize`:@@lwConsoleBackups-noTargets:No copies on targets reported yet`;
  readonly targetsLinkLabel = $localize`:@@lwConsoleBackups-targets:Backup targets`;
  readonly storedHint = $localize`:@@lwConsoleBackups-usageHint:Stored is what the backups occupy after deduplication; it counts against the project's storage quota.`;
  readonly okLabel = $localize`:@@lwConsoleBackups-targetOk:Copied`;
  readonly failedLabel = $localize`:@@lwConsoleBackups-targetFailed:Failed`;
  readonly usageColumns: FpcTableColumn<UsageRow>[] = [
    {
      id: 'project',
      label: $localize`:@@lwConsoleBackups-colProject:Project`,
      value: (u) => u.project,
      required: true,
      priority: 1,
    },
    {
      id: 'backups',
      label: $localize`:@@lwConsoleBackups-colBackups:Backups`,
      value: (u) => u.backups,
      align: 'end',
      priority: 2,
    },
    {
      id: 'bytes',
      label: $localize`:@@lwConsoleBackups-colBytes:Backed up`,
      value: (u) => u.bytes,
      align: 'end',
      priority: 2,
    },
    {
      id: 'stored',
      label: $localize`:@@lwConsoleBackups-colStored:Stored`,
      value: (u) => u.uploadedBytes,
      align: 'end',
      priority: 1,
    },
  ];
  readonly targetColumns: FpcTableColumn<TargetRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleBackups-colState:State`,
      type: 'state',
      state: (t) => (t.ok ? { label: this.okLabel, tone: 'success' } : { label: this.failedLabel, tone: 'danger' }),
    },
    {
      id: 'target',
      label: $localize`:@@lwConsoleBackups-colTarget:Target`,
      value: (t) => t.target,
      required: true,
      priority: 1,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleBackups-colScope:Scope`,
      value: (t) => scopeLabel(t.scope),
      priority: 2,
    },
    { id: 'at', label: $localize`:@@lwConsoleBackups-colLastCopy:Last copy`, value: (t) => t.at, priority: 1 },
    { id: 'error', label: $localize`:@@lwConsoleBackups-colError:Error`, value: (t) => t.error ?? '', priority: 3 },
  ];
  readonly targetId = (t: TargetRow) => `${t.target}/${t.scope}`;
  readonly targetLink = (t: TargetRow) => `/resources/backuptarget/-/${encodeURIComponent(t.target)}`;
  readonly projectLink = (u: UsageRow) => `/resources/project/${encodeURIComponent(u.project)}`;
}
