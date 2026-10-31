import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  IDENTITY_AUTH_ENVIRONMENT,
  IdentityLogoutConfirmModalComponent,
} from '@forepath/identity/frontend';
import {
  backendMessageLabel,
  ConsoleAccessFacade,
  ConsoleFleetFacade,
  FleetClusterAvailabilityService,
  type FleetAvailability,
  type FleetCluster,
} from '@forepath/loadweaver/frontend/data-access-console';
import { ENVIRONMENT, LocaleService } from '@forepath/loadweaver/frontend/util-configuration';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcLanguageSwitcherComponent,
  FpcNotificationIndicatorComponent,
  FpcSectionContainerComponent,
  FpcSidebarComponent,
  FpcSidebarPopoverComponent,
  FpcSpinnerComponent,
  FpcThemeSwitcherComponent,
  FpcTopBarComponent,
} from '@forepath/shared/frontend/ui-components';
import { AdminUpdatesFacade } from '@forepath/shared/frontend/data-access-updates';
import { combineLatest, distinctUntilChanged, filter, map, pairwise, skip } from 'rxjs';

import { type ConsoleNavItem } from '../console-nav';
import { CREATE_KINDS } from '../nav/create-kinds';
import { LoadweaverResourceModalComponent } from '../objects/resource-modal.component';
import { createProjectFromUrl, ResourceModalService } from '../objects/resource-modal.service';
import { mayCreateResources } from '../workspace/workspace-actions';
import { consoleShortcut, isTypingTarget, type ConsoleShortcut } from '../nav/shortcuts';
import { ConsoleNavService } from '../nav/console-nav.service';
import { ConsoleSettingsService } from '../nav/console-settings.service';
import { LoadweaverDraftTrayComponent } from '../nav/draft-tray.component';
import { LoadweaverShortcutHelpComponent } from '../nav/shortcut-help.component';
import { LoadweaverTaskDockComponent } from '../nav/task-dock.component';
import { ConsoleTaskFeedService } from '../nav/task-feed.service';
import { LoadweaverSearchPaletteComponent } from '../search/search-palette.component';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import { ThemeService } from '../theme.service';

/** Routes without the console chrome (sign-in and friends). */
export const BARE_ROUTES = [
  '/login',
  '/register',
  '/request-password-reset',
  '/request-password-reset-confirmation',
  '/reset-password',
  '/confirm-email',
  '/login-2fa',
  // The wallboard kiosk (3.25): no login, full screen.
  '/kiosk',
];

/** Pages shown without the console's chrome (sign-in flows, the kiosk); the locale prefix is ignored. */
export function isBareRoute(url: string): boolean {
  const path = url.split('?')[0].replace(/^\/(de|en)(?=\/|$)/, '');

  return BARE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * The console shell (3.16): top bar (search, Create, draft, running tasks, security, language, theme, logout), the
 * function rail for the caller's role (project members don't get infrastructure views), Account / Admin popovers in its
 * footer. Phones use the same rail and popovers (the shared Agenstra / Decabill navigation, 2026-10-29).
 */
/** How long the armed Fleet tile waits for the confirming second click. */
const LEAVE_CONFIRM_MS = 3000;

