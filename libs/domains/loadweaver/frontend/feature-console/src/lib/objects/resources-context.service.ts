import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  ConsoleDnsFacade,
  ConsoleEndpointService,
  ConsoleFleetFacade,
  ConsoleNodesFacade,
  ConsoleResourcesFacade,
  ConsoleTopologyFacade,
  ConsoleVirtualMachinesFacade,
  type ConsoleNode,
  type ConsoleResource,
  type FleetCluster,
  type ResourceKindInfo,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcMenuItem } from '@forepath/shared/frontend/ui-components';
import { interval, of } from 'rxjs';

import { workspaceActions, type WorkspaceAccess, type WorkspaceAction } from '../workspace/workspace-actions';
import { draftChanges, draftOpKey, draftResources } from '../workspace/workspace-draft';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import {
  workspaceItemChange,
  workspaceModel,
  workspaceResourceId,
  type WorkspaceItem,
} from '../workspace/workspace-model';
import { CLUSTER_SCOPE } from './object-route';
import { ResourceModalService } from './resource-modal.service';

/** Re-poll of the structure while no live socket announces changes. */
const REFRESH_MS = 30_000;

/** The object an `/resources/...` route stands for. */
export interface ResourceObjectRef {
  /** `cluster`, `site`, `node`, `project` or a resource kind as the URL has it (lower-case). */
  kind: string;
  project: string | null;
  name: string | null;
}

/** Menu items of a set of actions (ids are the action ids). */
export function actionMenuItems(actions: readonly WorkspaceAction[]): FpcMenuItem[] {
  return actions.map((action, index) => ({
    id: action.id,
    label: action.label,
    icon: action.icon.replace(/^bi-/, ''),
    disabled: !!action.disabled,
    danger: !!action.confirm?.danger || action.id === 'delete',
    title: action.reason,
    dividerBefore: index > 0 && actions[index - 1].group !== action.group,
  }));
}

/**
 * The data behind Resources (3.37): topology + declared resources → `workspaceModel()` for the tree, the object pages
 * and Contents; the caller's access; the action registry (`workspaceActions()`) and its runner (links navigate,
 * disruptive actions wait for `pending` to be confirmed, draft actions go into the active draft). Provided by the
 * Resources shell, shared by its object pages.
 */
