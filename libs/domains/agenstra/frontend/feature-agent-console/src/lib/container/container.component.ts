import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  ClientsFacade,
  NotificationsFacade,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { IdentityLogoutConfirmModalComponent } from '@forepath/identity/frontend';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { combineLatest, filter, map, startWith } from 'rxjs';

import { ThemeService } from '../theme.service';

interface BootstrapPopoverInstance {
  dispose(): void;
  hide(): void;
  setContent(content: Record<string, string | Element | null | (() => string)>): void;
}

interface BootstrapPopoverConstructor {
  getOrCreateInstance(element: Element, options?: Record<string, unknown>): BootstrapPopoverInstance;
}

interface AdminNavItem {
  activePaths: string[];
  icon: string;
  label: string;
  routerLink: string[];
  title: string;
}

function getBootstrapPopover(): BootstrapPopoverConstructor | undefined {
  return (window as Window & { bootstrap?: { Popover?: BootstrapPopoverConstructor } }).bootstrap?.Popover;
}

@Component({
  selector: 'framework-agent-console-container',
  imports: [CommonModule, RouterModule, IdentityLogoutConfirmModalComponent],
  styleUrls: ['./container.component.scss'],
  templateUrl: './container.component.html',
  standalone: true,
})
export class AgentConsoleContainerComponent implements OnInit, OnDestroy {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  protected readonly notificationsFacade = inject(NotificationsFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);

