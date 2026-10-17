import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleWallboardsFacade,
  type CreateWallboardTokenRequest,
  type WallboardToken,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { projectRoleOf } from '../access/access-format';
import { kioskUrl, MAX_WALLBOARD_DAYS, MAX_WALLBOARD_PROJECTS, wallboardScopeLabel } from './wallboard-format';

const DEFAULT_DAYS = 365;

/**
 * Wallboards (3.25): read-only tokens that can only open the kiosk view — cluster-wide ones for cluster admins,
 * project ones for project admins. A new token's kiosk URL is shown once.
 */
@Component({
  selector: 'loadweaver-wallboards-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './wallboards-page.component.html',
  standalone: true,
})
export class LoadweaverWallboardsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleWallboardsFacade);
  private readonly accessManagement = inject(ConsoleAccessManagementFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly document = inject(DOCUMENT);

  readonly tokens = toSignal(this.facade.tokens$, { initialValue: [] as WallboardToken[] });
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
  readonly refreshLabel = $localize`:@@lwConsoleWallboards-refresh:Refresh`;
  readonly tokensTitle = $localize`:@@lwConsoleWallboards-tokens:Wallboard tokens`;
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

  confirmRevoke(): void {
    const token = this.revokeFor();

    this.revokeFor.set(null);

    if (token) this.facade.revoke(token.id);
  }
}