@Component({
  selector: 'loadweaver-console-container',
  imports: [
    CommonModule,
    RouterModule,
    IdentityLogoutConfirmModalComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcLanguageSwitcherComponent,
    FpcNotificationIndicatorComponent,
    FpcSectionContainerComponent,
    FpcSidebarComponent,
    FpcSidebarPopoverComponent,
    FpcSpinnerComponent,
    FpcThemeSwitcherComponent,
    FpcTopBarComponent,
    LoadweaverSearchPaletteComponent,
    LoadweaverDraftTrayComponent,
    LoadweaverTaskDockComponent,
    LoadweaverShortcutHelpComponent,
    LoadweaverResourceModalComponent,
  ],
  styleUrls: ['./container.component.scss'],
  // The draft is app-wide (3.37 P3): the tray, the Spec tabs, wizards, tree / table / map share one store.
  providers: [WorkspaceDraftStore],
  templateUrl: './container.component.html',
  standalone: true,
})
export class LoadweaverConsoleContainerComponent implements OnInit {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly fleet = inject(ConsoleFleetFacade);
  private readonly availability = inject(FleetClusterAvailabilityService);
  private readonly adminUpdatesFacade = inject(AdminUpdatesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly draft = inject(WorkspaceDraftStore);
  /** The task dock's feed (3.37 P4): running badge + dock. */
  readonly tasks = inject(ConsoleTaskFeedService);
  private readonly infrastructure = toSignal(inject(ConsoleAccessFacade).seesInfrastructure$, { initialValue: false });
  private readonly resourceModal = inject(ResourceModalService);
  private readonly me = toSignal(inject(ConsoleAccessFacade).me$, { initialValue: null });
  /** Create ▾ only for callers who may draft a resource somewhere (a cluster role or developer+ in a project). */
  readonly mayCreate = computed(() =>
    mayCreateResources({
      clusterRole: this.me()?.clusterRole ?? null,
      projects: this.me()?.projects ?? {},
      fleetMode: this.fleetMode,
    }),
  );
  private readonly authEnvironment = inject(IDENTITY_AUTH_ENVIRONMENT);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);
  protected readonly productName = inject(ENVIRONMENT).application.productName;

  readonly languageSwitcherAriaLabel = $localize`:@@lwConsoleContainer-languageSwitcherAriaLabel:Select language`;
  readonly toggleDarkModeTitle = $localize`:@@lwConsoleContainer-toggleDarkMode:Toggle dark mode`;
  readonly sidebarAriaLabel = $localize`:@@lwConsoleContainer-sidebarAriaLabel:Main navigation`;
  readonly adminPopoverAriaLabel = $localize`:@@lwConsoleContainer-adminTitle:Admin`;
  readonly accountPopoverAriaLabel = $localize`:@@lwConsoleNav-groupAccountTitle:Your account: tokens and linked Git accounts`;
  readonly backToFleetTitle = $localize`:@@lwConsoleContainer-fleetLevelTitle:Fleet: overview, clusters, compare, operations, audit`;
  readonly clusterLabel = $localize`:@@lwConsoleContainer-clusterSection:Cluster`;
  readonly logoutLabel = $localize`:@@lwConsoleContainer-logout:Logout`;
  /** Two-step "leave cluster" (Fleet tile confirm, 2026-10-28). */
  readonly leaveConfirmLabel = $localize`:@@lwConsoleContainer-fleetLevelConfirm:Confirm`;
  readonly leaveConfirmTitle = $localize`:@@lwConsoleContainer-fleetLevelConfirmTitle:Click again to leave the cluster`;
  readonly emailNotConfiguredMessage = $localize`:@@lwConsoleContainer-emailNotConfigured:Email is not configured — two-factor login is not enforced. Configure SMTP to enable it.`;

  /** Fleet mode (3.24): the console works on the fleet and, through its relay, on the active cluster. */
  readonly fleetMode = this.fleet.fleetMode;
  readonly activeClusterId = this.fleet.activeClusterId;
  private readonly activeCluster$ = toObservable(this.fleet.activeClusterId);
  /** Fleet mode with an open cluster: "Back" and a "Cluster" label above the cluster's views. */
  readonly showClusterSection = computed(() => this.fleetMode && !!this.activeClusterId());
  /**
   * The open fleet cluster while changes to it are paused (3.43, 2026-10-31): unreachable or read-only. A banner on
   * every cluster page; the access is capped meanwhile (buttons disabled) and the write guard refuses what is left.
   */
  readonly clusterPaused = computed(() => (this.showClusterSection() ? this.availability.paused() : null));
  private readonly availabilityState$ = toObservable(
    computed(() => ({ clusterId: this.activeClusterId(), state: this.availability.availability()?.state ?? null })),
  );
  readonly pausedUnreachableHeading = $localize`:@@lwConsoleContainer-clusterUnreachableHeading:Cluster unreachable`;
  readonly pausedReadOnlyHeading = $localize`:@@lwConsoleContainer-clusterReadOnlyHeading:Cluster read-only`;
  private readonly fleetClusters = toSignal(this.fleet.clusters$, { initialValue: [] as FleetCluster[] });
  /** The open fleet cluster's name (rail heading, 3.37 P7). */
  readonly activeClusterName = computed(
    () => this.fleetClusters().find((c) => c.id === this.activeClusterId())?.name ?? null,
  );

