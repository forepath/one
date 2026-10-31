import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  isRolloutActive,
  type Rollout,
  type UpdateRelease,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';

import { isGlobalAdmin } from '../guards/global-admin.guard';
import { MasterDetailState } from '../section/master-detail.component';
import { formatVersion, policyLabel, progressPercent, ROLLOUT_STATUS_TONE, rolloutStatusLabel } from './update-format';
import { HOST_ONLY, LoadweaverUpdatesPlanner } from './updates-planner';
import { ResourceModalService } from '../objects/resource-modal.service';

/**
 * The Updates page head (3.38 R2 / R8) in the master-detail shell's full-width `summary` slot: header (announcements,
 * refresh, plan an update), flush state alerts (load error, the running update with its progress, blocked contract
 * migrations) and the KPI bar (cluster release, control plane, newest available, update policy with its edit link).
 * Renders the "Plan an update" dialog (`LoadweaverUpdatesPlanner`). Below xl, while an update plan is open, the
 * detail takes the screen and this head hides.
 */
@Component({
  selector: 'loadweaver-updates-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
  ],
  host: {
    class: 'fpc-page flex-grow-0',
    '[class.d-none]': 'detailOpen()',
    '[class.d-xl-flex]': 'detailOpen()',
  },
  template: `
    <fpc-page-header [title]="title">
      <ng-container ngProjectAs="[fpcPageHeaderActions]">
        @if (globalAdmin()) {
          <fpc-button
            variant="dark"
            size="sm"
            iconOnly
            [ariaLabel]="announcementsLabel"
            [title]="announcementsLabel"
            routerLink="/updates/announcements"
            data-testid="updates-announcements"
          >
            <i class="bi bi-megaphone" aria-hidden="true"></i>
          </fpc-button>
        }
        <fpc-button
          variant="dark"
          size="sm"
          iconOnly
          [ariaLabel]="refreshLabel"
          [title]="refreshLabel"
          (clicked)="refresh()"
          data-testid="updates-refresh"
        >
          <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
        </fpc-button>
        @if (isClusterAdmin()) {
          <fpc-button
            variant="primary"
            size="sm"
            iconOnly
            [ariaLabel]="planButtonLabel"
            [title]="planButtonLabel"
            (clicked)="planner.start()"
            data-testid="updates-plan"
          >
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
          </fpc-button>
        }
      </ng-container>
    </fpc-page-header>

    @if (error(); as message) {
      <fpc-alert [flush]="true" variant="danger" [message]="message" />
    }

    @if (status(); as s) {
      @if (activeRollout(); as active) {
        <fpc-alert [flush]="true" variant="info" data-testid="updates-active">
          <div class="d-flex flex-wrap align-items-center gap-2">
            <fpc-badge [tone]="statusTone[active.status]">{{ statusLabel(active.status) }}</fpc-badge>
            <span class="fw-semibold">{{ version(active.fromVersion) }} → {{ active.toVersion }}</span>
            <span class="small">
              {{ active.progress.done }} / {{ active.progress.total }}
              <span i18n="@@lwConsoleUpdates-stepsDone">steps done</span>
            </span>
            <!-- "Open elsewhere" next to other controls = icon-only quiet button (user, 2026-10-29). -->
            <fpc-button
              class="ms-auto"
              variant="dark"
              size="sm"
              iconOnly
              [routerLink]="['/delivery/updates/rollouts', active.id]"
              [ariaLabel]="openActiveLabel"
              [title]="openActiveLabel"
              data-testid="updates-open-active"
            >
              <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
            </fpc-button>
          </div>
          <fpc-progress
            class="d-block mt-2"
            [value]="percent(active)"
            height="0.5rem"
            [striped]="active.status === 'running'"
            [animated]="active.status === 'running'"
            [variant]="active.status === 'paused' || active.status === 'rolling-back' ? 'warning' : 'primary'"
          />
          @if (active.pauseReason) {
            <div class="small mt-1">{{ active.pauseReason }}</div>
          }
        </fpc-alert>
      }
      @if (!s.contractMigrations.ready && s.contractMigrations.blockers.length > 0) {
        <fpc-alert [flush]="true" variant="info" [showIcon]="true">
          <span i18n="@@lwConsoleUpdates-contractBlocked"
            >Contract migrations wait until every component runs the new release:</span
          >
          {{ s.contractMigrations.blockers.join('; ') }}
        </fpc-alert>
      }

      <fpc-summary-bar class="flex-shrink-0" [columns]="4" data-testid="updates-summary">
        <fpc-summary-card icon="tag" [label]="clusterVersionLabel" [value]="version(s.clusterVersion)" />
        <fpc-summary-card icon="tags" [label]="controlPlaneVersionLabel" [value]="version(s.controlPlaneVersion)" />
        <fpc-summary-card
          icon="arrow-up-circle"
          [label]="latestLabel"
          [value]="version(s.latestAvailable)"
          [tone]="s.latestAvailable ? 'info' : 'default'"
        />
        <fpc-summary-card
          icon="shield-check"
          [label]="policyTitle"
          [value]="policyLabel(s.policy.policy)"
          data-testid="updates-policy"
        >
          @if (clusterResource() && isClusterAdmin()) {
            <!-- The update policy is part of the Cluster resource: its edit modal on the Operations step (2026-10-29). -->
            <fpc-button
              fpcSummaryCardActions
              variant="dark"
              size="sm"
              iconOnly
              [ariaLabel]="policyEditLabel"
              [title]="policyEditLabel"
              (clicked)="editPolicy()"
              data-testid="updates-policy-edit"
            >
              <i class="bi bi-pencil" aria-hidden="true"></i>
            </fpc-button>
          }
        </fpc-summary-card>
      </fpc-summary-bar>
    }

    <fpc-modal [open]="planner.open()" (openChange)="planner.open.set($event)" [title]="planTitle">
      <p class="small" i18n="@@lwConsolePlanUpdate-hint">
        An update is a plan: it shows the diff per node and component, notes, warnings and what each wave puts at risk.
        It runs only after an approval: control plane first, then a canary node, then waves.
      </p>
      <fpc-form-field
        forId="lw-plan-version"
        i18n-label="@@lwConsolePlanUpdate-release"
        label="Release"
        [hint]="plannable().length === 0 ? noReleaseHint : null"
      >
        <fpc-form-control
          controlType="select"
          controlId="lw-plan-version"
          size="sm"
          [ngModel]="planner.version"
          (ngModelChange)="planner.setVersion($event)"
          data-testid="updates-plan-version"
        >
          @for (r of plannable(); track r.version) {
            @if (r.version !== status()?.clusterVersion) {
              <option [value]="r.version">{{ r.version }}{{ r.channel === 'beta' ? ' (beta)' : '' }}</option>
            }
          }
          <option [value]="hostOnly" i18n="@@lwConsolePlanUpdate-hostOnly">
            The running release: host and OS updates only
          </option>
        </fpc-form-control>
      </fpc-form-field>
      <fpc-form-check
        checkId="lw-plan-host"
        [checked]="planner.host"
        [disabled]="planner.hostOnly()"
        (checkedChange)="planner.setHost($event)"
        i18n-label="@@lwConsolePlanUpdate-host"
        label="Host updates: OS packages, kernel, gVisor and DRBD (drain, update, reboot, rejoin, one node at a time)"
      />
      <fpc-form-check
        class="d-block mt-2"
        checkId="lw-plan-os-upgrade"
        [checked]="planner.osUpgrade"
        [disabled]="!planner.host"
        (checkedChange)="planner.osUpgrade = $event"
        i18n-label="@@lwConsolePlanUpdate-osUpgrade"
        label="Full OS upgrade: every package to the cluster's current snapshot, not only the release's pins"
      />
      @if (createError(); as message) {
        <fpc-alert class="d-block mt-3" variant="danger" [message]="message" />
      }
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button variant="dark" (clicked)="planner.open.set(false)">
          <span i18n="@@lwConsolePlanUpdate-cancel">Cancel</span>
        </fpc-button>
        <fpc-button
          variant="primary"
          [loading]="creating()"
          (clicked)="planner.create()"
          data-testid="updates-plan-create"
        >
          <span i18n="@@lwConsolePlanUpdate-create">Create plan</span>
        </fpc-button>
      </div>
    </fpc-modal>
  `,
})
export class LoadweaverUpdatesSummaryComponent {
  private readonly facade = inject(ConsoleUpdatesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly auth = inject(AuthenticationFacade);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });
  readonly planner = inject(LoadweaverUpdatesPlanner);
  private readonly resourceModal = inject(ResourceModalService);

  /** The update policy lives in the Cluster resource: open its edit modal on the Operations step. */
  editPolicy(): void {
    const name = this.clusterResource();

    if (name) this.resourceModal.openEdit({ kind: 'Cluster', name, project: null }, 'operations');
  }

  readonly detailOpen = computed(() => !!this.masterDetail?.selectedId());
  readonly status = toSignal(this.facade.status$, { initialValue: null });
  readonly rollouts = toSignal(this.facade.rollouts$, { initialValue: [] as Rollout[] });
  readonly plannable = toSignal(this.facade.plannableReleases$, { initialValue: [] as UpdateRelease[] });
  readonly clusterResource = toSignal(this.facade.clusterResource$, { initialValue: null });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly creating = toSignal(this.facade.creating$, { initialValue: false });
  readonly createError = toSignal(this.facade.createError$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly globalAdmin = toSignal(isGlobalAdmin(this.auth), { initialValue: false });

  readonly activeRollout = computed(() => {
    const id = this.status()?.activeRollout;

    return (id ? this.rollouts().find((r) => r.id === id) : this.rollouts().find(isRolloutActive)) ?? null;
  });

  readonly hostOnly = HOST_ONLY;
  readonly statusTone = ROLLOUT_STATUS_TONE;
  readonly statusLabel = rolloutStatusLabel;
  readonly policyLabel = policyLabel;
  readonly percent = progressPercent;
  readonly version = formatVersion;

  readonly title = $localize`:@@lwConsoleUpdates-title:Updates`;
  readonly refreshLabel = $localize`:@@lwConsoleUpdates-refresh:Refresh`;
  readonly announcementsLabel = $localize`:@@lwConsoleUpdates-announcements:Announcements`;
  readonly openActiveLabel = $localize`:@@lwConsoleUpdates-openActive:Open the update`;
  readonly planButtonLabel = $localize`:@@lwConsoleUpdates-planButton:Plan update`;
  readonly planTitle = $localize`:@@lwConsoleUpdates-planTitle:Plan an update`;
  readonly noReleaseHint = $localize`:@@lwConsolePlanUpdate-noRelease:No release bundle is imported yet: download or upload one under Releases first.`;
  readonly clusterVersionLabel = $localize`:@@lwConsoleUpdates-clusterVersion:Cluster release`;
  readonly controlPlaneVersionLabel = $localize`:@@lwConsoleUpdates-controlPlaneVersion:Control plane`;
  readonly latestLabel = $localize`:@@lwConsoleUpdates-latestAvailable:Newest available`;
  readonly policyTitle = $localize`:@@lwConsoleUpdates-policyTitle:Update policy`;
  readonly policyEditLabel = $localize`:@@lwConsoleUpdates-policyEdit:Change in the Cluster resource`;

  refresh(): void {
    this.facade.load();
  }
}
