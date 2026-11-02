import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { ConsoleFleetFacade, type FleetCluster } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcContextMenuComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
  FpcListToolbarComponent,
  type FpcContextMenuPosition,
  type FpcMenuItem,
  FpcSearchFieldComponent,
  FpcSplitPaneComponent,
  fpcFilterTree,
  fpcTreeBranchIds,
  fpcTreePath,
  FpcTreeComponent,
  type FpcTreeContextMenuEvent,
} from '@forepath/shared/frontend/ui-components';

import { matchesParsedSearch, parseSearch } from '../list-search';
import { ConsoleNavService } from '../nav/console-nav.service';
import { ConsoleSettingsService } from '../nav/console-settings.service';
import type { WorkspaceItem } from '../workspace/workspace-model';
import { objectRefFromUrl } from './object-route';
import { actionMenuItems, ResourcesContextService } from './resources-context.service';
import {
  buildResourceTree,
  builtinMemberEntry,
  type BuiltinMemberLabels,
  defaultTreeView,
  itemSearchDocument,
  RESOURCE_SEARCH_FIELDS,
  RESOURCE_TREE_VIEWS,
  treeNodeIdsFor,
  type ResourceTreeData,
  type ResourceTreeLabels,
  type ResourceTreeNode,
  type ResourceTreeView,
  fleetTreeExpanded,
  fleetTreeRoots,
} from './resource-tree';
import type { SavedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

const FAVOURITE_ACTION = 'tree-favourite';

/** Localized names of the tree views. */
export const TREE_VIEW_LABELS: Record<ResourceTreeView, string> = {
  placement: $localize`:@@lwConsoleResources-viewPlacement:Placement`,
  projects: $localize`:@@lwConsoleResources-viewProjects:Projects`,
  kind: $localize`:@@lwConsoleResources-viewKind:Kind`,
  labels: $localize`:@@lwConsoleResources-viewLabels:Labels`,
};

/** Icons of the tree views (the view switch is an icon menu, 3.38). */
export const TREE_VIEW_ICONS: Record<ResourceTreeView, string> = {
  placement: 'bi-diagram-3',
  projects: 'bi-folder',
  kind: 'bi-collection',
  labels: 'bi-tags',
};

/** The tree view stored in the console settings, if it is one. */
export function storedTreeView(value: unknown): ResourceTreeView | null {
  return RESOURCE_TREE_VIEWS.includes(value as ResourceTreeView) ? (value as ResourceTreeView) : null;
}

/**
 * Resources (3.37): a Proxmox-style resource tree (Placement / Projects / Kind / Labels, own search keeping ancestors,
 * favourites, ● draft marks, context menu from `workspaceActions()`) beside the routed object page. Resizable
 * 240–480 px; view and favourites are per-user console settings.
 */
/** Below Bootstrap `md`: the tree is a drawer. */
function isPhone(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 767.98px)').matches;
}

