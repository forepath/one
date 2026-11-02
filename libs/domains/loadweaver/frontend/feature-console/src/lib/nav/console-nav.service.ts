import { computed, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { AuthenticationFacade, IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
import { ConsoleAccessFacade, ConsoleFleetFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { combineLatest, filter, map, startWith } from 'rxjs';

import {
  activeConsoleNavPath,
  CONSOLE_ACCOUNT_NAV_ITEMS,
  CONSOLE_ADMIN_NAV_ITEMS,
  CONSOLE_SECTIONS,
  type ConsoleNavContext,
  type ConsoleNavItem,
  type ConsoleRailTile,
  type ConsoleSection,
  type ConsoleSectionId,
  consoleNavItemVisible,
  FLEET_NAV_ITEMS,
  fleetClusterSections,
  fleetRail,
  sectionForUrl,
  visibleConsoleRail,
  visibleSectionItems,
} from '../console-nav';
import { FLEET_ADMIN_ONLY_PATHS, FLEET_UNAVAILABLE_PATHS, fleetCompareAvailable } from '../fleet/fleet-format';
import { isGlobalAdmin } from '../guards/global-admin.guard';

/**
 * The console's navigation state (3.37), shared by the shell (rail, footer popovers) and the section pages (their
 * vertical sub-nav): what the caller may see, per mode (single cluster, fleet root, fleet cluster).
 */
/** Provided by the console routes, next to the facades it reads (they are route-scoped). */
@Injectable()
export class ConsoleNavService {
  private readonly auth = inject(AuthenticationFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly fleet = inject(ConsoleFleetFacade);
  private readonly router = inject(Router);
  private readonly authType = inject(IDENTITY_AUTH_ENVIRONMENT).authentication.type;

  readonly fleetMode = this.fleet.fleetMode;
  readonly activeClusterId = this.fleet.activeClusterId;
  readonly patUi = this.authType === 'users' || this.authType === 'keycloak';

  /** Global admins (users / keycloak admins, the API key): the shared release announcements. */
  readonly globalAdmin$ = isGlobalAdmin(this.auth);

  /** The resource tree column is collapsed (`[` toggles it, 3.37). */
  readonly treeCollapsed = signal(false);

  readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly context = toSignal(
    combineLatest([
      this.access.seesInfrastructure$,
      this.access.me$,
      this.access.isClusterAdmin$,
      this.auth.canAccessUserManager$,
      this.globalAdmin$,
      this.fleet.clusters$.pipe(map(fleetCompareAvailable), startWith(false)),
    ]).pipe(
      map(
        ([infrastructure, me, clusterAdmin, userManager, globalAdmin, fleetCompare]): ConsoleNavContext => ({
          infrastructure,
          me,
          clusterAdmin,
          userManager,
          globalAdmin,
          patUi: this.patUi,
          fleetCompare,
        }),
      ),
    ),
    {
      initialValue: {
        infrastructure: false,
        me: null,
        clusterAdmin: false,
        userManager: false,
        globalAdmin: false,
        patUi: this.patUi,
        fleetCompare: false,
      },
    },
  );

  /** The fleet root: no cluster open in fleet mode. */
  readonly atFleetRoot = computed(() => this.fleetMode && !this.activeClusterId());

  /** The cluster's sections (through the relay in fleet mode). */
  readonly sections = computed<ConsoleSection[]>(() =>
    this.fleetMode
      ? fleetClusterSections(CONSOLE_SECTIONS, FLEET_UNAVAILABLE_PATHS, FLEET_ADMIN_ONLY_PATHS)
      : CONSOLE_SECTIONS,
  );

  /** The rail: fleet pages at the fleet root, else the cluster's sections. */
  readonly rail = computed<ConsoleRailTile[]>(() =>
    this.atFleetRoot()
      ? fleetRail(FLEET_NAV_ITEMS, this.context())
      : visibleConsoleRail(this.sections(), this.context()),
  );

  /**
   * Cluster admins manage webhooks; global admins manage users and see the release announcements. In fleet mode the
   * fleet's own admin items, plus — with a cluster open — the cluster's (webhooks, release announcements for the
   * cluster-wide admin grant).
   */
  readonly adminItems = computed<ConsoleNavItem[]>(() =>
    CONSOLE_ADMIN_NAV_ITEMS.filter((item) => {
      if (this.fleetMode && FLEET_UNAVAILABLE_PATHS.includes(item.path)) return false;

      if (this.fleetMode && item.path === '/updates/announcements')
        return !!this.activeClusterId() && this.context().me?.clusterRole === 'cluster-admin';

      if (this.fleetMode && item.path === '/webhooks' && !this.activeClusterId()) return false;

      return consoleNavItemVisible(item, this.context());
    }),
  );

  /**
   * The caller's own settings (tokens, linked Git accounts). In fleet mode linked Git accounts are per cluster (the
   * signed person's there, 3.41): offered with a cluster open.
   */
  readonly accountItems = computed<ConsoleNavItem[]>(() =>
    CONSOLE_ACCOUNT_NAV_ITEMS.filter(
      (item) =>
        !(this.fleetMode && FLEET_UNAVAILABLE_PATHS.includes(item.path)) &&
        !(this.fleetMode && item.path === '/account/git-accounts' && !this.activeClusterId()) &&
        consoleNavItemVisible(item, this.context()),
    ),
  );

  /** The rail tile / footer item path the current URL belongs to. */
  readonly activePath = computed(() =>
    activeConsoleNavPath(this.url(), [
      ...this.rail().flatMap((tile) => tile.items),
      ...this.adminItems(),
      ...this.accountItems(),
    ]),
  );

  readonly activeSection = computed<ConsoleSectionId | null>(() => sectionForUrl(this.url(), this.sections()));

  /** The visible sub-nav pages of a section. */
  sectionItems(id: ConsoleSectionId): ConsoleNavItem[] {
    const section = this.sections().find((candidate) => candidate.id === id);

    return section ? visibleSectionItems(section, this.context()) : [];
  }

  section(id: ConsoleSectionId): ConsoleSection | null {
    return this.sections().find((candidate) => candidate.id === id) ?? null;
  }

  toggleTree(): void {
    this.treeCollapsed.set(!this.treeCollapsed());
  }
}