@Injectable()
export class ResourcesContextService {
  private readonly topology = inject(ConsoleTopologyFacade);
  private readonly resourcesFacade = inject(ConsoleResourcesFacade);
  private readonly nodesFacade = inject(ConsoleNodesFacade);
  private readonly vmsFacade = inject(ConsoleVirtualMachinesFacade);
  private readonly backupsFacade = inject(ConsoleBackupsFacade);
  private readonly dnsFacade = inject(ConsoleDnsFacade);
  private readonly accessFacade = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);
  private readonly resourceModal = inject(ResourceModalService);
  readonly endpoints = inject(ConsoleEndpointService);
  /** The draft (app-wide once the draft tray lands, 3.37 P3); without one nothing is marked. */
  readonly draft = inject(WorkspaceDraftStore, { optional: true });

  readonly graph = toSignal(this.topology.graph$, { initialValue: null });
  readonly loading = toSignal(this.topology.loading$, { initialValue: false });
  readonly resources = toSignal(this.resourcesFacade.resources$, { initialValue: [] as ConsoleResource[] });
  readonly kinds = toSignal(this.resourcesFacade.kinds$, { initialValue: [] as ResourceKindInfo[] });
  readonly nodes = toSignal(this.nodesFacade.nodes$, { initialValue: [] as ConsoleNode[] });
  readonly me = toSignal(this.accessFacade.me$, { initialValue: null });
  /** `GET /cluster` (loaded with the nodes): the cluster's id and display name. */
  private readonly clusterSummary = toSignal(this.nodesFacade.cluster$, { initialValue: null });
  /** The built-in control-plane member (3.39), for its read-only entry next to the nodes. */
  readonly builtinMember = computed(() => this.clusterSummary()?.controlPlane.builtin ?? null);
  /** Fleet mode: the fleet's clusters (route-provided; absent outside the console routes). */
  private readonly fleetClusters = toSignal<FleetCluster[], FleetCluster[]>(
    inject(ConsoleFleetFacade, { optional: true })?.clusters$ ?? of<FleetCluster[]>([]),
    { initialValue: [] },
  );
  /** The cluster's id (Copy ID): the fleet's cluster id in fleet mode, else the control plane's cluster id. */
  readonly clusterId = computed<string | null>(
    () => this.endpoints.activeClusterId() ?? this.clusterSummary()?.clusterId ?? null,
  );
  /**
   * The cluster's human name (object page title, D11): the fleet's name for it in fleet mode (the top-bar chip, the
   * tree), else its display name; `null` while unknown.
   */
  readonly clusterName = computed<string | null>(() => {
    const active = this.endpoints.activeClusterId();
    const fleetName = active ? this.fleetClusters().find((c) => c.id === active)?.name : undefined;

    return fleetName || this.clusterSummary()?.displayName || null;
  });
  readonly infrastructure = toSignal(this.accessFacade.seesInfrastructure$, { initialValue: false });
  private readonly vmDetail = toSignal(this.vmsFacade.selected$, { initialValue: null });
  private readonly dnsOverview = toSignal(this.dnsFacade.overview$, { initialValue: null });
  private readonly liveConnected = toSignal(this.topology.liveConnected$, { initialValue: false });
  private readonly structureVersion = toSignal(this.topology.structureVersion$, { initialValue: null });

  /** The model as the active draft would leave the declared resources. */
  readonly model = computed(() =>
    workspaceModel(this.graph(), draftResources(this.resources(), this.draft?.active() ?? null)),
  );
  /** Items with a pending change in the active draft (● marks). */
  readonly changedIds = computed<ReadonlySet<string>>(() => {
    const active = this.draft?.active() ?? null;

    if (!active) return new Set();

    const existing = new Set(
      this.resources().map((r) =>
        draftOpKey({ kind: r.kind, name: r.metadata.name, project: r.metadata.project ?? null }),
      ),
    );
    const overlay = { ...(this.draft?.preview()?.topology.overlay ?? {}), ...draftChanges(active, existing) };

    return new Set(
      this.model()
        .items.filter((i) => workspaceItemChange(i, overlay))
        .map((i) => i.id),
    );
  });
  readonly access = computed<WorkspaceAccess>(() => ({
    clusterRole: this.me()?.clusterRole ?? null,
    projects: this.me()?.projects ?? {},
    fleetMode: this.endpoints.fleetMode,
  }));
  /** Projects the caller is a member of (cluster roles: every project of the model). */
  readonly projects = computed(() => {
    const me = this.me();

    if (me?.clusterRole) {
      return [
        ...new Set(
          this.model()
            .items.map((i) => i.project)
            .filter((p): p is string => !!p),
        ),
      ].sort();
    }

    return Object.keys(me?.projects ?? {}).sort();
  });

  /** A disruptive action waiting for its confirmation. */
  readonly pending = signal<WorkspaceAction | null>(null);
  private started = false;

  constructor() {
    // A new structure reloads the declared resources too.
    effect(() => {
      if (this.structureVersion()) untracked(() => this.resourcesFacade.load(true));
    });

    let dnsLoaded = false;

    effect(() => {
      if (this.infrastructure() && !dnsLoaded) {
        dnsLoaded = true;
        untracked(() => this.dnsFacade.load(true, true));
      }
    });

    // While the live socket is connected it announces structure changes; else re-poll.
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.started && !this.liveConnected()) this.reload(true);
      });
    inject(DestroyRef).onDestroy(() => this.topology.disconnectLive());
  }

  /** Loads everything once (the shell calls it on init). */
  start(): void {
    if (this.started) return;

    this.started = true;
    this.reload();
    this.resourcesFacade.loadKinds();

    if (this.infrastructure()) this.topology.connectLive();
  }

  reload(silent = false): void {
    this.topology.load({ flows: false }, silent);
    this.resourcesFacade.load(silent);
    this.nodesFacade.load(true);
  }

  /** The real resource kind of a lower-case URL kind (`virtualmachine` → `VirtualMachine`). */
  resourceKind(urlKind: string): string {
    const lower = urlKind.toLowerCase();

    return (
      this.kinds().find((k) => k.kind.toLowerCase() === lower)?.kind ??
      this.resources().find((r) => r.kind.toLowerCase() === lower)?.kind ??
      urlKind
    );
  }

  /** The model item an object route stands for (null for the cluster and unknown objects). */
  itemFor(ref: ResourceObjectRef): WorkspaceItem | null {
    const model = this.model();

    switch (ref.kind) {
      case 'cluster':
        return null;
      case 'site':
        return model.byId.get(`site:${ref.name}`) ?? null;
      case 'node':
        return model.byId.get(`node:${ref.name}`) ?? null;
      case 'project':
        return ref.name
          ? (model.byId.get(workspaceResourceId({ kind: 'Project', name: ref.name, project: null })) ?? null)
          : null;
      default: {
        if (!ref.name) return null;

        const kind = this.resourceKind(ref.kind);
        const project = ref.project && ref.project !== CLUSTER_SCOPE ? ref.project : null;

        return model.byId.get(workspaceResourceId({ kind, name: ref.name, project })) ?? null;
      }
    }
  }

  /** Every action of an item (runtime facts from the node list, the open VM, the DNS overview). */
  actionsOf(item: WorkspaceItem): WorkspaceAction[] {
    const node = item.kind === 'node' ? this.nodes().find((n) => n.name === item.label) : undefined;
    const detail = this.vmDetail();
    const vm =
      item.kind === 'vm' && detail?.project === item.project && detail?.name === item.label ? detail : undefined;
    const failover =
      item.resource?.kind === 'DnsFailover'
        ? this.dnsOverview()?.failovers?.find((f) => f.name === item.resource?.name)
        : undefined;

    // On an object page "Open full page" is the page itself.
    return workspaceActions(item, this.access(), {
      ...(node ? { node } : {}),
      ...(vm ? { vmActions: vm.actions } : {}),
      ...(failover ? { failbackPending: failover.state.failbackPending } : {}),
    }).filter((a) => a.id !== 'full-page');
  }

  /** Runs an action: links navigate, draft edits open the edit modal / delete into the draft, disruptive ones ask first. */
  run(action: WorkspaceAction, item: WorkspaceItem | null): void {
    if (action.disabled) return;

    if (action.group === 'draft' && item) {
      if (action.id === 'edit') {
        if (item.resource) this.resourceModal.openEdit(item.resource);
      } else if (action.id === 'delete' && item.resource) void this.draft?.remove(item.resource);

      return;
    }

    if (action.confirm) {
      this.pending.set(action);

      return;
    }

    this.execute(action);
  }

  confirmPending(): void {
    const action = this.pending();

    this.pending.set(null);

    if (action) this.execute(action);
  }

  cancelPending(): void {
    this.pending.set(null);
  }

  /** Runs an immediate action without asking (batch actions confirm once for all rows). */
  runNow(action: WorkspaceAction): void {
    if (!action.disabled && action.group === 'act') this.execute(action);
  }

  private execute(action: WorkspaceAction): void {
    if (action.node) this.nodesFacade.act(action.node.name, action.node.action);
    else if (action.vm) {
      const { project, name } = action.vm;

      if (action.vm.action === 'snapshot') this.vmsFacade.snapshot(project, name);
      else this.vmsFacade.act(project, name, action.vm.action);
    } else if (action.backup) this.backupsFacade.backupNow(action.backup.volume);
    else if (action.failback) this.dnsFacade.confirmFailback(action.failback.name);
    else if (action.join)
      void this.router.navigate(['/resources', 'site', action.join.site], { queryParams: { join: '1' } });
    else if (action.route) void this.router.navigate(action.route, { queryParams: action.queryParams ?? {} });
  }
}
