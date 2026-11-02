import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  apiErrorMessage,
  type AppCatalog,
  AppStoreService,
  type AppSummary,
  APP_TRUST_LABELS,
  ConsoleAccessFacade,
  type InstalledApp,
  type TrustLabel,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  fpcListQueryState,
  type FpcMenuItem,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';

import { resourceObjectRoute } from '../objects/object-route';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { LoadweaverAppTrustBadgeComponent } from './app-trust-badge.component';
import { LoadweaverAppUninstallModalComponent } from './app-uninstall-modal.component';
import { LoadweaverAppUpdateModalComponent } from './app-update-modal.component';
import {
  appCategories,
  appKey,
  appLink,
  appRoute,
  catalogOptions,
  filterApps,
  catalogUnavailable,
  hasUpdate,
  installedKey,
  isTakenDown,
  latestUpdate,
  mayManageCatalogs,
  mayPlanApp,
  notInstallableText,
  trustText,
} from './apps-format';

type AppsLane = 'store' | 'installed';

/**
 * Delivery › Apps (P1): the store of the cluster's enabled catalogs (search, catalog / trust / category filters, trust
 * badges; whole-app takedowns hidden, deprecated apps marked) beside the installed apps (version, channel, update
 * available, takedown warning; Update / Uninstall as plans). Works the same natively and through the fleet relay.
 * `?project=` (Create ▾ "Install app", project pages) is carried to the app page, where Install pre-selects it.
 */