  readonly isUsersAuth = this.authEnvironment.authentication.type === 'users';
  readonly isPatUiEnabled =
    this.authEnvironment.authentication.type === 'users' || this.authEnvironment.authentication.type === 'keycloak';

  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;
  /**
   * Cluster admins: forced email login 2FA is not enforced while SMTP isn't configured (the control plane reports it
   * on `GET /access/me`).
   */
  readonly showEmailNotConfiguredBanner$ = combineLatest([this.access.me$, this.access.isClusterAdmin$]).pipe(
    map(([me, clusterAdmin]) => clusterAdmin && me?.emailLogin2faSuspended === true),
  );
  readonly showSecurityAuthenticatorBadge$ = this.authenticationFacade.twoFactorStatus$.pipe(
    map((status) => status != null && !status.totpEnabled),
  );

  /** Rail, footer popovers and the active entry (3.37). */
  protected readonly navigation = inject(ConsoleNavService);
  private readonly url = this.navigation.url;
  private readonly globalAdmin$ = this.navigation.globalAdmin$;

  /** The rail: the cluster's sections (or the fleet's pages at the fleet root), one click per tile. */
  readonly rail = this.navigation.rail;
  readonly adminNavItems = this.navigation.adminItems;
  readonly accountNavItems = this.navigation.accountItems;
  readonly activePath = this.navigation.activePath;

  /** Per-user settings (resource tree view / favourites), stored with the saved views; density is fixed compact. */
  protected readonly settings = inject(ConsoleSettingsService);
  readonly searchLabel = $localize`:@@lwConsoleContainer-searchPlaceholder:Search`;
  readonly runningTitle = $localize`:@@lwConsoleContainer-running:Running tasks (show the task panel)`;

  /** "Create" in the top bar: typed creation per kind (the wizards replace the editor in a later phase). */
  readonly createKinds = CREATE_KINDS;

  /** The shared updates feature has something for global admins (badge on Admin and its Updates item). */
  readonly updatesAttentionBadge$ = combineLatest([this.globalAdmin$, this.adminUpdatesFacade.hasAttention$]).pipe(
    map(([globalAdmin, attention]) => globalAdmin && !!attention),
  );

  /** The open footer popover (`account` or `admin`); only one at a time. */
  readonly openPopover = signal<string | null>(null);

  @ViewChild(IdentityLogoutConfirmModalComponent)
  private logoutConfirmModal?: IdentityLogoutConfirmModalComponent;

  showChrome(): boolean {
    return !isBareRoute(this.url());
  }

  isAdminRouteActive(): boolean {
    const active = this.activePath();

    return this.adminNavItems().some((item) => item.path === active);
  }

  isAccountRouteActive(): boolean {
    const active = this.activePath();

    return this.accountNavItems().some((item) => item.path === active);
  }

  isTileActive(tile: { items: ConsoleNavItem[] }): boolean {
    const active = this.activePath();

    return tile.items.some((item) => item.path === active);
  }

  /** Popover state from the component (trigger click, outside click, Escape); stale closes of others are ignored. */
  onPopoverOpenChange(id: string, open: boolean): void {
    if (open) this.openPopover.set(id);
    else if (this.openPopover() === id) this.openPopover.set(null);
  }

  /** Enter / Space on a trigger (the popover component only listens for clicks). */
  onPopoverTriggerKey(id: string, event: Event): void {
    event.preventDefault();
    this.openPopover.set(this.openPopover() === id ? null : id);
  }

  /**
   * Top bar "Create" — the one create entry for resources (2026-10-29): opens the create modal for `kind` (null =
   * choose the kind in its first step), in the project of the current page if there is one.
   */
  openCreate(kind: string | null): void {
    this.resourceModal.openCreate(kind, createProjectFromUrl(this.router.url));
  }

