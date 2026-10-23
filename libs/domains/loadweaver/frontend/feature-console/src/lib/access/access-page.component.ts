import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  APPROVAL_MODES,
  type ApprovalMode,
  CLUSTER_ROLES,
  CLUSTER_USER_ID_PATTERN,
  type ClusterMember,
  type ClusterRole,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  type CrossProjectRequest,
  PROJECT_ROLES,
  PROJECT_USER_ID_PATTERN,
  type ProjectMember,
  type ProjectRole,
  type ProjectSettingsPatch,
  ConsoleEndpointService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCodeEditorComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import {
  approvalModeLabel,
  atLeastRole,
  clusterRoleLabel,
  downloadText,
  mayGrantProjectAdmin,
  projectRoleLabel,
  projectRoleOf,
  roleColor,
} from './access-format';
import { LoadweaverAccessRequestsComponent } from './access-requests.component';

/** A change waiting for confirmation. */
interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  run: () => void;
}

export const ACCESS_EXPORT_FILE_NAME = 'loadweaver-access.yaml';

/**
 * Access (3.17): cluster members (cluster roles read, cluster admins manage), per project its members, settings
 * (approval mode, developer exec, terminal recording) and cross-project requests, and the access export / import as
 * YAML (cluster admins). Changes are immediate (not plan / apply) and audited, so each one is confirmed.
 */