@Component({
  selector: 'loadweaver-apps-page',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverAppTrustBadgeComponent,
    LoadweaverAppUninstallModalComponent,
    LoadweaverAppUpdateModalComponent,
    LoadweaverLaneComponent,
  ],
  templateUrl: './apps-page.component.html',
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverAppsPageComponent implements OnInit {
  private readonly api = inject(AppStoreService);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly me = toSignal(this.access.me$, { initialValue: null });
  /** The project a Create ▾ / project-page "Install app" started in. */
  readonly project = signal<string | null>(this.route.snapshot.queryParamMap.get('project'));

  readonly catalogs = signal<AppCatalog[]>([]);
  readonly apps = signal<AppSummary[]>([]);
  readonly installed = signal<InstalledApp[]>([]);
  readonly loading = signal(true);
  readonly installedLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly installedError = signal<string | null>(null);
  readonly refreshing = signal(false);
  readonly notice = signal<{ tone: 'success' | 'danger'; message: string } | null>(null);

  /** `apps/installed/:project/:deployment` (inbox takedown links): the installation to show on the Installed lane. */
  readonly focusedInstall = signal<string | null>(this.focusedInstallFromRoute());
  readonly lane = signal<AppsLane>(this.focusedInstall() ? 'installed' : 'store');
  readonly search = signal('');
  readonly catalog = signal('');
  readonly trust = signal<TrustLabel | ''>('');
  readonly category = signal('');
  readonly filtersOpen = signal(false);
  readonly filterState = fpcListQueryState({
    filters: { catalog: this.catalog, trust: this.trust, category: this.category },
    search: this.search,
    open: this.filtersOpen,
  });
  /** Pre-filled with the focused installation so its row is on the first page. */
  readonly installedSearch = signal(this.focusedInstallSearch());

  readonly updateFor = signal<InstalledApp | null>(null);
  readonly uninstallFor = signal<InstalledApp | null>(null);

  readonly canManageCatalogs = computed(() => mayManageCatalogs(this.me()));
  readonly catalogNames = computed(() => catalogOptions(this.catalogs(), this.apps()));
  readonly categories = computed(() => appCategories(this.apps()));
  readonly trustLabels = APP_TRUST_LABELS;
  readonly visibleApps = computed(() =>
    filterApps(this.apps(), {
      q: this.search(),
      catalog: this.catalog(),
      trust: this.trust(),
      category: this.category(),
    }),
  );
  readonly visibleInstalled = computed(() => {
    const terms = this.installedSearch().trim().toLowerCase().split(/\s+/).filter(Boolean);

    return this.installed().filter((i) => {
      const text = [i.title ?? '', i.app.name, i.app.catalog, i.project, i.deployment, i.app.version, i.app.channel]
        .join(' ')
        .toLowerCase();

      return terms.every((t) => text.includes(t));
    });
  });
  /** Catalogs whose last refresh failed (shown above the store). */
  readonly failingCatalogs = computed(() => this.catalogs().filter((c) => c.enabled && c.error));
  readonly noCatalogEnabled = computed(() => !this.loading() && !this.catalogs().some((c) => c.enabled));
  readonly updatesCount = computed(() => this.installed().filter(hasUpdate).length);

  readonly title = $localize`:@@lwConsoleApps-title:Apps`;
  readonly storeTitle = $localize`:@@lwConsoleApps-store:Store`;
  readonly installedTitle = $localize`:@@lwConsoleApps-installed:Installed apps`;
  readonly searchLabel = $localize`:@@lwConsoleApps-search:Search apps`;
  readonly searchInstalledLabel = $localize`:@@lwConsoleApps-searchInstalled:Search installed apps`;
  readonly refreshLabel = $localize`:@@lwConsoleApps-reload:Reload`;
  readonly refreshCatalogsLabel = $localize`:@@lwConsoleApps-refreshCatalogs:Refresh catalogs`;
  readonly catalogSettingsLabel = $localize`:@@lwConsoleApps-catalogSettings:Catalog sources (Setup)`;
  readonly catalogLabel = $localize`:@@lwConsoleApps-catalog:Catalog`;
  readonly trustLabel = $localize`:@@lwConsoleApps-trust:Trust label`;
  readonly categoryLabel = $localize`:@@lwConsoleApps-category:Category`;
  readonly allLabel = $localize`:@@lwConsoleApps-all:All`;
  readonly deprecatedLabel = $localize`:@@lwConsoleApps-deprecated:Deprecated`;
  readonly notInstallableBadge = $localize`:@@lwConsoleApps-notInstallableBadge:Not installable`;
  /** The reason (trust label / `minLoadweaver`), as the badge's tooltip. */
  readonly notInstallableText = notInstallableText;
  readonly updateBadge = $localize`:@@lwConsoleApps-updateAvailable:Update available`;
  readonly takenDownBadge = $localize`:@@lwConsoleApps-takenDown:Taken down`;
  readonly catalogMissingBadge = $localize`:@@lwConsoleApps-catalogMissing:Catalog unavailable`;
  readonly refreshedLabel = $localize`:@@lwConsoleApps-refreshed:Catalogs refreshed.`;
  readonly refreshFailedLabel = $localize`:@@lwConsoleApps-refreshFailed:The catalogs couldn't be refreshed.`;
  readonly loadFailedLabel = $localize`:@@lwConsoleApps-loadFailed:The app store couldn't be loaded.`;
  readonly installedFailedLabel = $localize`:@@lwConsoleApps-installedFailed:The installed apps couldn't be loaded.`;
  readonly noCatalogLabel = $localize`:@@lwConsoleApps-noCatalog:No catalog is enabled. Cluster admins enable catalog sources under Setup.`;
  readonly catalogErrorLabel = $localize`:@@lwConsoleApps-catalogError:Catalog`;
  readonly openAppLabel = $localize`:@@lwConsoleApps-openApp:Open app page`;
  readonly openDeploymentLabel = $localize`:@@lwConsoleApps-openDeployment:Open deployment`;
  readonly updateLabel = $localize`:@@lwConsoleApps-update:Update`;
  readonly uninstallLabel = $localize`:@@lwConsoleApps-uninstall:Uninstall`;

  readonly appRowId = (app: AppSummary) => appKey(app);
  readonly installedRowId = (app: InstalledApp) => installedKey(app);
  readonly appRowLink = (app: AppSummary): string => {
    const project = this.project();

    return project ? `${appLink(app)}?project=${encodeURIComponent(project)}` : appLink(app);
  };
  readonly trustText = trustText;
  readonly hasUpdate = hasUpdate;
  readonly isTakenDown = isTakenDown;
  readonly latestUpdate = latestUpdate;

  readonly storeColumns: FpcTableColumn<AppSummary>[] = [
    {
      id: 'app',
      label: $localize`:@@lwConsoleApps-colApp:App`,
      value: (a) => a.title,
      required: true,
      priority: 1,
    },
    { id: 'trust', label: this.trustLabel, value: (a) => trustText(a.trust) },
    { id: 'publisher', label: $localize`:@@lwConsoleApps-colPublisher:Publisher`, value: (a) => a.publisher },
    { id: 'catalog', label: this.catalogLabel, value: (a) => a.catalog, mono: true, priority: 3 },
    {
      id: 'latest',
      label: $localize`:@@lwConsoleApps-colLatest:Latest`,
      value: (a) => a.latest?.version ?? '',
      mono: true,
      priority: 3,
    },
  ];
  readonly installedColumns: FpcTableColumn<InstalledApp>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleApps-colState:State`,
      type: 'state',
      state: (a) => this.installedState(a),
    },
    {
      id: 'app',
      label: $localize`:@@lwConsoleApps-colApp:App`,
      value: (a) => a.title ?? a.app.name,
      required: true,
      priority: 1,
    },
    {
      id: 'deployment',
      label: $localize`:@@lwConsoleApps-colDeployment:Deployment`,
      value: (a) => `${a.project}/${a.deployment}`,
      mono: true,
    },
    {
      id: 'version',
      label: $localize`:@@lwConsoleApps-colVersion:Version`,
      value: (a) => a.app.version,
      mono: true,
    },
    {
      id: 'channel',
      label: $localize`:@@lwConsoleApps-colChannel:Channel`,
      value: (a) => a.app.channel,
      priority: 3,
    },
  ];

  readonly installedMenu = (app: InstalledApp): FpcMenuItem[] => {
    const may = mayPlanApp(this.me(), app.project);

    return [
      { id: 'app', label: this.openAppLabel, icon: 'grid-3x3-gap' },
      { id: 'deployment', label: this.openDeploymentLabel, icon: 'box-seam' },
      ...(may && hasUpdate(app) && !catalogUnavailable(app)
        ? [{ id: 'update', label: this.updateLabel, icon: 'arrow-up-circle', dividerBefore: true }]
        : []),
      ...(may ? [{ id: 'uninstall', label: this.uninstallLabel, icon: 'trash', danger: true }] : []),
    ];
  };

  ngOnInit(): void {
    this.access.load();
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.catalogs().subscribe({
      next: (response) => this.catalogs.set(response.catalogs),
      error: () => this.catalogs.set([]),
    });
    this.api.apps().subscribe({
      next: (apps) => {
        this.apps.set(apps);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e, this.loadFailedLabel));
        this.loading.set(false);
      },
    });
    this.reloadInstalled();
  }

  reloadInstalled(): void {
    this.installedLoading.set(true);
    this.installedError.set(null);
    this.api.installed().subscribe({
      next: (installed) => {
        this.installed.set(installed);
        this.installedLoading.set(false);
      },
      error: (e: unknown) => {
        this.installedError.set(apiErrorMessage(e, this.installedFailedLabel));
        this.installedLoading.set(false);
      },
    });
  }

  /** Cluster admins: re-read and verify every enabled catalog, then the store. */
  refreshCatalogs(): void {
    if (!this.canManageCatalogs() || this.refreshing()) return;

    this.refreshing.set(true);
    this.api.refreshCatalogs().subscribe({
      next: (catalogs) => {
        this.refreshing.set(false);
        this.catalogs.set(catalogs.length ? catalogs : this.catalogs());
        this.notice.set({ tone: 'success', message: this.refreshedLabel });
        this.reload();
      },
      error: (e: unknown) => {
        this.refreshing.set(false);
        this.notice.set({ tone: 'danger', message: apiErrorMessage(e, this.refreshFailedLabel) });
      },
    });
  }

  openSetup(): void {
    void this.router.navigate(['/setup']);
  }

  onInstalledAction(app: InstalledApp, action: string): void {
    switch (action) {
      case 'app':
        void this.router.navigate(appRoute({ catalog: app.app.catalog, name: app.app.name }));
        break;
      case 'deployment':
        void this.router.navigate(
          resourceObjectRoute({ kind: 'Deployment', name: app.deployment, project: app.project }),
        );
        break;
      case 'update':
        this.updateFor.set(app);
        break;
      case 'uninstall':
        this.uninstallFor.set(app);
        break;
    }
  }

  onUpdateOpenChange(open: boolean): void {
    if (!open) this.updateFor.set(null);
  }

  onUninstallOpenChange(open: boolean): void {
    if (!open) this.uninstallFor.set(null);
  }

  private focusedInstallFromRoute(): string | null {
    const params = this.route.snapshot.paramMap;
    const project = params.get('project');
    const deployment = params.get('deployment');

    return project && deployment ? installedKey({ project, deployment }) : null;
  }

  private focusedInstallSearch(): string {
    const params = this.route.snapshot.paramMap;

    return this.focusedInstall() ? `${params.get('project')} ${params.get('deployment')}` : '';
  }

  private installedState(app: InstalledApp): FpcTableState {
    if (isTakenDown(app)) return { label: this.takenDownBadge, tone: 'danger' };

    if (hasUpdate(app)) return { label: this.updateBadge, tone: 'warning' };

    if (catalogUnavailable(app)) return { label: this.catalogMissingBadge, tone: 'neutral' };

    return { label: $localize`:@@lwConsoleApps-upToDate:Up to date`, tone: 'success' };
  }
}