@Component({
  selector: 'loadweaver-resources-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LoadweaverSavedViewsComponent,
    RouterOutlet,
    FpcConfirmDialogComponent,
    FpcButtonComponent,
    FpcContextMenuComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
    FpcListToolbarComponent,
    FpcSearchFieldComponent,
    FpcSplitPaneComponent,
    FpcTreeComponent,
  ],
  providers: [ResourcesContextService],
  host: { class: 'lw-resources' },
  template: `
    <fpc-split-pane
      class="lw-resources__split"
      [min]="240"
      [max]="480"
      [defaultSize]="320"
      storageKey="lw.tree"
      [separatorLabel]="resizeLabel"
      [collapsed]="navigation.treeCollapsed()"
      (collapsedChange)="navigation.treeCollapsed.set($event)"
    >
      <aside fpcSplitPaneStart class="lw-resources__tree border-end" [attr.aria-label]="treeLabel">
        <!-- Head = the shared list toolbar strip (3.38 R12): search lead; view (icon menu), Views, Refresh as actions. -->
        <fpc-list-toolbar class="lw-resources__tree-head" [filterable]="false">
          <fpc-search-field
            fpcListToolbarLead
            inputId="lw-tree-search"
            [placeholder]="searchLabel"
            [ariaLabel]="searchLabel"
            [title]="searchHint"
            [(value)]="query"
            data-testid="resources-tree-search"
          />
          <ng-container ngProjectAs="[fpcListToolbarActions]">
            <fpc-dropdown #viewMenu alignment="end" width="trigger" data-testid="resources-tree-view">
              <fpc-button
                fpcDropdownTrigger
                variant="dark"
                size="sm"
                iconOnly
                ariaHaspopup="menu"
                [ariaExpanded]="viewMenu.open()"
                [ariaControls]="viewMenu.open() ? viewMenu.menuId() : null"
                [ariaLabel]="viewLabel + ': ' + viewLabels[view()]"
                [title]="viewLabel + ': ' + viewLabels[view()]"
              >
                <i class="bi {{ viewIcons[view()] }}" aria-hidden="true"></i>
              </fpc-button>
              @for (v of views; track v) {
                <fpc-dropdown-item
                  [icon]="viewIcons[v].replace('bi-', '')"
                  [active]="v === view()"
                  (selected)="setView(v)"
                  [attr.data-testid]="'resources-tree-view-' + v"
                  >{{ viewLabels[v] }}</fpc-dropdown-item
                >
              }
            </fpc-dropdown>
            <loadweaver-saved-views scope="tree" [binding]="treePresets" />
            <fpc-button
              variant="dark"
              size="sm"
              iconOnly
              [ariaLabel]="refreshLabel"
              [title]="refreshLabel"
              (clicked)="context.reload()"
              data-testid="resources-tree-refresh"
            >
              <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </fpc-button>
          </ng-container>
        </fpc-list-toolbar>
        <fpc-tree
          class="lw-resources__tree-body"
          [nodes]="visibleNodes()"
          [(expanded)]="expanded"
          [selectedId]="selectedNodeId()"
          [ariaLabel]="treeLabel"
          [emptyText]="query() ? noMatchesLabel : emptyLabel"
          (nodeActivate)="open($event)"
          (expandRequest)="open($event)"
          (nodeContextMenu)="openMenu($event)"
          data-testid="resources-tree"
        />
      </aside>
      <div fpcSplitPaneEnd class="lw-resources__main fpc-routed-outlet">
        <router-outlet />
      </div>
    </fpc-split-pane>

    <!-- Phones (3.37 P7): the tree is an off-canvas drawer (backdrop closes it, opening a node too). -->
    @if (!navigation.treeCollapsed()) {
      <div class="lw-resources__backdrop" (click)="navigation.treeCollapsed.set(true)" aria-hidden="true"></div>
    }
    <fpc-button
      class="lw-resources__drawer-toggle shadow"
      variant="primary"
      size="sm"
      iconOnly
      [ariaLabel]="treeLabel"
      [ariaExpanded]="!navigation.treeCollapsed()"
      (clicked)="navigation.toggleTree()"
      data-testid="resources-tree-drawer"
    >
      <i class="bi bi-diagram-3" aria-hidden="true"></i>
    </fpc-button>

    <fpc-context-menu
      [items]="menuItems()"
      [(position)]="menuPosition"
      [ariaLabel]="menuLabel"
      (itemSelect)="onMenuSelect($event)"
      (closed)="menuNode.set(null)"
    />

    <fpc-confirm-dialog
      [open]="!!context.pending()"
      (openChange)="$event || context.cancelPending()"
      [title]="confirmTitle"
      [message]="context.pending()?.confirm?.message ?? null"
      [confirmLabel]="context.pending()?.label ?? ''"
      [cancelLabel]="cancelLabel"
      [danger]="!!context.pending()?.confirm?.danger"
      (confirmed)="context.confirmPending()"
    />
  `,
  styles: `
    :host {
      display: flex;
      flex: 1 1 0;
      min-height: 0;
      min-width: 0;
    }

    .lw-resources__split {
      flex: 1 1 0;
      min-height: 0;
    }

    .lw-resources__tree {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    /* One row in the 240–480 px column: the shared lead basis (16 rem, phones wrap the actions below the search)
       pushed the three tree actions onto a second row under the search. */
    .lw-resources__tree-head ::ng-deep .fpc-list-toolbar__lead {
      flex-basis: 6rem;
    }

    .lw-resources__tree-body {
      flex: 1 1 0;
      min-height: 0;
    }

    .lw-resources__main {
      height: 100%;
    }

    .lw-resources__backdrop,
    .lw-resources__drawer-toggle {
      display: none;
    }

    @media (max-width: 767.98px) {
      :host ::ng-deep .lw-resources__split > .fpc-split-pane__pane--start {
        position: fixed;
        top: 3.5rem;
        bottom: env(safe-area-inset-bottom);
        left: 0;
        width: min(85vw, 360px) !important;
        max-width: none !important;
        z-index: var(--fpc-z-offcanvas, 1045);
        background-color: var(--bs-body-bg);
        box-shadow: 0.25rem 0 1rem rgb(0 0 0 / 0.15);
      }

      :host ::ng-deep .lw-resources__split > .fpc-split-pane__gutter {
        display: none;
      }

      .lw-resources__backdrop {
        display: block;
        position: fixed;
        inset: 0;
        z-index: var(--fpc-z-offcanvas-backdrop, 1044);
        background: rgb(0 0 0 / 0.3);
      }

      .lw-resources__drawer-toggle {
        display: inline-flex;
        position: fixed;
        /* Right of the rail (the shared phone navigation, 2026-10-29), above the task dock row (2.5rem). */
        left: calc(2rem + 40.5px + 0.75rem);
        bottom: calc(3.25rem + env(safe-area-inset-bottom));
        z-index: var(--fpc-z-chrome, 1030);
      }
    }
  `,
})
export class LoadweaverResourcesShellComponent implements OnInit {
  readonly context = inject(ResourcesContextService);
  private readonly router = inject(Router);
  readonly navigation = inject(ConsoleNavService);
  private readonly settings = inject(ConsoleSettingsService);
  private readonly fleet = inject(ConsoleFleetFacade);
  /** Fleet mode (3.37 P7): the fleet root sits above the active cluster's tree. */
  private readonly fleetClusters = toSignal(this.fleet.clusters$, { initialValue: [] as FleetCluster[] });