@Component({
  selector: 'loadweaver-access-page',
  imports: [
    FpcPanelGridComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcFormFieldComponent,
    FpcFormControlComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCodeEditorComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
    LoadweaverAccessRequestsComponent,
  ],
  templateUrl: './access-page.component.html',
  standalone: true,
})
export class LoadweaverAccessPageComponent {
  private readonly facade = inject(ConsoleAccessManagementFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly projects = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  readonly clusterMembers = toSignal(this.facade.clusterMembers$, { initialValue: [] as ClusterMember[] });
  readonly clusterMembersLoading = toSignal(this.facade.clusterMembersLoading$, { initialValue: false });
  readonly clusterMembersError = toSignal(this.facade.clusterMembersError$, { initialValue: null });
  readonly projectAccess = toSignal(this.facade.projectAccess$, { initialValue: null });
  readonly members = toSignal(this.facade.projectMembers$, { initialValue: [] as ProjectMember[] });
  readonly requests = toSignal(this.facade.requests$, { initialValue: [] as CrossProjectRequest[] });
  readonly openRequests = toSignal(this.facade.openRequestCount$, { initialValue: 0 });
  readonly projectLoading = toSignal(this.facade.projectLoading$, { initialValue: false });
  readonly projectError = toSignal(this.facade.projectError$, { initialValue: null });
  readonly changing = toSignal(this.facade.changing$, { initialValue: false });
  readonly changeError = toSignal(this.facade.changeError$, { initialValue: null });
  readonly exporting = toSignal(this.facade.exporting$, { initialValue: false });
  readonly exported = toSignal(this.facade.exported$, { initialValue: null });
  readonly exportError = toSignal(this.facade.exportError$, { initialValue: null });
  readonly importing = toSignal(this.facade.importing$, { initialValue: false });
  readonly importResult = toSignal(this.facade.importResult$, { initialValue: null });
  readonly importError = toSignal(this.facade.importError$, { initialValue: null });
  private readonly queryProject = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('project'))), {
    initialValue: null,
  });

  /** The project shown: `?project=` or the first one the caller may pick. */
  readonly project = computed(() => this.queryProject() || this.projects()[0] || null);
  readonly seesCluster = computed(() => !!this.me()?.clusterRole);
  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  readonly myProjectRole = computed(() => projectRoleOf(this.me(), this.project()));
  readonly mayAdminProject = computed(() => this.myProjectRole() === 'admin');
  /** Fleet mode: approvals stay native — given in the cluster's own console, never through the fleet's relay. */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  readonly mayAccept = computed(() => !this.fleetMode && atLeastRole(this.myProjectRole(), 'operator'));
  readonly mayGrantAdmin = computed(() => mayGrantProjectAdmin(this.me(), this.projectAccess()?.settings ?? null));
  readonly grantableRoles = computed(() => PROJECT_ROLES.filter((r) => r !== 'admin' || this.mayGrantAdmin()));
  readonly settingsDirty = computed(() => {
    const settings = this.projectAccess()?.settings;

    return (
      !!settings &&
      (settings.approvalMode !== this.approvalMode() ||
        settings.developerExec !== this.developerExec() ||
        settings.recordTerminals !== this.recordTerminals())
    );
  });

  readonly pending = signal<PendingConfirm | null>(null);
  readonly clusterInvalid = signal(false);
  readonly memberInvalid = signal(false);
  readonly filtersOpen = signal(false);
  readonly clusterFormOpen = signal(false);
  readonly memberFormOpen = signal(false);
  readonly approvalMode = signal<ApprovalMode>('developers');
  readonly developerExec = signal(false);
  readonly recordTerminals = signal(false);
  /** What the import editor shows (set by "load current access"); `importYaml` follows the user's edits. */
  readonly editorValue = signal('');
  importYaml = '';
  clusterUserId = '';
  clusterRole: ClusterRole = 'auditor';
  memberUserId = '';
  memberRole: ProjectRole = 'viewer';

  readonly clusterRoles = CLUSTER_ROLES;
  readonly approvalModes = APPROVAL_MODES;
  readonly clusterRoleLabel = clusterRoleLabel;
  readonly projectRoleLabel = projectRoleLabel;
  readonly approvalModeLabel = approvalModeLabel;
  readonly roleColor = roleColor;

  readonly title = $localize`:@@lwConsoleAccess-title:Access`;
  readonly refreshLabel = $localize`:@@lwConsoleAccess-refresh:Refresh`;
  readonly projectLabel = $localize`:@@lwConsoleAccess-project:Project`;
  readonly clusterTitle = $localize`:@@lwConsoleAccess-clusterMembers:Cluster members`;
  readonly membersTitle = $localize`:@@lwConsoleAccess-members:Members`;
  readonly settingsTitle = $localize`:@@lwConsoleAccess-settings:Settings`;
  readonly requestsTitle = $localize`:@@lwConsoleAccess-requests:Requests from other projects`;
  readonly transferTitle = $localize`:@@lwConsoleAccess-transfer:Export and import`;
  readonly cancelLabel = $localize`:@@lwConsoleAccess-cancel:Cancel`;
  readonly filtersTitle = $localize`:@@lwConsoleAccess-filters:Filters`;
  readonly addClusterMemberLabel = $localize`:@@lwConsoleAccess-addClusterMember:Grant a cluster role`;
  readonly addMemberLabel = $localize`:@@lwConsoleAccess-addMember:Add member`;
  readonly importedLabel = $localize`:@@lwConsoleAccess-imported:changes imported`;

  constructor() {
    // Who the caller is decides what loads: project list always, cluster members for cluster roles.
    effect(() => {
      const me = this.me();

      if (!me) return;

      untracked(() => {
        this.facade.loadProjects();

        if (me.clusterRole) this.facade.loadClusterMembers();
      });
    });

    effect(() => {
      const project = this.project();

      if (project) untracked(() => this.facade.openProject(project));
    });

    // The settings form follows what the API answered.
    effect(() => {
      const settings = this.projectAccess()?.settings;

      if (!settings) return;

      this.approvalMode.set(settings.approvalMode);
      this.developerExec.set(settings.developerExec);
      this.recordTerminals.set(settings.recordTerminals);
    });

    // An export goes to a file or into the import editor, then is forgotten.
    effect(() => {
      const exported = this.exported();

      if (!exported) return;

      untracked(() => {
        if (exported.target === 'download') downloadText(this.document, ACCESS_EXPORT_FILE_NAME, exported.yaml);
        else {
          this.importYaml = exported.yaml;
          this.editorValue.set(exported.yaml);
        }

        this.facade.clearExport();
      });
    });
  }

  refresh(): void {
    const project = this.project();

    this.facade.loadProjects();

    if (this.seesCluster()) this.facade.loadClusterMembers();

    if (project) this.facade.openProject(project);
  }

  selectProject(project: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { project: project || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // Cluster members

  openClusterMemberForm(): void {
    this.clusterUserId = '';
    this.clusterInvalid.set(false);
    this.clusterFormOpen.set(true);
  }

  editClusterMember(member: ClusterMember): void {
    this.clusterUserId = member.userId;
    this.clusterRole = member.role;
    this.clusterInvalid.set(false);
    this.clusterFormOpen.set(true);
  }

  saveClusterMember(): void {
    const userId = this.clusterUserId.trim();
    const role = this.clusterRole;

    if (!CLUSTER_USER_ID_PATTERN.test(userId)) {
      this.clusterInvalid.set(true);

      return;
    }

    this.clusterInvalid.set(false);
    this.clusterFormOpen.set(false);
    this.confirm({
      title: $localize`:@@lwConsoleAccess-setClusterTitle:Grant the cluster role?`,
      message: $localize`:@@lwConsoleAccess-setClusterMessage:${userId}:userId: becomes ${clusterRoleLabel(role)}:role:. The change takes effect immediately.`,
      confirmLabel: $localize`:@@lwConsoleAccess-grant:Grant`,
      danger: role === 'cluster-admin',
      run: () => {
        this.facade.setClusterMember(userId, role);
        this.clusterUserId = '';
      },
    });
  }

  removeClusterMember(member: ClusterMember): void {
    this.confirm({
      title: $localize`:@@lwConsoleAccess-removeClusterTitle:Remove the cluster role?`,
      message: $localize`:@@lwConsoleAccess-removeClusterMessage:${member.userId}:userId: loses the role ${clusterRoleLabel(member.role)}:role: immediately.`,
      confirmLabel: $localize`:@@lwConsoleAccess-remove:Remove`,
      danger: true,
      run: () => this.facade.removeClusterMember(member.userId),
    });
  }

  // Project members

  openMemberForm(): void {
    this.memberUserId = '';
    this.memberInvalid.set(false);
    this.memberFormOpen.set(true);
  }

  editMember(member: ProjectMember): void {
    this.memberUserId = member.userId;
    this.memberRole = member.role;
    this.memberInvalid.set(false);
    this.memberFormOpen.set(true);
  }

  saveMember(): void {
    const project = this.project();
    const userId = this.memberUserId.trim();
    const role = this.memberRole;

    if (!project) return;

    if (!PROJECT_USER_ID_PATTERN.test(userId) || !this.grantableRoles().includes(role)) {
      this.memberInvalid.set(true);

      return;
    }

    this.memberInvalid.set(false);
    this.memberFormOpen.set(false);
    this.confirm({
      title: $localize`:@@lwConsoleAccess-setMemberTitle:Grant the project role?`,
      message: $localize`:@@lwConsoleAccess-setMemberMessage:${userId}:userId: becomes ${projectRoleLabel(role)}:role: in ${project}:project:. The change takes effect immediately.`,
      confirmLabel: $localize`:@@lwConsoleAccess-grant:Grant`,
      danger: role === 'admin',
      run: () => {
        this.facade.setProjectMember(project, userId, role);
        this.memberUserId = '';
      },
    });
  }

  removeMember(member: ProjectMember): void {
    this.confirm({
      title: $localize`:@@lwConsoleAccess-removeMemberTitle:Remove the member?`,
      message: $localize`:@@lwConsoleAccess-removeMemberMessage:${member.userId}:userId: loses access to ${member.project}:project: immediately.`,
      confirmLabel: $localize`:@@lwConsoleAccess-remove:Remove`,
      danger: true,
      run: () => this.facade.removeProjectMember(member.project, member.userId),
    });
  }

  // Settings

  resetSettings(): void {
    const settings = this.projectAccess()?.settings;

    if (!settings) return;

    this.approvalMode.set(settings.approvalMode);
    this.developerExec.set(settings.developerExec);
    this.recordTerminals.set(settings.recordTerminals);
  }

  saveSettings(): void {
    const settings = this.projectAccess()?.settings;
    const project = this.project();

    if (!settings || !project) return;

    const patch: ProjectSettingsPatch = {
      ...(settings.approvalMode !== this.approvalMode() ? { approvalMode: this.approvalMode() } : {}),
      ...(settings.developerExec !== this.developerExec() ? { developerExec: this.developerExec() } : {}),
      ...(settings.recordTerminals !== this.recordTerminals() ? { recordTerminals: this.recordTerminals() } : {}),
    };

    if (Object.keys(patch).length === 0) return;

    this.confirm({
      title: $localize`:@@lwConsoleAccess-saveSettingsTitle:Change the project settings?`,
      message: $localize`:@@lwConsoleAccess-saveSettingsMessage:The settings of ${project}:project: change immediately (not through a plan).`,
      confirmLabel: $localize`:@@lwConsoleAccess-save:Save`,
      danger: false,
      run: () => this.facade.updateSettings(project, patch),
    });
  }

  // Requests

  acceptRequest(request: CrossProjectRequest): void {
    const project = this.project();

    if (!project) return;

    this.confirm({
      title: $localize`:@@lwConsoleAccess-acceptTitle:Accept the policy?`,
      message: $localize`:@@lwConsoleAccess-acceptMessage:Policy ${request.policy}:policy: of ${request.project}:from: may reach the groups of ${project}:project: in exactly this version.`,
      confirmLabel: $localize`:@@lwConsoleAccess-accept:Accept`,
      danger: false,
      run: () => this.facade.accept(project, request),
    });
  }

  // Export / import

  exportAccess(target: 'download' | 'editor'): void {
    this.facade.exportAccess(target);
  }

  onImportYamlChange(yaml: string): void {
    this.importYaml = yaml;

    if (this.importResult() || this.importError()) this.facade.clearImport();
  }

  importAccess(): void {
    const yaml = this.importYaml;

    if (!yaml.trim()) return;

    this.confirm({
      title: $localize`:@@lwConsoleAccess-importTitle:Import access?`,
      message: $localize`:@@lwConsoleAccess-importMessage:Memberships and project settings in the YAML are applied immediately and audited.`,
      confirmLabel: $localize`:@@lwConsoleAccess-import:Import`,
      danger: true,
      run: () => this.facade.importAccess(yaml),
    });
  }

  // Confirmation

  private confirm(pending: PendingConfirm): void {
    this.facade.clearChangeError();
    this.pending.set(pending);
  }

  onConfirmOpenChange(open: boolean): void {
    if (!open) this.pending.set(null);
  }

  confirmPending(): void {
    const pending = this.pending();

    this.pending.set(null);
    pending?.run();
  }
}
