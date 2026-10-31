import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { ResourceKey } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcButtonComponent,
  type FpcCrumb,
  type FpcMenuItem,
  FpcObjectHeaderComponent,
  FpcStatusBadgeComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  fpcCopyIdMenuItem,
  fpcCopyText,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { LoadweaverAccessPageComponent } from '../access/access-page.component';
import { LoadweaverProjectRequestsPageComponent } from '../access/project-requests-page.component';
import { LoadweaverAutoscalingPanelComponent } from '../autoscaling/autoscaling-panel.component';
import { LoadweaverBackupsPageComponent } from '../backups/backups-page.component';
import { LoadweaverDnsPageComponent } from '../dns/dns-page.component';
import { LoadweaverFilesPageComponent } from '../files/files-page.component';
import { LoadweaverGitPageComponent } from '../git/git-page.component';
import { LoadweaverLogsPageComponent } from '../logs/logs-page.component';
import { LoadweaverMetricsPageComponent } from '../metrics/metrics-page.component';
import { LoadweaverScopedSectionComponent } from '../section/section-scope';
import { LoadweaverSlosPageComponent } from '../slos/slos-page.component';
import { LoadweaverTerminalsPageComponent } from '../terminals/terminals-page.component';
import { LoadweaverUpdatesPageComponent } from '../updates/updates-page.component';
import { LoadweaverUsagePageComponent } from '../usage/usage-page.component';
import { LoadweaverHealthDetailPageComponent } from '../health/health-detail-page.component';
import { mayJoinNodes } from '../nodes/node-format';
import { mayManageSecrets } from '../secret-admin/secret-admin-format';
import { LoadweaverSecretAdminPageComponent } from '../secret-admin/secret-admin-page.component';
import { isTypingTarget } from '../nav/shortcuts';
import { LoadweaverNodeDetailPageComponent } from '../nodes/node-detail-page.component';
import { LoadweaverPolicyDetailPageComponent } from '../policies/policy-detail-page.component';
import { LoadweaverResourceDetailPageComponent } from '../resources/resource-detail-page.component';
import { kindDisplayName } from '../resources/resource-format';
import { LoadweaverResourceSpecComponent } from '../resources/resource-spec.component';
import { LoadweaverVirtualMachineDetailPageComponent } from '../virtual-machines/virtual-machine-detail-page.component';
import { mayDraftResource, type WorkspaceAction } from '../workspace/workspace-actions';
import { workspaceHealthIcon, workspaceHealthLabel, workspaceHealthTone } from '../workspace/workspace-format';
import { LoadweaverTopologyMapComponent } from '../topology/topology-map.component';
import { LoadweaverWorkspaceVmImagesComponent } from '../workspace/workspace-vm-images.component';
import { LoadweaverWorkspaceJoinTokensComponent } from '../workspace/workspace-join-tokens.component';
import { workspaceAncestors, type WorkspaceItem } from '../workspace/workspace-model';
import { consoleHomeCrumb, objectRoute } from './object-route';
import { ResourceModalService } from './resource-modal.service';
import { contentsRows } from './object-contents';
import { objectTabBody, type ObjectTabBody } from './object-tab-body';
import { objectPageKind, objectTabs, resolveObjectTab, type ObjectTabId } from './object-tabs';
import { actionMenuItems, ResourcesContextService, type ResourceObjectRef } from './resources-context.service';
import { LoadweaverObjectContentsComponent } from './tabs/object-contents.component';
import { LoadweaverObjectHistoryComponent } from './tabs/object-history.component';
import { LoadweaverGroupMembersComponent, LoadweaverObjectFactsComponent } from './tabs/object-parts.component';
import { LoadweaverScopeSummaryComponent } from './tabs/scope-summary.component';

/** Immediate actions shown as header buttons; the rest go into "More". */
const PRIMARY_ACTIONS = 3;