  readonly views = RESOURCE_TREE_VIEWS;
  readonly viewLabels = TREE_VIEW_LABELS;
  readonly viewIcons = TREE_VIEW_ICONS;
  readonly query = signal('');
  readonly expanded = signal<readonly string[]>(['cluster', 'group:projects']);
  readonly menuPosition = signal<FpcContextMenuPosition | null>(null);
  readonly menuNode = signal<ResourceTreeNode | null>(null);

  private readonly labels: ResourceTreeLabels = {
    cluster: $localize`:@@lwConsoleResources-cluster:Cluster`,
    unplaced: $localize`:@@lwConsoleResources-unplaced:Unplaced & cluster-level`,
    projects: $localize`:@@lwConsoleResources-projects:Projects`,
    clusterLevel: $localize`:@@lwConsoleResources-clusterLevel:Cluster-level`,
    favourites: $localize`:@@lwConsoleResources-favourites:Favourites`,
    noLabels: $localize`:@@lwConsoleResources-noLabels:No labels`,
    changed: $localize`:@@lwConsoleResources-changed:Changed in the draft`,
  };
  private readonly builtinLabels: BuiltinMemberLabels = {
    label: $localize`:@@lwConsoleResources-builtinMember:Control plane (built-in)`,
    active: $localize`:@@lwConsoleResources-builtinActive:Active key holder`,
    standby: $localize`:@@lwConsoleResources-builtinStandby:Standby`,
    participant: $localize`:@@lwConsoleResources-builtinParticipant:Key holder`,
    problem: $localize`:@@lwConsoleResources-builtinProblem:Seal key problem`,
    activeHint: $localize`:@@lwConsoleResources-builtinActiveHint:Holds the master key. Never runs workloads.`,
    standbyHint: $localize`:@@lwConsoleResources-builtinStandbyHint:Keeps a standby key copy. Never runs workloads.`,
    participantHint: $localize`:@@lwConsoleResources-builtinParticipantHint:Holds a key share. Never runs workloads.`,
    problemHint: $localize`:@@lwConsoleResources-builtinProblemHint:Can't open its seal key. Never runs workloads.`,
  };
  readonly fleetLabel = $localize`:@@lwConsoleResources-fleet:Fleet`;
  readonly clustersLabel = $localize`:@@lwConsoleResources-fleetClusters:Clusters`;
  readonly treeLabel = $localize`:@@lwConsoleResources-tree:Resource tree`;
  readonly viewLabel = $localize`:@@lwConsoleResources-view:Tree view`;
  readonly searchLabel = $localize`:@@lwConsoleResources-treeSearch:Search resources`;
  /** Syntax help in the field's title (3.38 R11). */
  readonly searchHint = $localize`:@@lwConsoleResources-treeSearchHint:Filter with kind:, project: or status: (prefix - to exclude)`;
  readonly refreshLabel = $localize`:@@lwConsoleResources-refresh:Refresh`;
  readonly resizeLabel = $localize`:@@lwConsoleResources-resize:Resize the tree`;
  readonly emptyLabel = $localize`:@@lwConsoleResources-treeEmpty:Nothing here yet`;
  readonly noMatchesLabel = $localize`:@@lwConsoleResources-noMatches:No matches`;
  readonly menuLabel = $localize`:@@lwConsoleResources-menu:Actions`;
  readonly confirmTitle = $localize`:@@lwConsoleWorkspace-confirmTitle:Run this action?`;
  readonly cancelLabel = $localize`:@@lwConsoleWorkspace-cancel:Cancel`;
  private readonly pinLabel = $localize`:@@lwConsoleResources-pin:Pin to favourites`;
  private readonly unpinLabel = $localize`:@@lwConsoleResources-unpin:Remove from favourites`;

