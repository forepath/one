import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, Injector, signal, untracked } from '@angular/core';
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
  AccessManagementService,
  ConsoleEndpointService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCodeEditorComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  type FpcMenuItem,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { filterBySearch } from '../list-search';
import { firstValueFrom, map } from 'rxjs';
import { dlBulkSummary, dlCopyIdItem, dlUserLabel } from '../section/data-list';

import {
  approvalsAvailable,
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
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { injectSectionScope, sectionQuery$ } from '../section/section-scope';

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
 * YAML (cluster admins, in a modal). Changes are immediate (not plan / apply) and audited, so each one is confirmed.
 * Embedded (3.38) in the cluster's Permissions tab (no scope params: the cluster members only) or a project's Members
 * tab (`project`: that project's lanes only); the routed header and the project picker are hidden, the URL untouched.
 */
/** Lanes of the access page. */
export type AccessLane = 'cluster' | 'members' | 'project' | 'requests';

@Component({
  selector: 'loadweaver-access-page',
  imports: [
    LoadweaverSavedViewsComponent,
    LoadweaverLaneComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCodeEditorComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcKeyValueListComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    CommonModule,
    FormsModule,
    RouterModule,
    LoadweaverAccessRequestsComponent,
  ],
  templateUrl: './access-page.component.html',
  standalone: true,
  styles: `
    .lw-access__project {
      display: inline-flex;
      min-width: 9rem;
      max-width: 14rem;
    }

    /* Settings in a narrow lane: each value under its label (no 35 % label column squeezing the value). */
    .lw-access__settings ::ng-deep .fpc-key-value-list__row {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.125rem;
    }
  `,
})
export class LoadweaverAccessPageComponent {
  private readonly facade = inject(ConsoleAccessManagementFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  /** The object scope when embedded in an object tab (3.38). */
  readonly scope = injectSectionScope();

  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly projects = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  readonly clusterMembers = toSignal(this.facade.clusterMembers$, { initialValue: [] as ClusterMember[] });
  readonly clusterMembersLoading = toSignal(this.facade.clusterMembersLoading$, { initialValue: false });
  readonly clusterMembersError = toSignal(this.facade.clusterMembersError$, { initialValue: null });
  readonly projectAccess = toSignal(this.facade.projectAccess$, { initialValue: null });
  readonly members = toSignal(this.facade.projectMembers$, { initialValue: [] as ProjectMember[] });
  /** Lane searches (3.37 lane grammar): cluster members and project members. */
  readonly clusterSearch = signal('');
  readonly memberSearch = signal('');
  readonly requestSearch = signal('');
  /** "Views ▾" (3.37): saved lane searches of this page, per user. */
  readonly views = savedViewBinding({ clusterSearch: this.clusterSearch, memberSearch: this.memberSearch });
  readonly filteredClusterMembers = computed(() =>
    filterBySearch(this.clusterMembers(), this.clusterSearch(), (m) => [
      this.memberLabel(m),
      dlUserLabel(m.createdBy, m.createdByEmail),
      m.userId,
      m.createdBy,
      this.clusterRoleLabel(m.role),
    ]),
  );
  readonly filteredMembers = computed(() =>
    filterBySearch(this.members(), this.memberSearch(), (m) => [
      this.memberLabel(m),
      dlUserLabel(m.createdBy, m.createdByEmail),
      m.userId,
      m.createdBy,
      this.projectRoleLabel(m.role),
    ]),
  );
  /** The phone lane switch (3.37 P7): the visible lanes and the picked one. */
  readonly lane = signal<AccessLane>('cluster');
  readonly lanes = computed<AccessLane[]>(() => [
    ...(this.showsCluster() ? (['cluster'] as const) : []),
    ...(this.project() ? (['members', 'project', 'requests'] as const) : []),
  ]);
  readonly currentLane = computed<AccessLane>(() =>
    this.lanes().includes(this.lane()) ? this.lane() : (this.lanes()[0] ?? 'cluster'),
  );
  readonly laneLabels: Record<AccessLane, string> = {
    cluster: $localize`:@@lwConsoleAccess-laneCluster:Cluster`,
    members: $localize`:@@lwConsoleAccess-laneMembers:Members`,
    project: $localize`:@@lwConsoleAccess-laneProject:Settings`,
    requests: $localize`:@@lwConsoleAccess-laneRequests:Requests`,
  };
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
  private readonly queryProject = toSignal(sectionQuery$(this.route, this.scope).pipe(map((p) => p.get('project'))), {
    initialValue: null,
  });

  /**
   * The project shown: `?project=` (or the scope's) or the first one the caller may pick; embedded without a project
   * (the cluster's Permissions tab) none.
   */
  readonly project = computed(() => this.queryProject() || (this.scope ? null : this.projects()[0]) || null);
  readonly seesCluster = computed(() => !!this.me()?.clusterRole);
  /** The cluster lane: for cluster roles, not while embedded in a project's tab. */
  readonly showsCluster = computed(() => this.seesCluster() && !(this.scope && this.queryProject()));
  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  readonly myProjectRole = computed(() => projectRoleOf(this.me(), this.project()));
  readonly mayAdminProject = computed(() => this.myProjectRole() === 'admin');
  /** Fleet mode: acceptances through the fleet only when the cluster verifies its identity claims (3.24). */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  readonly mayAccept = computed(
    () => approvalsAvailable(this.fleetMode, this.me()) && atLeastRole(this.myProjectRole(), 'operator'),
  );
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
  readonly clusterFormOpen = signal(false);
  readonly memberFormOpen = signal(false);
  readonly transferOpen = signal(false);
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
  readonly settingsTitle = $localize`:@@lwConsoleAccess-settings:Settings`;
  readonly requestsTitle = $localize`:@@lwConsoleAccess-requests:Requests from other projects`;
  readonly transferTitle = $localize`:@@lwConsoleAccess-transfer:Export and import`;
  readonly cancelLabel = $localize`:@@lwConsoleAccess-cancel:Cancel`;
  readonly closeLabel = $localize`:@@lwConsoleAccess-close:Close`;
  readonly loadingLabel = $localize`:@@lwConsoleAccess-loading:Loading members`;
  readonly requestSearchLabel = $localize`:@@lwConsoleAccess-requestSearch:Search requests`;
  readonly addClusterMemberLabel = $localize`:@@lwConsoleAccess-addClusterMember:Grant a cluster role`;
  readonly addMemberLabel = $localize`:@@lwConsoleAccess-addMember:Add member`;
  readonly changeRoleLabel = $localize`:@@lwConsoleAccess-changeRole:Change role`;
  readonly removeLabel = $localize`:@@lwConsoleAccess-remove:Remove`;
  readonly searchLabel = $localize`:@@lwConsoleAccess-search:Search members`;
  readonly editSettingsLabel = $localize`:@@lwConsoleAccess-editSettings:Edit settings`;
  readonly settingsOpen = signal(false);
  /** The project settings at a glance (the form is in a modal, 3.38 D10). */
  readonly settingsFacts = computed<FpcKeyValueItem[]>(() => {
    const settings = this.projectAccess()?.settings;

    if (!settings) return [];

    const yes = $localize`:@@lwConsoleAccess-yes:Yes`;
    const no = $localize`:@@lwConsoleAccess-no:No`;

    return [
      {
        key: 'approval',
        label: $localize`:@@lwConsoleAccess-approvalMode:Plans that need an approval`,
        value: approvalModeLabel(settings.approvalMode),
      },
      {
        key: 'exec',
        label: $localize`:@@lwConsoleAccess-developerExec:Developers may open terminals`,
        value: settings.developerExec ? yes : no,
      },
      {
        key: 'record',
        label: $localize`:@@lwConsoleAccess-recordTerminals:Record terminal sessions`,
        value: settings.recordTerminals ? yes : no,
      },
    ];
  });

  // Typed per table (not `{ userId }`): the data table infers its row type from these, and the narrow shape broke the
  // `(rowAction)` handlers under strict templates.
  readonly clusterMemberId = (member: ClusterMember): string => member.userId;
  readonly projectMemberId = (member: ProjectMember): string => member.userId;
  /** A member as people read it (email, "Deleted user", …), never the raw id (D11; Copy ID stays in ⋮). */
  readonly memberLabel = (member: { userId: string; userEmail?: string | null }) =>
    dlUserLabel(member.userId, member.userEmail);
  /** 3.38 D1: Member · role · since · granted by. */
  readonly clusterColumns: FpcTableColumn<ClusterMember>[] = [
    {
      id: 'user',
      label: $localize`:@@lwConsoleAccess-colMember:Member`,
      value: (m) => this.memberLabel(m),
      required: true,
      priority: 1,
    },
    {
      id: 'role',
      label: $localize`:@@lwConsoleAccess-role:Role`,
      value: (m) => clusterRoleLabel(m.role),
      priority: 1,
    },
    { id: 'since', label: $localize`:@@lwConsoleAccess-since:Since`, value: (m) => m.createdAt },
    {
      id: 'by',
      label: $localize`:@@lwConsoleAccess-colGrantedBy:Granted by`,
      value: (m) => dlUserLabel(m.createdBy, m.createdByEmail),
      priority: 3,
    },
  ];
  readonly memberColumns: FpcTableColumn<ProjectMember>[] = [
    {
      id: 'user',
      label: $localize`:@@lwConsoleAccess-colMember:Member`,
      value: (m) => this.memberLabel(m),
      required: true,
      priority: 1,
    },
    {
      id: 'role',
      label: $localize`:@@lwConsoleAccess-role:Role`,
      value: (m) => projectRoleLabel(m.role),
      priority: 1,
    },
    { id: 'since', label: $localize`:@@lwConsoleAccess-since:Since`, value: (m) => m.createdAt },
    {
      id: 'by',
      label: $localize`:@@lwConsoleAccess-colGrantedBy:Granted by`,
      value: (m) => dlUserLabel(m.createdBy, m.createdByEmail),
      priority: 3,
    },
  ];
  readonly clusterMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: this.changeRoleLabel, icon: 'pencil' },
    { id: 'remove', label: this.removeLabel, icon: 'trash', danger: true },
    dlCopyIdItem(),
  ];
  /** Admin memberships only for those who may grant admin (the same rule as the single actions). */
  private mayChangeMember(member: ProjectMember): boolean {
    return this.mayAdminProject() && (member.role !== 'admin' || this.mayGrantAdmin());
  }
  readonly memberMenu = (member: ProjectMember): FpcMenuItem[] => [
    ...(this.mayChangeMember(member)
      ? [
          { id: 'edit', label: this.changeRoleLabel, icon: 'pencil' },
          { id: 'remove', label: this.removeLabel, icon: 'trash', danger: true },
        ]
      : []),
    dlCopyIdItem(),
  ];

  private readonly injector = inject(Injector);
  readonly selectedCluster = signal<readonly string[]>([]);
  readonly selectedMembers = signal<readonly string[]>([]);
  /** Which bulk removal waits for its confirmation. */
  readonly confirmBulk = signal<'cluster' | 'members' | null>(null);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly bulkRemoveTitle = $localize`:@@lwConsoleAccess-bulkRemoveTitle:Remove the selected roles?`;
  readonly bulkRemoveMessage = computed(
    () =>
      $localize`:@@lwConsoleAccess-bulkRemoveMessage:${(this.confirmBulk() === 'cluster' ? this.selectedCluster() : this.selectedMembers()).length}:count: selected members lose their role immediately. Members you may not change are reported and left as they are.`,
  );
  private readonly selectedMemberRows = computed(() => {
    const ids = new Set(this.selectedMembers());

    return this.members().filter((m) => ids.has(m.userId));
  });
  readonly canRemoveMembers = computed(
    () => this.selectedMemberRows().length > 0 && this.selectedMemberRows().every((m) => this.mayChangeMember(m)),
  );
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

  /** Lane title of a project's members (no "Members: p" string). */
  membersOf(project: string): string {
    return $localize`:@@lwConsoleAccess-membersOf:Members of ${project}:project:`;
  }

  refresh(): void {
    const project = this.project();

    this.facade.loadProjects();

    if (this.seesCluster()) this.facade.loadClusterMembers();

    if (project) this.facade.openProject(project);
  }

  selectProject(project: string): void {
    // Embedded the scope fixes the project (and the picker is hidden): never write the URL.
    if (this.scope) return;

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
    // An existing member by their label; a newly typed id as typed.
    const existing = this.clusterMembers().find((m) => m.userId === userId);
    const who = existing ? this.memberLabel(existing) : userId;

    this.confirm({
      title: $localize`:@@lwConsoleAccess-setClusterTitle:Grant the cluster role?`,
      message: $localize`:@@lwConsoleAccess-setClusterMessage:${who}:userId: becomes ${clusterRoleLabel(role)}:role:. The change takes effect immediately.`,
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
      message: $localize`:@@lwConsoleAccess-removeClusterMessage:${this.memberLabel(member)}:userId: loses the role ${clusterRoleLabel(member.role)}:role: immediately.`,
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
    const existing = this.members().find((m) => m.userId === userId);
    const who = existing ? this.memberLabel(existing) : userId;

    this.confirm({
      title: $localize`:@@lwConsoleAccess-setMemberTitle:Grant the project role?`,
      message: $localize`:@@lwConsoleAccess-setMemberMessage:${who}:userId: becomes ${projectRoleLabel(role)}:role: in ${project}:project:. The change takes effect immediately.`,
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
      message: $localize`:@@lwConsoleAccess-removeMemberMessage:${this.memberLabel(member)}:userId: loses access to ${member.project}:project: immediately.`,
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

    this.settingsOpen.set(false);
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

  onClusterAction(member: ClusterMember, action: string): void {
    if (action === 'edit') this.editClusterMember(member);
    else if (action === 'remove') this.removeClusterMember(member);
    else if (action === 'copy-id') fpcCopyText(member.userId);
  }

  onMemberAction(member: ProjectMember, action: string): void {
    if (action === 'edit') this.editMember(member);
    else if (action === 'remove') this.removeMember(member);
    else if (action === 'copy-id') fpcCopyText(member.userId);
  }

  /** Bulk Remove: one call per member (same endpoint + authorization as the row action), per-member result. */
  async removeSelected(): Promise<void> {
    const which = this.confirmBulk();
    const api = this.injector.get(AccessManagementService);

    this.confirmBulk.set(null);

    if (which === 'cluster') {
      const ids = new Set(this.selectedCluster());
      const members = this.clusterMembers().filter((m) => ids.has(m.userId));
      const result = await fpcRunBulk(members, (m) => firstValueFrom(api.removeClusterMember(m.userId)));

      this.bulkResult.set(dlBulkSummary(result, (m) => this.memberLabel(m)));
      this.selectedCluster.set([]);
    } else if (which === 'members') {
      const members = this.selectedMemberRows().filter((m) => this.mayChangeMember(m));
      const result = await fpcRunBulk(members, (m) => firstValueFrom(api.removeMember(m.project, m.userId)));

      this.bulkResult.set(dlBulkSummary(result, (m) => this.memberLabel(m)));
      this.selectedMembers.set([]);
    }

    this.refresh();
  }

  /** The requests lane's bulk Accept finished: its result, then reload. */
  onRequestsBulkDone(result: { tone: 'success' | 'warning' | 'danger'; message: string }): void {
    this.bulkResult.set(result);
    this.refresh();
  }

  openSettings(): void {
    this.resetSettings();
    this.settingsOpen.set(true);
  }

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
