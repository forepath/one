import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AuthService,
  createIdentityAppSuccess,
  IdentityAppsFacade,
  PersonalAccessTokensFacade,
  rotateIdentityAppSecretSuccess,
  updateIdentityAppSuccess,
  type IdentityAppGrantResponseDto,
  type IdentityAppInputDto,
  type IdentityAppResponseDto,
} from '@forepath/identity/frontend';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLabelComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcTableCellDirective,
  FpcTooltipComponent,
  fpcCopyText,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import { combineLatestWith, firstValueFrom, map } from 'rxjs';

import { SHARED_DL_DELETE, SHARED_DL_EDIT, SHARED_DL_REVOKE, sharedBulkSummary, sharedCopyIdItem } from '../data-list';

type AppFormState = {
  name: string;
  description: string;
  returnUrl: string;
  scopes: string[];
};

const emptyForm = (): AppFormState => ({ name: '', description: '', returnUrl: '', scopes: [] });

/** Mirrors the backend rule: absolute https URL (http only for loopback), no credentials or fragment. */
export function isValidAppReturnUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());

    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * Admin app management (3.38 data-list pattern): apps with id + secret (shown once), scopes from the PAT
 * catalog, and per-app authorizations that can be revoked to force re-authentication.
 */
@Component({
  selector: 'identity-auth-app-manager',
  imports: [
    CommonModule,
    FpcDatePipe,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLabelComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcTableCellDirective,
    FpcTooltipComponent,
  ],
  templateUrl: './app-manager.component.html',
  styleUrls: ['./app-manager.component.scss'],
  standalone: true,
})
export class IdentityAppManagerComponent implements OnInit {
  private readonly facade = inject(IdentityAppsFacade);
  private readonly tokensFacade = inject(PersonalAccessTokensFacade);
  private readonly authService = inject(AuthService);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAppManager-title:Apps`;
  readonly addAppTitle = $localize`:@@featureAppManager-addAppTitle:Create app`;
  readonly searchPlaceholder = $localize`:@@featureAppManager-searchPlaceholder:Search apps`;
  readonly emptyMessage = $localize`:@@featureAppManager-empty:No apps yet`;
  readonly deleteLabel = SHARED_DL_DELETE;
  readonly revokeLabel = SHARED_DL_REVOKE;
  readonly grantsTitle = $localize`:@@featureAppManager-grantsTitle:Authorizations`;
  readonly noGrantsMessage = $localize`:@@featureAppManager-noGrants:No user has authorized this app yet`;
  readonly createTitle = $localize`:@@featureAppManager-createTitle:Create app`;
  readonly editTitle = $localize`:@@featureAppManager-editTitle:Edit app`;

  readonly formModalOpen = signal(false);
  readonly secretModalOpen = signal(false);
  readonly rotateDialogOpen = signal(false);
  readonly deleteDialogOpen = signal(false);
  readonly grantsModalOpen = signal(false);
  readonly revokeAllDialogOpen = signal(false);
  readonly copied = signal<'id' | 'secret' | null>(null);

  readonly searchQuery = signal('');
  private readonly searchQuery$ = toObservable(this.searchQuery);

  readonly apps = toSignal(
    this.facade.apps$.pipe(
      combineLatestWith(this.searchQuery$),
      map(([apps, query]) => {
        const needle = query.trim().toLowerCase();

        return needle
          ? apps.filter((app) =>
              `${app.name} ${app.description ?? ''} ${app.returnUrl} ${app.scopes.join(' ')}`
                .toLowerCase()
                .includes(needle),
            )
          : apps;
      }),
    ),
    { initialValue: [] as IdentityAppResponseDto[] },
  );
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly saving = toSignal(this.facade.saving$, { initialValue: false });
  readonly deleting = toSignal(this.facade.deleting$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null as string | null });
  readonly lastSecret = toSignal(this.facade.lastSecret$, { initialValue: null as string | null });
  readonly scopes = toSignal(this.tokensFacade.scopes$, { initialValue: [] });
  readonly scopeSearch = signal('');
  readonly filteredScopes = computed(() => {
    const query = this.scopeSearch().trim().toLowerCase();
    const scopes = this.scopes();

    return query ? scopes.filter((item) => item.scope.toLowerCase().includes(query)) : scopes;
  });
  readonly scopeSearchPlaceholder = $localize`:@@featureScopePicker-searchPlaceholder:Search scopes`;
  readonly scopesLoading = toSignal(this.tokensFacade.scopesLoading$, { initialValue: false });
  readonly grants = toSignal(this.facade.grants$, { initialValue: [] as IdentityAppGrantResponseDto[] });
  readonly grantsLoading = toSignal(this.facade.grantsLoading$, { initialValue: false });
  readonly grantsRevoking = toSignal(this.facade.grantsRevoking$, { initialValue: false });
  readonly grantsError = toSignal(this.facade.grantsError$, { initialValue: null as string | null });

  readonly selectedAppIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkDeleteOpen = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly selectedApps = computed(() => {
    const ids = new Set(this.selectedAppIds());

    return this.apps().filter((app) => ids.has(app.id));
  });

  form = emptyForm();
  appToEdit: IdentityAppResponseDto | null = null;
  readonly activeApp = signal<IdentityAppResponseDto | null>(null);
  /** App whose id + secret the secret modal shows. */
  readonly secretApp = signal<IdentityAppResponseDto | null>(null);
  readonly grantsModalTitle = computed(() => {
    const app = this.activeApp();

    return app ? `${this.grantsTitle}: ${app.name}` : this.grantsTitle;
  });
  grantToRevoke: IdentityAppGrantResponseDto | null = null;
  readonly revokeGrantDialogOpen = signal(false);

  readonly columns: FpcTableColumn<IdentityAppResponseDto>[] = [
    {
      id: 'name',
      label: $localize`:@@featureAppManager-nameLabel:Name`,
      value: (app) => app.name,
      required: true,
      priority: 1,
    },
    {
      id: 'returnUrl',
      label: $localize`:@@featureAppManager-returnUrlLabel:Return URL`,
      value: (app) => app.returnUrl,
      priority: 2,
    },
    { id: 'scopes', label: $localize`:@@featureAppManager-scopesLabel:Scopes`, priority: 1 },
    {
      id: 'grants',
      label: $localize`:@@featureAppManager-colGrants:Authorizations`,
      value: (app) => app.grantCount,
      priority: 2,
      width: '9rem',
    },
    {
      id: 'created',
      label: $localize`:@@featureAppManager-colCreated:Created`,
      value: (app) => app.createdAt,
      priority: 3,
    },
  ];

  readonly grantColumns: FpcTableColumn<IdentityAppGrantResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureAppManager-colGrantState:State`,
      type: 'state',
      state: (grant) =>
        grant.needsReauthorization
          ? {
              label: $localize`:@@featureAppManager-grantNeedsReauth:Re-authorization pending`,
              tone: 'warning',
              icon: 'arrow-repeat',
            }
          : { label: $localize`:@@featureAppManager-grantActive:Active`, tone: 'success', icon: 'check-circle' },
    },
    {
      id: 'user',
      label: $localize`:@@featureAppManager-colUser:User`,
      value: (grant) => grant.userEmail,
      required: true,
      priority: 1,
    },
    { id: 'grantScopes', label: $localize`:@@featureAppManager-scopesLabel:Scopes`, priority: 1 },
    {
      id: 'sessions',
      label: $localize`:@@featureAppManager-colSessions:Sessions`,
      value: (grant) => grant.sessionCount,
      priority: 2,
      width: '6rem',
    },
    {
      id: 'lastUsed',
      label: $localize`:@@featureAppManager-colLastUsed:Last used`,
      value: (grant) => grant.lastUsedAt ?? '',
      priority: 2,
    },
  ];

  readonly appRowMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: SHARED_DL_EDIT, icon: 'pencil' },
    { id: 'grants', label: this.grantsTitle, icon: 'people' },
    { id: 'rotate', label: $localize`:@@featureAppManager-rotateSecret:Regenerate secret`, icon: 'arrow-repeat' },
    sharedCopyIdItem(),
    { id: 'delete', label: SHARED_DL_DELETE, icon: 'trash', danger: true, dividerBefore: true },
  ];

  readonly grantRowMenu = (): FpcMenuItem[] => [
    { id: 'revoke', label: SHARED_DL_REVOKE, icon: 'x-octagon', danger: true },
  ];

  ngOnInit(): void {
    this.facade.load();
    this.tokensFacade.loadScopes();

    this.actions$
      .pipe(ofType(createIdentityAppSuccess, updateIdentityAppSuccess, rotateIdentityAppSecretSuccess))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((action) => {
        this.formModalOpen.set(false);
        this.appToEdit = null;

        if (action.type !== updateIdentityAppSuccess.type) {
          this.copied.set(null);
          this.secretApp.set(action.app);
          this.secretModalOpen.set(true);
        }
      });
  }

  onRefresh(): void {
    this.facade.load();
  }

  onAddApp(): void {
    this.facade.clearError();
    this.appToEdit = null;
    this.form = emptyForm();
    this.scopeSearch.set('');
    this.formModalOpen.set(true);
  }

  onEditApp(app: IdentityAppResponseDto): void {
    this.facade.clearError();
    this.appToEdit = app;
    this.form = {
      name: app.name,
      description: app.description ?? '',
      returnUrl: app.returnUrl,
      scopes: [...app.scopes],
    };
    this.scopeSearch.set('');
    this.formModalOpen.set(true);
  }

  onSubmitForm(): void {
    if (!this.isFormValid()) {
      return;
    }

    const dto: IdentityAppInputDto = {
      name: this.form.name.trim(),
      returnUrl: this.form.returnUrl.trim(),
      scopes: [...this.form.scopes],
    };

    if (this.form.description.trim()) {
      dto.description = this.form.description.trim();
    }

    if (this.appToEdit) {
      this.facade.update(this.appToEdit.id, dto);
    } else {
      this.facade.create(dto);
    }
  }

  cancelForm(): void {
    this.formModalOpen.set(false);
    this.appToEdit = null;
  }

  onSecretDone(): void {
    this.facade.clearSecret();
    this.secretModalOpen.set(false);
    this.secretApp.set(null);
    this.copied.set(null);
  }

  toggleScope(scope: string, checked: boolean): void {
    this.form.scopes = checked
      ? [...new Set([...this.form.scopes, scope])]
      : this.form.scopes.filter((item) => item !== scope);
  }

  isScopeSelected(scope: string): boolean {
    return this.form.scopes.includes(scope);
  }

  selectedScopeCount(): number {
    return this.scopes().filter((item) => this.form.scopes.includes(item.scope)).length;
  }

  areAllScopesSelected(): boolean {
    const visible = this.filteredScopes();

    return visible.length > 0 && visible.every((item) => this.form.scopes.includes(item.scope));
  }

  areSomeScopesSelected(): boolean {
    const visible = this.filteredScopes();
    const count = visible.filter((item) => this.form.scopes.includes(item.scope)).length;

    return count > 0 && count < visible.length;
  }

  /** Selects or clears the scopes currently shown by the search filter. */
  toggleAllScopes(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const visible = this.filteredScopes().map((item) => item.scope);

    this.form.scopes = checked
      ? [...new Set([...this.form.scopes, ...visible])]
      : this.form.scopes.filter((item) => !visible.includes(item));
  }

  isReturnUrlInvalid(): boolean {
    return !!this.form.returnUrl.trim() && !isValidAppReturnUrl(this.form.returnUrl);
  }

  isFormValid(): boolean {
    return this.form.name.trim().length > 0 && isValidAppReturnUrl(this.form.returnUrl) && this.form.scopes.length > 0;
  }

  scopesText(scopes: readonly string[]): string {
    return scopes.join('\n');
  }

  async copy(kind: 'id' | 'secret', value: string | null | undefined): Promise<void> {
    if (!value || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(kind);
    } catch {
      this.copied.set(null);
    }
  }

  onAppAction(app: IdentityAppResponseDto, action: string): void {
    switch (action) {
      case 'edit':
        this.onEditApp(app);
        break;
      case 'grants':
        this.onShowGrants(app);
        break;
      case 'rotate':
        this.activeApp.set(app);
        this.rotateDialogOpen.set(true);
        break;
      case 'copy-id':
        fpcCopyText(app.id);
        break;
      case 'delete':
        this.activeApp.set(app);
        this.deleteDialogOpen.set(true);
        break;
    }
  }

  confirmRotate(): void {
    const app = this.activeApp();

    this.rotateDialogOpen.set(false);

    if (app) {
      this.facade.rotateSecret(app.id);
    }
  }

  confirmDelete(): void {
    const app = this.activeApp();

    this.deleteDialogOpen.set(false);

    if (app) {
      this.facade.remove(app.id);
      this.activeApp.set(null);
    }
  }

  onShowGrants(app: IdentityAppResponseDto): void {
    this.activeApp.set(app);
    this.facade.loadGrants(app.id);
    this.grantsModalOpen.set(true);
  }

  onRefreshGrants(): void {
    const app = this.activeApp();

    if (app) {
      this.facade.loadGrants(app.id);
    }
  }

  onGrantAction(grant: IdentityAppGrantResponseDto, action: string): void {
    if (action === 'revoke') {
      this.grantToRevoke = grant;
      this.revokeGrantDialogOpen.set(true);
    }
  }

  confirmRevokeGrant(): void {
    const app = this.activeApp();

    this.revokeGrantDialogOpen.set(false);

    if (app && this.grantToRevoke) {
      this.facade.revokeGrant(app.id, this.grantToRevoke.id);
    }

    this.grantToRevoke = null;
  }

  confirmRevokeAll(): void {
    const app = this.activeApp();

    this.revokeAllDialogOpen.set(false);

    if (app) {
      this.facade.revokeAllGrants(app.id);
    }
  }

  /** Bulk delete: one call per selected app (the server checks each), per-app result. */
  async onConfirmBulkDelete(): Promise<void> {
    this.bulkDeleteOpen.set(false);
    const apps = this.selectedApps();

    if (apps.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(apps, (app) => firstValueFrom(this.authService.deleteApp(app.id)));

      this.bulkResult.set(sharedBulkSummary(result, (app) => app.name));
      this.selectedAppIds.set(result.failed.concat(result.denied).map((app) => app.id));
      this.facade.load();
    } finally {
      this.bulkBusy.set(false);
    }
  }
}