  /** The chosen view, else the stored one, else by role (Placement for cluster roles, Projects for members). */
  private readonly chosenView = signal<ResourceTreeView | null>(null);
  readonly view = computed<ResourceTreeView>(
    () =>
      this.chosenView() ??
      storedTreeView(this.settings.state()['treeView']) ??
      defaultTreeView(this.context.infrastructure()),
  );
  /** Tree view presets (3.37 "Views ▾", scope `tree`): view, filter and expanded branches, per user. */
  readonly treePresets: SavedViewBinding = {
    state: computed(() => ({ view: this.view(), query: this.query(), expanded: [...this.expanded()] })),
    apply: (state) => {
      const view = storedTreeView(state['view']);
      const expanded = state['expanded'];

      if (view) this.setView(view);
      this.query.set(typeof state['query'] === 'string' ? state['query'] : '');
      if (Array.isArray(expanded)) this.expanded.set(expanded.filter((id): id is string => typeof id === 'string'));
    },
  };
  readonly favourites = computed<string[]>(() => {
    const stored = this.settings.state()['treeFavourites'];

    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  });
  readonly clusterNodes = computed(() =>
    buildResourceTree(this.context.model(), this.view(), {
      changed: this.context.changedIds(),
      favourites: this.favourites(),
      labels: this.labels,
      // Read-only, never schedulable (3.39); infra roles only (it's next to the nodes).
      builtin: this.context.infrastructure()
        ? builtinMemberEntry(this.context.builtinMember(), this.builtinLabels)
        : null,
    }),
  );
  readonly nodes = computed<ResourceTreeNode[]>(() =>
    this.navigation.fleetMode
      ? fleetTreeRoots(
          this.fleetClusters().map((c) => ({ id: c.id, name: c.name, health: c.health.state })),
          this.navigation.activeClusterId(),
          this.clusterNodes(),
          { fleet: this.fleetLabel, clusters: this.clustersLabel },
        )
      : [...this.clusterNodes()],
  );
  readonly parsedQuery = computed(() => parseSearch(this.query(), RESOURCE_SEARCH_FIELDS));
  readonly visibleNodes = computed(() => {
    const parsed = this.parsedQuery();

    if (parsed.terms.length === 0) return this.nodes();

    return fpcFilterTree(this.nodes(), (node) => {
      const item = node.data?.item;

      return !!item && matchesParsedSearch(parsed, itemSearchDocument(item));
    });
  });
  /** The object page shown → its tree node. */
  readonly currentItem = computed<WorkspaceItem | null>(() => {
    const ref = objectRefFromUrl(this.navigation.url());

    return ref ? this.context.itemFor(ref) : null;
  });
  readonly selectedNodeId = computed<string | null>(() => {
    const ref = objectRefFromUrl(this.navigation.url());

    if (ref?.kind === 'cluster') return 'cluster';

    if (ref?.kind === 'project' && ref.name) return `project:${ref.name}`;

    const item = this.currentItem();

    return item ? (treeNodeIdsFor(item.id, this.visibleNodes()).find((id) => !id.startsWith('fav:')) ?? null) : null;
  });
  readonly menuItems = computed<FpcMenuItem[]>(() => {
    const item = this.menuNode()?.data?.item;

    if (!item) return [];

    const favourite = this.favourites().includes(item.id);

    return [
      ...actionMenuItems(this.context.actionsOf(item)),
      {
        id: FAVOURITE_ACTION,
        label: favourite ? this.unpinLabel : this.pinLabel,
        icon: favourite ? 'star-fill' : 'star',
        dividerBefore: true,
      },
    ];
  });