/** The object of the route: `data.objectKind` (cluster, site, node, project) or the `:kind` parameter. */
export function routeObjectRef(
  data: Readonly<Record<string, unknown>>,
  params: { get(name: string): string | null },
): ResourceObjectRef {
  const fixed = typeof data['objectKind'] === 'string' ? (data['objectKind'] as string) : null;

  if (fixed === 'cluster') return { kind: 'cluster', project: null, name: null };

  if (fixed) return { kind: fixed, project: null, name: params.get('name') };

  const project = params.get('project');

  return {
    kind: (params.get('kind') ?? 'other').toLowerCase(),
    project: project && project !== '-' ? project : null,
    name: params.get('name'),
  };
}

/**
 * An object page (3.37): `fpc-object-header` (breadcrumbs, type icon, name, health, primary actions + "More" from
 * `workspaceActions()`) with the kind's full tab set (`objectTabs()`, `?tab=`, unknown → Summary) and the tab body —
 * the reused detail-page parts, Contents, Task history or the section page with the object's filter preset.
 */
@Component({
  selector: 'loadweaver-object-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    LoadweaverAccessPageComponent,
    LoadweaverBackupsPageComponent,
    LoadweaverDnsPageComponent,
    LoadweaverFilesPageComponent,
    LoadweaverGitPageComponent,
    LoadweaverLogsPageComponent,
    LoadweaverMetricsPageComponent,
    LoadweaverProjectRequestsPageComponent,
    LoadweaverScopedSectionComponent,
    LoadweaverSlosPageComponent,
    LoadweaverTerminalsPageComponent,
    LoadweaverUpdatesPageComponent,
    LoadweaverUsagePageComponent,
    LoadweaverSecretAdminPageComponent,
    FpcButtonComponent,
    FpcObjectHeaderComponent,
    FpcStatusBadgeComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverAutoscalingPanelComponent,
    LoadweaverGroupMembersComponent,
    LoadweaverHealthDetailPageComponent,
    LoadweaverNodeDetailPageComponent,
    LoadweaverObjectContentsComponent,
    LoadweaverObjectFactsComponent,
    LoadweaverObjectHistoryComponent,
    LoadweaverPolicyDetailPageComponent,
    LoadweaverResourceDetailPageComponent,
    LoadweaverResourceSpecComponent,
    LoadweaverScopeSummaryComponent,
    LoadweaverVirtualMachineDetailPageComponent,
    LoadweaverWorkspaceJoinTokensComponent,
    LoadweaverTopologyMapComponent,
    LoadweaverWorkspaceVmImagesComponent,
  ],
  host: { class: 'lw-object d-flex flex-column flex-grow-1 min-h-0', '(document:keydown)': 'onKey($event)' },
  template: `
    <fpc-object-header
      class="flex-shrink-0"
      [title]="title()"
      [subtitle]="subtitle()"
      [crumbs]="crumbs()"
      [mark]="changed()"
      [markLabel]="changedLabel"
      [moreItems]="moreItems()"
      [moreLabel]="moreLabel"
      [breadcrumbsLabel]="crumbsLabel"
      (moreSelect)="onMore($event)"
      data-testid="object-header"
    >
      @if (item(); as i) {
        <fpc-status-badge
          fpcObjectHeaderBadges
          [tone]="tone(i.health)"
          size="sm"
          [ariaLabel]="healthLabel(i.health)"
          [title]="healthLabel(i.health)"
          data-testid="object-health"
        >
          <i class="bi {{ healthIcon(i.health) }}" aria-hidden="true"></i>
        </fpc-status-badge>
      }
      <ng-container ngProjectAs="[fpcObjectHeaderActions]">
        @if (mayJoin()) {
          <fpc-button
            variant="secondary"
            size="sm"
            iconOnly
            [ariaLabel]="joinLabel"
            [title]="joinLabel"
            (clicked)="openJoin()"
            data-testid="object-join"
          >
            <i class="bi bi-node-plus" aria-hidden="true"></i>
          </fpc-button>
        }
        @for (action of primary(); track action.id) {
          <fpc-button
            variant="secondary"
            size="sm"
            iconOnly
            [disabled]="!!action.disabled"
            [ariaLabel]="action.label"
            [title]="action.reason ?? action.label"
            (clicked)="run(action)"
            [attr.data-testid]="'object-action-' + action.id"
          >
            <i class="bi {{ action.icon }}" aria-hidden="true"></i>
          </fpc-button>
        }
      </ng-container>
      <fpc-tab-group [activeId]="tab()" (activeIdChange)="selectTab($event)" [ariaLabel]="tabsLabel">
        @for (t of tabs(); track t.id) {
          <fpc-tab [id]="t.id" [label]="t.label" [icon]="t.icon" />
        }
      </fpc-tab-group>
    </fpc-object-header>

    <!-- Embedded pages (fpc-page) draw no top edge here: the tab bar above owns that line (3.38 R1). Every tab body
         brings its own scroller (lanes, data tables, workbench; R3: never a scroller inside a scroller). -->
    <div class="lw-object__body fpc-page--embedded flex-grow-1 d-flex flex-column min-h-0" data-testid="object-body">
      @switch (body().type) {
        @case ('scope-summary') {
          <loadweaver-scope-summary [project]="$any(body()).project" />
        }
        @case ('site-summary') {
          <!-- Summary bar like the cluster / project / node pages (LW-23 round 2), then the site's details. -->
          @if (siteSummary(); as s) {
            <fpc-summary-bar class="flex-shrink-0" [columns]="3" data-testid="site-summary-bar">
              <fpc-summary-card
                icon="hdd-stack"
                [label]="nodesLabel"
                [value]="s.nodesHealthy + ' / ' + s.nodes"
                [tone]="s.nodesHealthy < s.nodes ? 'warning' : 'default'"
              />
              <fpc-summary-card icon="boxes" [label]="siteObjectsLabel" [value]="'' + s.objects" />
              <fpc-summary-card
                icon="exclamation-triangle"
                [label]="siteProblemsLabel"
                [value]="'' + s.problems"
                [tone]="s.problems > 0 ? 'danger' : 'default'"
              />
            </fpc-summary-bar>
          }
          <loadweaver-object-facts [item]="item()" />
        }
        @case ('contents') {
          <loadweaver-object-contents
            [scope]="$any(body()).scope"
            [preset]="$any(body()).preset"
            [ariaLabel]="title()"
          />
        }
        @case ('node') {
          <loadweaver-node-detail-page />
        }
        @case ('vm') {
          <loadweaver-virtual-machine-detail-page [part]="$any(body()).part" />
        }
        @case ('resource') {
          <loadweaver-resource-detail-page [resourceKey]="$any(body()).key" [settings]="!!$any(body()).settings" />
        }
        @case ('spec') {
          <loadweaver-resource-spec [resourceKey]="$any(body()).key" [editable]="canEdit()" />
        }
        @case ('policy') {
          <loadweaver-policy-detail-page [policyKey]="$any(body()).key" />
        }
        @case ('group-members') {
          <loadweaver-group-members [groupKey]="$any(body()).key" />
        }
        @case ('autoscaling') {
          <loadweaver-autoscaling-panel
            class="d-flex flex-column flex-grow-1 min-h-0"
            [lane]="true"
            [project]="$any(body()).project"
            [deployment]="$any(body()).deployment"
          />
        }
        @case ('health') {
          <loadweaver-health-detail-page [embedded]="true" [entityKey]="$any(body()).entity" />
        }
        @case ('vm-images') {
          <loadweaver-workspace-vm-images [showList]="true" [fixedProject]="$any(body()).project" />
        }
        @case ('topology') {
          <loadweaver-topology-map [scope]="$any(body()).scope" />
        }
        @case ('join-tokens') {
          <loadweaver-workspace-join-tokens [showList]="true" [site]="$any(body()).site" [siteNames]="siteNames()" />
        }
        @case ('history') {
          <loadweaver-object-history [ref]="ref()" [resourceKind]="resourceKind()" />
        }
        @case ('section') {
          <!-- Keyed by the scope: a new object / tab creates a fresh page (pages read their presets once). -->
          @for (scope of [sectionScope()]; track scope.key) {
            <loadweaver-scoped-section [params]="scope.params">
              @switch (scope.section) {
                @case ('members') {
                  <loadweaver-access-page />
                }
                @case ('secrets') {
                  <loadweaver-secret-admin-page />
                }
                @case ('requests') {
                  <loadweaver-project-requests-page />
                }
                @case ('dns') {
                  <loadweaver-dns-page />
                }
                @case ('metrics') {
                  <loadweaver-metrics-page />
                }
                @case ('logs') {
                  <loadweaver-logs-page />
                }
                @case ('terminals') {
                  <loadweaver-terminals-page />
                }
                @case ('updates') {
                  <loadweaver-updates-page />
                }
                @case ('files') {
                  <loadweaver-files-page />
                }
                @case ('backups') {
                  <loadweaver-backups-page />
                }
                @case ('topology') {
                  <loadweaver-topology-map [scope]="{ kind: 'project', name: scope.params['project'] ?? '' }" />
                }
                @case ('slos') {
                  <loadweaver-slos-page />
                }
                @case ('usage') {
                  <loadweaver-usage-page />
                }
                @case ('git') {
                  <loadweaver-git-page />
                }
              }
            </loadweaver-scoped-section>
          }
        }
        @default {
          @if (item(); as i) {
            <loadweaver-object-facts [item]="i" />
          }
        }
      }
    </div>

    <!-- The "Join tokens" tab brings its own dialog; else this one serves "Join node" / ?join=1. -->
    @if (joinable() && body().type !== 'join-tokens') {
      <loadweaver-workspace-join-tokens [showList]="false" [siteNames]="siteNames()" />
    }
  `,
})
export class LoadweaverObjectPageComponent {
  readonly context = inject(ResourcesContextService);
  private readonly resourceModal = inject(ResourceModalService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly joinTokens = viewChild(LoadweaverWorkspaceJoinTokensComponent);

  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly data = toSignal(this.route.data.pipe(map((d) => d as Record<string, unknown>)), {
    initialValue: this.route.snapshot.data as Record<string, unknown>,
  });

  readonly ref = computed(() => routeObjectRef(this.data(), this.params()));
  readonly pageKind = computed(() => objectPageKind(this.ref().kind === 'other' ? '' : this.ref().kind));
  readonly resourceKind = computed(() => {
    const kind = this.ref().kind;

    switch (kind) {
      case 'cluster':
        return 'Cluster';
      case 'site':
        return 'Site';
      case 'node':
        return 'Node';
      case 'project':
        return 'Project';
      default:
        return this.context.resourceKind(kind);
    }
  });
  readonly item = computed<WorkspaceItem | null>(() => this.context.itemFor(this.ref()));
  /** The resource behind the object (also before the model knows it). */
  readonly key = computed<ResourceKey | null>(() => {
    const ref = this.ref();

    if (this.item()?.resource) return this.item()?.resource ?? null;

    if (ref.kind === 'cluster' || !ref.name) return null;

    return { kind: this.resourceKind(), name: ref.name, project: ref.project };
  });
  readonly tabs = computed(() =>
    objectTabs(this.pageKind(), {
      infrastructure: this.context.infrastructure(),
      clusterAdmin: this.context.me()?.clusterRole === 'cluster-admin',
      fleetMode: this.context.endpoints.fleetMode,
      joinNodes: mayJoinNodes(this.context.me()?.clusterRole ?? null, this.context.endpoints.fleetMode),
      secrets: this.pageKind() === 'project' && mayManageSecrets(this.context.me(), this.ref().name ?? null),
    }),
  );
  readonly tab = computed<ObjectTabId>(() => resolveObjectTab(this.tabs(), this.query().get('tab')));
  readonly clusterResource = computed(
    () => this.context.resources().find((r) => r.kind === 'Cluster')?.metadata.name ?? null,
  );
  readonly body = computed<ObjectTabBody>(() =>
    objectTabBody(this.tab(), {
      pageKind: this.pageKind(),
      ref: this.ref(),
      key: this.key(),
      clusterResource: this.clusterResource(),
    }),
  );

  /** The embedded section page of the tab (3.38) and its key (section + scope). */
  readonly sectionScope = computed(() => {
    const body = this.body();

    if (body.type !== 'section') return { key: '', section: null, params: {} as Record<string, string> };

    return { key: `${body.section}?${JSON.stringify(body.params)}`, section: body.section, params: body.params };
  });
  readonly title = computed(() => {
    const ref = this.ref();

    // The cluster's human name (fleet name / display name), not its id (D11, LW-02).
    return ref.kind === 'cluster'
      ? (this.context.clusterName() ?? this.clusterResource() ?? this.clusterLabel)
      : (ref.name ?? '');
  });
  /** The kind under the title in words (D7): "Workload group", not `WorkloadGroup`. */
  readonly subtitle = computed(() => {
    const kind = this.resourceKind();

    return this.ref().kind === 'cluster' || !kind ? null : kindDisplayName(kind);
  });
  readonly changed = computed(() => {
    const item = this.item();

    return !!item && this.context.changedIds().has(item.id);
  });
  readonly crumbs = computed<FpcCrumb[]>(() => {
    const ref = this.ref();
    const home: FpcCrumb = consoleHomeCrumb();

    if (ref.kind === 'cluster') return [home, { label: this.title() }];

    const item = this.item();
    const model = this.context.model();
    const trail: FpcCrumb[] = [home];

    if (ref.project && ref.kind !== 'project')
      trail.push({ label: ref.project, link: ['/resources', 'project', ref.project] });

    if (item) {
      for (const id of workspaceAncestors(model, item.id).reverse()) {
        const ancestor = model.byId.get(id);
        const route = ancestor ? objectRoute(ancestor) : null;

        if (ancestor && (ancestor.kind === 'site' || ancestor.kind === 'node'))
          trail.push({ label: ancestor.label, link: route ? [...route] : null });
      }
    }

    return [...trail, { label: this.title() }];
  });

  /** Actions of the object (without links: the tabs are the links now). */
  readonly actions = computed<WorkspaceAction[]>(() => {
    const item = this.item();

    return item ? this.context.actionsOf(item).filter((a) => a.group !== 'link') : [];
  });
  /** Inline header actions: quiet icon buttons; destructive ones (remove, drain, …) only in More (3.38 R8, LW-06). */
  readonly primary = computed(() =>
    this.actions()
      .filter((a) => a.group === 'act' && !a.confirm?.danger)
      .slice(0, PRIMARY_ACTIONS),
  );
  readonly moreItems = computed<FpcMenuItem[]>(() => {
    const primary = new Set(this.primary().map((a) => a.id));
    const items = actionMenuItems([
      // The cluster has no workspace item: its "Edit in draft" (the Cluster resource) comes first, like everywhere.
      ...(this.clusterKey() && this.canEdit() ? [this.clusterEditAction] : []),
      ...this.actions().filter((a) => !primary.has(a.id)),
    ]);
    const clusterId = this.ref().kind === 'cluster' ? this.context.clusterId() : null;

    // The cluster's id stays reachable without being the title (D11, LW-02).
    return clusterId ? [...items, { ...fpcCopyIdMenuItem(this.copyIdLabel), dividerBefore: items.length > 0 }] : items;
  });
  /** The cluster page edits the `Cluster` resource (2026-10-29: instead of the read-only Options tab). */
  readonly clusterKey = computed<ResourceKey | null>(() => {
    const name = this.clusterResource();

    return this.ref().kind === 'cluster' && name ? { kind: 'Cluster', name, project: null } : null;
  });
  /** The object's "Edit in draft" action exists (role gating of `workspaceActions()`; the cluster: cluster admins). */
  readonly canEdit = computed(() => {
    const cluster = this.clusterKey();

    if (cluster) return mayDraftResource(cluster, this.context.access());

    return this.actions().some((a) => a.id === 'edit' && a.group === 'draft');
  });
  /** "Join node": the cluster and its sites, for the roles that may (3.21). */
  readonly joinable = computed(
    () =>
      (this.ref().kind === 'cluster' || this.ref().kind === 'site') &&
      mayJoinNodes(this.context.me()?.clusterRole ?? null, this.context.endpoints.fleetMode),
  );
  readonly mayJoin = computed(() => this.joinable() && this.ref().kind === 'cluster');
  readonly siteNames = computed(() =>
    this.context
      .model()
      .items.filter((i) => i.kind === 'site')
      .map((i) => i.label)
      .sort(),
  );
  /** The site's summary bar (LW-23): nodes healthy, objects placed there, objects with problems. */
  readonly siteSummary = computed(() => {
    const name = this.ref().name;

    if (this.ref().kind !== 'site' || !name) return null;

    const model = this.context.model();
    const nodes = model.items.filter((i) => i.kind === 'node' && i.placement === name);
    const contents = contentsRows(model, { kind: 'site', name }).filter((i) => i.kind !== 'node');
    const bad = (health: string | null | undefined) => !!health && !['healthy', 'unknown'].includes(health);

    return {
      nodes: nodes.length,
      nodesHealthy: nodes.filter((n) => n.health === 'healthy').length,
      objects: contents.length,
      problems: [...nodes, ...contents].filter((i) => bad(i.health)).length,
    };
  });

  readonly clusterLabel = $localize`:@@lwConsoleResources-cluster:Cluster`;
  readonly copyIdLabel = $localize`:@@lwConsoleDataList-copyId:Copy ID`;
  private readonly clusterEditAction: WorkspaceAction = {
    id: 'edit',
    group: 'draft',
    label: $localize`:@@lwConsoleWorkspace-actionEdit:Edit in draft`,
    icon: 'bi-pencil',
    shortcut: 'e',
  };
  readonly changedLabel = $localize`:@@lwConsoleResources-changed:Changed in the draft`;
  readonly moreLabel = $localize`:@@lwConsoleContents-more:More`;
  readonly crumbsLabel = $localize`:@@lwConsoleObject-crumbs:Location`;
  readonly tabsLabel = $localize`:@@lwConsoleObject-tabs:Object tabs`;
  readonly joinLabel = $localize`:@@lwConsoleObject-join:Join node`;
  readonly nodesLabel = $localize`:@@lwConsoleObject-nodesUp:Nodes healthy`;
  readonly siteObjectsLabel = $localize`:@@lwConsoleObject-siteObjects:Workloads and objects`;
  readonly siteProblemsLabel = $localize`:@@lwConsoleObject-siteProblems:With problems`;
  readonly tone = workspaceHealthTone;
  readonly healthIcon = workspaceHealthIcon;
  readonly healthLabel = workspaceHealthLabel;

  /** `?join=1` (site "Add a node", old `/nodes?join=` links) opens the dialog once the role allows it. */
  private readonly pendingJoin = signal(false);

  constructor() {
    effect(() => {
      if (this.query().get('join')) untracked(() => this.pendingJoin.set(true));
    });
    effect(() => {
      const tokens = this.joinTokens();

      if (this.pendingJoin() && tokens && this.joinable())
        untracked(() => {
          this.pendingJoin.set(false);
          tokens.open(this.ref().kind === 'site' ? this.ref().name : null);
        });
    });
  }

  selectTab(id: string | null): void {
    if (!id || id === this.tab()) return;

    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: id === 'summary' ? null : id } });
  }

  run(action: WorkspaceAction): void {
    if (action.join) {
      this.joinTokens()?.open(action.join.site);

      return;
    }

    this.context.run(action, this.item());
  }

  onMore(entry: FpcMenuItem): void {
    const clusterId = this.context.clusterId();

    if (entry.id === 'copy-id' && clusterId) {
      fpcCopyText(clusterId);

      return;
    }

    const cluster = this.clusterKey();

    if (entry.id === 'edit' && cluster) {
      this.resourceModal.openEdit(cluster);

      return;
    }

    const action = this.actions().find((a) => a.id === entry.id);

    if (action) this.run(action);
  }

  /** `e` opens the edit modal, `Del` deletes into the draft (3.37 shortcuts; not while typing). */
  onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;

    const key = this.key() ?? this.clusterKey();

    if (event.key === 'e' && key && this.canEdit()) {
      event.preventDefault();
      this.resourceModal.openEdit(key);
    } else if (event.key === 'Delete') {
      const del = this.actions().find((a) => a.id === 'delete' && a.group === 'draft');

      if (del) {
        event.preventDefault();
        this.run(del);
      }
    }
  }

  openJoin(): void {
    this.joinTokens()?.open(null);
  }
}