  /** The `?` shortcut overlay (3.37). */
  readonly shortcutHelpOpen = signal(false);
  readonly shortcutHelpLabel = $localize`:@@lwConsoleShortcuts-title:Keyboard shortcuts`;

  /** Keys typed so far for a two-key shortcut (`g r`). */
  private shortcutPrefix: string | null = null;

  /** Global shortcuts (3.37): `/` search, `?` help, `` ` `` dock, `[` tree, `g r|a|o|p|d|c` sections; not while typing. */
  onShortcutKey(event: KeyboardEvent, palette: { show(): void }): void {
    if (!this.showChrome() || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;

    const shortcut: ConsoleShortcut | null = consoleShortcut(this.shortcutPrefix, event.key);

    this.shortcutPrefix = shortcut?.kind === 'prefix' ? shortcut.prefix : null;

    if (!shortcut || shortcut.kind === 'prefix') return;

    event.preventDefault();

    if (shortcut.kind === 'search') palette.show();
    else if (shortcut.kind === 'tasks') this.tasks.open.set(!this.tasks.open());
    else if (shortcut.kind === 'tree') this.navigation.toggleTree();
    else if (shortcut.kind === 'help') this.shortcutHelpOpen.set(!this.shortcutHelpOpen());
    else {
      const tile = this.rail().find((candidate) => candidate.section === shortcut.section);

      if (tile) void this.router.navigateByUrl(tile.path);
    }
  }

  closePopover(): void {
    this.openPopover.set(null);
  }

  /** Locales are separate builds: switching needs a full document load. */
  onLocaleChange(localeCode: string | null): void {
    if (localeCode) window.location.href = this.localeService.getLanguageSwitchUrl(localeCode);
  }

  ngOnInit(): void {
    this.authenticationFacade.checkAuthentication();
    this.authenticationFacade.isAuthenticated$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) => {
        if (isAuthenticated) {
          this.access.load();
          // Console settings are a saved view of the cluster: none at the fleet level (a cluster switch loads them).
          if (!this.fleetMode || this.activeClusterId()) this.settings.load();
          // Fleet mode: the cluster names (top-bar chip, sidebar label) on every first page, not only the tree's.
          if (this.fleetMode) this.fleet.loadClusters();
          // Fleet mode: unreachable / read-only of the open cluster (3.43): banner, capped access, write guard.
          if (this.fleetMode) this.availability.start();
          // Fleet mode: the drafts are the active cluster's (none at the fleet level; a cluster switch reloads them).
          if (!this.fleetMode || this.activeClusterId()) void this.draft.connect();
          this.tasks.start(() => this.infrastructure());

          if (this.isUsersAuth) this.authenticationFacade.loadTwoFactorStatus();
        } else {
          this.access.clear();
          this.availability.stop();
          this.draft.disconnect();
          this.tasks.stop();
        }
      });
    this.watchDraftParam();
    this.watchUpdatesAttention();
    this.watchActiveCluster();
    this.watchClusterAvailability();
  }

  /** The banner text for a paused cluster (3.43). */
  pausedMessage(paused: FleetAvailability): string {
    if (paused.state === 'unreachable') {
      const base = $localize`:@@lwConsoleContainer-clusterUnreachable:The fleet can't reach this cluster. Changes are paused until it answers again; what you see is from its last answer.`;

      return paused.reason ? `${base} (${paused.reason})` : base;
    }

    const reason = paused.reason ? backendMessageLabel(paused.reason) : '';
    const base = $localize`:@@lwConsoleContainer-clusterReadOnly:This cluster is read-only: its control plane can't write to its database. Changes are paused until it can write again.`;

    return reason ? `${base} ${reason}` : base;
  }

  /**
   * Fleet mode (3.43): the open cluster's availability is re-read while signed in (see `ngOnInit`); the access is
   * reloaded when it flips (the caps follow: buttons come back once the cluster can write again).
   */
  private watchClusterAvailability(): void {
    if (!this.fleetMode) return;

    this.destroyRef.onDestroy(() => this.availability.stop());
    this.availabilityState$
      .pipe(
        pairwise(),
        // Only a change of a known state on the same cluster (a cluster switch loads the access anyway).
        filter(
          ([previous, current]) =>
            previous.clusterId === current.clusterId &&
            previous.state !== null &&
            current.state !== null &&
            (previous.state === 'reachable') !== (current.state === 'reachable'),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.access.load());
  }

  /** `?draft=<id>` on any page opens that draft in the tray (shared links, "Show on map"). */
  private watchDraftParam(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map((event) => this.router.parseUrl(event.urlAfterRedirects).queryParams['draft'] as string | undefined),
        filter((id): id is string => !!id),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((id) => {
        if (this.draft.active()?.id !== id) void this.draft.open(id);
      });
  }

  /** Fleet mode: the access (fleet grant) of the newly active cluster after every switch. */
  private watchActiveCluster(): void {
    if (!this.fleetMode) return;

    combineLatest([this.activeCluster$, this.authenticationFacade.isAuthenticated$])
      .pipe(
        filter(([, isAuthenticated]) => isAuthenticated),
        map(([clusterId]) => clusterId),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((clusterId) => {
        this.access.load();
        // The open drafts (and their live socket) belong to the cluster: re-read them for the new one.
        this.draft.disconnect();
        this.draft.drafts.set([]);

        if (clusterId) {
          void this.draft.connect();
          this.settings.load();
        }
      });
  }

  /**
   * The sidebar's "Back": closes the cluster and opens the fleet (clusters are opened from the fleet's overview,
   * cluster list and cluster pages).
   */
  /** The fleet level tile (its `routerLink` opens `/fleet`): the fleet level has no active cluster. */
  leaveCluster(): void {
    this.fleet.leaveCluster();
  }

  /**
   * The Fleet tile leaves the open cluster in two steps (it was clicked by accident too often): the first click arms
   * it (danger tile, "Confirm"), a second click within {@link LEAVE_CONFIRM_MS} leaves; otherwise it reverts (also on
   * blur, Escape and route change).
   */
  readonly leaveConfirmArmed = signal(false);
  private leaveConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly leaveConfirmReset = effect(() => {
    this.url();
    untracked(() => this.cancelLeaveConfirm());
  });
  private readonly leaveConfirmCleanup = this.destroyRef.onDestroy(() => this.clearLeaveConfirmTimer());

  onFleetTileClick(): void {
    if (!this.leaveConfirmArmed()) {
      this.leaveConfirmArmed.set(true);
      this.clearLeaveConfirmTimer();
      this.leaveConfirmTimer = setTimeout(() => this.cancelLeaveConfirm(), LEAVE_CONFIRM_MS);

      return;
    }

    this.cancelLeaveConfirm();
    this.leaveCluster();
    void this.router.navigateByUrl('/fleet');
  }

  cancelLeaveConfirm(): void {
    this.clearLeaveConfirmTimer();
    if (this.leaveConfirmArmed()) this.leaveConfirmArmed.set(false);
  }

  private clearLeaveConfirmTimer(): void {
    if (this.leaveConfirmTimer !== null) {
      clearTimeout(this.leaveConfirmTimer);
      this.leaveConfirmTimer = null;
    }
  }

  private watchUpdatesAttention(): void {
    combineLatest([this.authenticationFacade.isAuthenticated$, this.globalAdmin$, this.activeCluster$])
      .pipe(
        // The announcements status is the cluster's: in fleet mode only once a cluster is open.
        map(
          ([isAuthenticated, globalAdmin, clusterId]) =>
            isAuthenticated && globalAdmin && (!this.fleetMode || clusterId !== null),
        ),
        distinctUntilChanged(),
        filter(Boolean),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.adminUpdatesFacade.loadStatus());
  }

  onLogoutClick(): void {
    this.logoutConfirmModal?.open();
  }

  onLogoutConfirmed(result: { invalidateAllSessions: boolean }): void {
    this.authenticationFacade.logout(result.invalidateAllSessions);
  }
}