  constructor() {
    // Searching expands every branch of the result.
    effect(() => {
      const parsed = this.parsedQuery();
      const visible = this.visibleNodes();

      if (parsed.terms.length > 0) untracked(() => this.expanded.set(fpcTreeBranchIds(visible)));
    });

    // Reveal the open object: expand its ancestors.
    effect(() => {
      const id = this.selectedNodeId();
      const nodes = this.visibleNodes();

      if (!id) return;

      const ancestors = fpcTreePath(nodes, id)
        .slice(0, -1)
        .map((n) => n.id);

      untracked(() => {
        const current = new Set(this.expanded());

        if (ancestors.some((a) => !current.has(a))) this.expanded.set([...current, ...ancestors]);
      });
    });
  }

  ngOnInit(): void {
    this.context.start();

    // Phones start with the drawer closed.
    if (isPhone()) this.navigation.treeCollapsed.set(true);

    if (this.navigation.fleetMode) {
      this.fleet.loadClusters();
      this.expanded.set([...new Set([...this.expanded(), ...fleetTreeExpanded(this.navigation.activeClusterId())])]);
    }
  }

  setView(view: string): void {
    const next = storedTreeView(view);

    if (!next) return;

    this.chosenView.set(next);
    this.settings.patch({ treeView: next });
  }

  open(node: ResourceTreeNode): void {
    const clusterId = node.data?.clusterId;

    // Another fleet cluster: it becomes the active one (one expanded cluster at a time) and opens on its landing.
    if (clusterId) {
      if (clusterId !== this.navigation.activeClusterId()) {
        this.expanded.set(fleetTreeExpanded(clusterId).concat('cluster', 'group:projects'));
        this.fleet.openCluster(clusterId, '/resources/cluster');
      }

      return;
    }

    const route = node.data?.route;

    if (route && isPhone()) this.navigation.treeCollapsed.set(true);

    // Fleet pages close the cluster first (the fleet level has no active cluster).
    if (route?.[0] === '/fleet') this.fleet.leaveCluster();

    if (route) void this.router.navigate([...route]);
  }

  openMenu(event: FpcTreeContextMenuEvent<ResourceTreeData>): void {
    if (!event.node.data?.item) return;

    this.menuNode.set(event.node);
    this.menuPosition.set({ x: event.x, y: event.y });
  }

  onMenuSelect(entry: FpcMenuItem): void {
    const item = this.menuNode()?.data?.item ?? null;

    this.menuPosition.set(null);

    if (!item) return;

    if (entry.id === FAVOURITE_ACTION) {
      this.toggleFavourite(item.id);

      return;
    }

    const action = this.context.actionsOf(item).find((a) => a.id === entry.id);

    if (action) this.context.run(action, item);
  }

  toggleFavourite(id: string): void {
    const current = this.favourites();
    const next = current.includes(id) ? current.filter((f) => f !== id) : [...current, id];

    this.settings.patch({ treeFavourites: next });
  }
}