  /**
   * True when on the main clients mask (not editor, deployments, etc.)
   */
  readonly isMainMask = toSignal(
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.router.url),
        startWith(this.router.url),
      )
      .pipe(
        map(
          (url) =>
            (url.includes('/clients') ||
              url.includes('/users') ||
              url.includes('/filters') ||
              url.includes('/audit') ||
              url.includes('/tickets') ||
              url.includes('/imports') ||
              url.includes('/knowledge')) &&
            !url.includes('/editor') &&
            !url.includes('/config') &&
            !url.includes('/deployments'),
        ),
      ),
    {
      initialValue:
        (this.router.url.includes('/clients') ||
          this.router.url.includes('/users') ||
          this.router.url.includes('/filters') ||
          this.router.url.includes('/audit') ||
          this.router.url.includes('/tickets') ||
          this.router.url.includes('/imports') ||
          this.router.url.includes('/knowledge')) &&
        !this.router.url.includes('/editor') &&
        !this.router.url.includes('/config') &&
        !this.router.url.includes('/deployments'),
    },
  );

  /**
   * Observable indicating whether the user is authenticated
   */
  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;
  readonly spacesAttentionBadge$ = this.notificationsFacade.spacesAttentionBadge$;

  /** Selected space (client); tickets need a client context in the UI. */
  readonly activeClientId$ = this.clientsFacade.activeClientId$;

  /** Sidebar Tickets link: `/tickets` until a workspace is chosen, then `/tickets/:clientId`. */
  readonly ticketsSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/tickets', id] : ['/tickets']))),
    { initialValue: ['/tickets'] },
  );

  readonly knowledgeSidebarLink = toSignal(
    this.clientsFacade.activeClientId$.pipe(map((id): string[] => (id ? ['/knowledge', id] : ['/knowledge']))),
    { initialValue: ['/knowledge'] },
  );

  /**
   * True when the user can access the user manager (admin with users/keycloak auth).
   */
  readonly canAccessUserManager$ = this.authenticationFacade.canAccessUserManager$;

  readonly isAdminRouteActive = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
      map((url) => url.includes('/users') || url.includes('/filters') || url.includes('/imports')),
    ),
    {
      initialValue:
        this.router.url.includes('/users') ||
        this.router.url.includes('/filters') ||
        this.router.url.includes('/imports'),
    },
  );

  private adminPopover: BootstrapPopoverInstance | null = null;

  @ViewChild('adminNavTrigger') set adminNavTrigger(ref: ElementRef<HTMLElement> | undefined) {
    this.onAdminNavTriggerReady(ref);
  }

  @ViewChild(IdentityLogoutConfirmModalComponent)
  private logoutConfirmModal?: IdentityLogoutConfirmModalComponent;

  /**
   * Display label for the current user's role. Admin for api-key auth, otherwise user.role capitalized.
   */
  readonly userRoleDisplay$ = combineLatest([
    this.authenticationFacade.isAuthenticated$,
    this.authenticationFacade.authenticationType$,
    this.authenticationFacade.user$,
  ]).pipe(
    map(([isAuthenticated, authType, user]) => {
      if (!isAuthenticated) return null;

      if (authType === 'api-key') return 'Admin';

      const role = user?.role;

      return role ? role.charAt(0).toUpperCase() + role.slice(1) : null;
    }),
  );

  /**
   * Signal indicating if we're in file-only mode (file query parameter is set)
   */
  readonly fileOnlyMode = toSignal(this.route.queryParams.pipe(map((params) => !!params['standalone'])), {
    initialValue: false,
  });

  /**
   * Signal indicating if standalone loading spinner should be shown
   */
  readonly showStandaloneLoading = this.standaloneLoadingService.isLoading;

  getRoleAriaLabel(role: string): string {
    return $localize`:@@featureContainer-ariaLabelRole:Role ${role}:role:`;
  }

  /**
   * Initialize component and check authentication status
   */
  ngOnInit(): void {
    this.authenticationFacade.checkAuthentication();

    this.authenticationFacade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) => {
        if (isAuthenticated) {
          this.notificationsFacade.connectSocket();
        } else {
          this.notificationsFacade.disconnectSocket();
        }
      });

    // Check initial query params immediately
    const initialParams = this.route.snapshot.queryParams;
    const isStandalone = !!initialParams['standalone'];

    if (isStandalone) {
      this.standaloneLoadingService.setLoading(true);
    }

    // Watch for query parameter changes
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const isStandalone = !!params['standalone'];

      if (isStandalone) {
        this.standaloneLoadingService.setLoading(true);
      } else {
        this.standaloneLoadingService.setLoading(false);
      }
    });
  }

  /**
   * Opens logout confirmation before ending all active sessions.
   */
  onLogoutClick(): void {
    this.logoutConfirmModal?.open();
  }

  /**
   * Handles confirmed logout action
   */
  onLogoutConfirmed(result: { invalidateAllSessions: boolean }): void {
    this.notificationsFacade.disconnectSocket();
    this.authenticationFacade.logout(result.invalidateAllSessions);
  }

  ngOnDestroy(): void {
    this.disposeAdminPopover();
  }

  onAdminNavTriggerReady(trigger: ElementRef<HTMLElement> | undefined): void {
    if (!trigger) {
      this.disposeAdminPopover();

      return;
    }

    this.setupAdminPopover(trigger.nativeElement);
  }

  private setupAdminPopover(trigger: HTMLElement): void {
    if (this.adminPopover) {
      return;
    }

    const Popover = getBootstrapPopover();

    if (!Popover) {
      return;
    }

    const buildBody = (): HTMLElement => this.buildAdminNavGrid();

    this.adminPopover = Popover.getOrCreateInstance(trigger, {
      trigger: 'click',
      placement: 'right',
      container: 'body',
      html: true,
      sanitize: false,
      customClass: 'sidebar-admin-popover',
      title: ' ',
      template: '<div class="popover sidebar-admin-popover" role="tooltip"><div class="popover-body"></div></div>',
      content: buildBody,
      popperConfig: (defaultConfig: any) => ({
        ...defaultConfig,
        placement: 'right-start',
      }),
    });

    trigger.addEventListener('show.bs.popover', () => {
      this.adminPopover?.setContent({ '.popover-body': buildBody() });
    });
  }

  private disposeAdminPopover(): void {
    this.adminPopover?.dispose();
    this.adminPopover = null;
  }

  private buildAdminNavGrid(): HTMLElement {
    const grid = document.createElement('div');

    grid.className = 'sidebar-admin-popover__grid';
    grid.setAttribute('role', 'menu');

    for (const item of this.getAdminNavItems()) {
      const link = document.createElement('a');

      link.className = 'sidebar__item';
      link.href = '#';
      link.title = item.title;
      link.setAttribute('role', 'menuitem');

      if (this.isAdminNavItemActive(item)) {
        link.classList.add('active');
      }

      const icon = document.createElement('i');

      icon.className = `bi ${item.icon} me-1`;

      const label = document.createElement('span');

      label.className = 'small';
      label.textContent = item.label;

      link.append(icon, label);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void this.router.navigate(item.routerLink);
        this.adminPopover?.hide();
      });
      grid.appendChild(link);
    }

    return grid;
  }

  private getAdminNavItems(): AdminNavItem[] {
    return [
      {
        routerLink: ['/users'],
        activePaths: ['/users'],
        icon: 'bi-people',
        title: $localize`:@@featureContainer-userManagementTitle:User Management`,
        label: $localize`:@@featureContainer-users:Users`,
      },
      {
        routerLink: ['/filters'],
        activePaths: ['/filters'],
        icon: 'bi-funnel',
        title: $localize`:@@featureContainer-filtersTitle:Filters`,
        label: $localize`:@@featureContainer-filters:Filters`,
      },
      {
        routerLink: ['/imports/atlassian'],
        activePaths: ['/imports'],
        icon: 'bi-cloud-download',
        title: $localize`:@@featureContainer-importTitle:Import`,
        label: $localize`:@@featureContainer-importTitle:Import`,
      },
    ];
  }

  private isAdminNavItemActive(item: AdminNavItem): boolean {
    const url = this.router.url;

    return item.activePaths.some((path) => url.includes(path));
  }
}
