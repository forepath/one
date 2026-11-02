import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleWallboardsFacade,
  type CreateWallboardTokenRequest,
  type WallboardToken,
  WallboardsService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
} from '@forepath/shared/frontend/ui-components';

import { projectRoleOf } from '../access/access-format';
import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem, dlUserLabel } from '../section/data-list';
import { kioskUrl, MAX_WALLBOARD_DAYS, MAX_WALLBOARD_PROJECTS, wallboardScopeLabel } from './wallboard-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

const DEFAULT_DAYS = 365;

/**
 * Wallboards (3.25): read-only tokens that can only open the kiosk view — cluster-wide ones for cluster admins,
 * project ones for project admins. A new token's kiosk URL is shown once.
 */
@Component({
  selector: 'loadweaver-wallboards-page',
  imports: [
    LoadweaverSavedViewsComponent,
    FpcFormFieldComponent,
    FpcFormControlComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
  ],
  templateUrl: './wallboards-page.component.html',
  standalone: true,
})
export class LoadweaverWallboardsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleWallboardsFacade);
  private readonly accessManagement = inject(ConsoleAccessManagementFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly document = inject(DOCUMENT);
  private readonly service = inject(WallboardsService);

  readonly tokens = toSignal(this.facade.tokens$, { initialValue: [] as WallboardToken[] });
  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly shown = computed(() =>
    filterBySearch(this.tokens(), this.search(), (t) => [
      t.name,
      wallboardScopeLabel(t),
      t.projects ?? [],
      dlUserLabel(t.createdBy, t.createdByEmail),
      t.createdBy,
    ]),
  );
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly creating = toSignal(this.facade.creating$, { initialValue: false });
  readonly created = toSignal(this.facade.created$, { initialValue: null });
  readonly revoking = toSignal(this.facade.revoking$, { initialValue: null });
  readonly tokenError = toSignal(this.facade.tokenError$, { initialValue: null });
  private readonly me = toSignal(this.access.me$, { initialValue: null });
  private readonly allProjects = toSignal(this.accessManagement.projects$, { initialValue: [] as string[] });

  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  /** Projects the caller administers (cluster admins: every project). */
  readonly adminProjects = computed(() => {
    const me = this.me();

    return this.isClusterAdmin()
      ? this.allProjects()
      : Object.keys(me?.projects ?? {})
          .filter((p) => projectRoleOf(me, p) === 'admin')
          .sort();
  });
  readonly createdUrl = computed(() => {
    const token = this.created();

    return token ? kioskUrl(this.document.baseURI, token.token) : null;
  });

  readonly createOpen = signal(false);
  readonly revokeFor = signal<WallboardToken | null>(null);
  readonly invalid = signal(false);
  readonly selectedProjects = signal<string[]>([]);
  name = '';
  scope: 'cluster' | 'projects' = 'projects';
  expiresInDays: number | null = DEFAULT_DAYS;

  readonly scopeLabel = wallboardScopeLabel;
  readonly maxDays = MAX_WALLBOARD_DAYS;
  readonly maxProjects = MAX_WALLBOARD_PROJECTS;

  readonly title = $localize`:@@lwConsoleWallboards-title:Wallboards`;
  readonly loadingLabel = $localize`:@@lwConsoleWallboards-loading:Loading wallboards`;
  readonly refreshLabel = $localize`:@@lwConsoleWallboards-refresh:Refresh`;
  readonly addLabel = $localize`:@@lwConsoleWallboards-add:New wallboard`;
  readonly revokeLabel = $localize`:@@lwConsoleWallboards-revoke:Revoke`;
  readonly searchLabel = $localize`:@@lwConsoleWallboards-search:Search wallboards`;
  readonly expiredLabel = $localize`:@@lwConsoleWallboards-expired:Expired`;
  readonly inUseLabel = $localize`:@@lwConsoleWallboards-inUse:In use`;
  readonly unusedLabel = $localize`:@@lwConsoleWallboards-unused:Not used yet`;
  readonly noExpiryLabel = $localize`:@@lwConsoleWallboards-noExpiry:Never expires`;

  /** 3.38 D1: State (expired / in use / unused) · Name · scope · created · by · expires · last used; ⋮ revoke. */
  readonly columns: FpcTableColumn<WallboardToken>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleWallboards-colState:State`,
      type: 'state',
      state: (t) =>
        t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()
          ? { label: this.expiredLabel, tone: 'neutral', icon: 'hourglass-bottom' }
          : t.lastUsedAt
            ? { label: this.inUseLabel, tone: 'success', icon: 'display' }
            : { label: this.unusedLabel, tone: 'info', icon: 'dash-circle' },
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleWallboards-colName:Name`,
      value: (t) => t.name,
      required: true,
      priority: 1,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleWallboards-colScope:Scope`,
      value: (t) => wallboardScopeLabel(t),
      priority: 1,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleWallboards-created:Created`,
      value: (t) => t.createdAt,
      priority: 2,
    },
    {
      id: 'createdBy',
      label: $localize`:@@lwConsoleWallboards-colCreatedBy:Created by`,
      value: (t) => dlUserLabel(t.createdBy, t.createdByEmail),
      priority: 3,
    },
    {
      id: 'expires',
      label: $localize`:@@lwConsoleWallboards-expires:Expires`,
      value: (t) => t.expiresAt ?? null,
      priority: 2,
    },
    {
      id: 'lastUsed',
      label: $localize`:@@lwConsoleWallboards-lastUsed:Last used`,
      value: (t) => t.lastUsedAt ?? null,
      priority: 2,
    },
  ];
  readonly rowMenu = (t: WallboardToken): FpcMenuItem[] => [
    { id: 'revoke', label: this.revokeLabel, icon: 'trash', danger: true, disabled: this.revoking() === t.id },
    { ...dlCopyIdItem(), dividerBefore: true },
  ];
  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkRevoke = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly bulkRevokeMessage = computed(
    () =>
      $localize`:@@lwConsoleWallboards-bulkRevokeMessage:${this.selected().length}:count: selected wallboard tokens are revoked; their screens stop showing the overview at their next refresh. Tokens you may not revoke are reported and left as they are.`,
  );
  readonly createTitle = $localize`:@@lwConsoleWallboards-createTitle:New wallboard`;
  readonly revokeTitle = $localize`:@@lwConsoleWallboards-revokeTitle:Revoke the wallboard token?`;
  readonly revokeMessage = $localize`:@@lwConsoleWallboards-revokeMessage:Screens using it stop showing the overview at their next refresh.`;
  readonly revokeConfirm = $localize`:@@lwConsoleWallboards-revokeConfirm:Revoke`;
  readonly keepLabel = $localize`:@@lwConsoleWallboards-keep:Keep`;

  constructor() {
    // Cluster admins pick from every project.
    effect(() => {
      if (this.isClusterAdmin()) untracked(() => this.accessManagement.loadProjects());
    });
  }

  ngOnInit(): void {
    this.facade.load();
  }

  refresh(): void {
    this.facade.load();
  }

  openCreate(): void {
    this.name = '';
    this.scope = this.isClusterAdmin() ? 'cluster' : 'projects';
    this.expiresInDays = DEFAULT_DAYS;
    this.selectedProjects.set(this.adminProjects().length === 1 ? [...this.adminProjects()] : []);
    this.invalid.set(false);
    this.facade.clearCreated();
    this.createOpen.set(true);
  }

  onCreateOpenChange(open: boolean): void {
    this.createOpen.set(open);

    // The plaintext token is shown only while the dialog is open.
    if (!open) this.facade.clearCreated();
  }

  toggleProject(project: string, checked: boolean): void {
    this.selectedProjects.update((list) =>
      checked ? [...new Set([...list, project])].sort() : list.filter((p) => p !== project),
    );
  }

  create(): void {
    const name = this.name.trim();
    const days = this.expiresInDays === null || `${this.expiresInDays}` === '' ? null : Number(this.expiresInDays);
    const projects = this.scope === 'projects' ? this.selectedProjects() : [];
    const scopeValid =
      this.scope === 'cluster'
        ? this.isClusterAdmin()
        : projects.length > 0 && projects.length <= MAX_WALLBOARD_PROJECTS;

    if (
      !name ||
      name.length > 255 ||
      !scopeValid ||
      (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_WALLBOARD_DAYS))
    ) {
      this.invalid.set(true);

      return;
    }

    this.invalid.set(false);

    const request: CreateWallboardTokenRequest = {
      name,
      ...(projects.length > 0 ? { projects } : {}),
      ...(days !== null ? { expiresInDays: days } : {}),
    };

    this.facade.create(request);
  }

  copy(text: string): void {
    void navigator.clipboard?.writeText(text);
  }

  onRevokeOpenChange(open: boolean): void {
    if (!open) this.revokeFor.set(null);
  }

  onRowAction(token: WallboardToken, action: string): void {
    if (action === 'revoke') this.revokeFor.set(token);
    else if (action === 'copy-id') fpcCopyText(token.id);
  }

  /** Bulk Revoke: one call per token (same endpoint + authorization as the row action), per-token result. */
  async revokeSelected(): Promise<void> {
    const ids = new Set(this.selected());
    const tokens = this.tokens().filter((t) => ids.has(t.id));

    if (tokens.length === 0) return;

    const result = await fpcRunBulk(tokens, (t) => firstValueFrom(this.service.revoke(t.id)));

    this.bulkResult.set(dlBulkSummary(result, (t) => t.name));
    this.selected.set([]);
    this.facade.load();
  }

  confirmRevoke(): void {
    const token = this.revokeFor();

    this.revokeFor.set(null);

    if (token) this.facade.revoke(token.id);
  }
}
