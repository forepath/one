import type {
  ClusterRole,
  ConsoleNode,
  NodeAction,
  ProjectRole,
  VmAction,
} from '@forepath/loadweaver/frontend/data-access-console';

import { healthLink } from '../health/health-format';
import {
  actionConfirmMessage,
  actionDangerous,
  actionIcon,
  actionLabel,
  mayJoinNodes,
  mayOperateNodes,
  nodeActions,
} from '../nodes/node-format';
import { workloadMetricsEntity } from '../metrics/metrics-format';
import { objectRoute } from '../objects/object-route';
import { vmActionConfirmMessage, vmActionDangerous, vmActionIcon, vmActionLabel } from '../virtual-machines/vm-format';
import { replicaParts, type WorkspaceItem } from './workspace-model';

/**
 * One registry of what can be done with a Workspace item (3.36): the popover, the side panel, the table's row actions
 * and the keyboard shortcuts all read it. Hidden when the role can never do it, disabled with a reason when it can't
 * right now; fleet mode follows the relay's rules; native-only actions open the cluster's own console.
 */
export type WorkspaceActionGroup = 'link' | 'act' | 'draft';

export interface WorkspaceAction {
  id: string;
  group: WorkspaceActionGroup;
  label: string;
  icon: string;
  /** Needs the existing confirm dialog (disruptive immediate actions, 3.36 decision 10). */
  confirm?: { message: string; danger: boolean };
  /** Router target of links (and "open in the cluster's console" for native-only actions). */
  route?: string[];
  queryParams?: Record<string, string>;
  disabled?: boolean;
  reason?: string;
  /** Not relayed through the fleet: offered as a link to the cluster's own console instead. */
  nativeOnly?: boolean;
  /** Keyboard shortcut in the Workspace (single key, no modifier). */
  shortcut?: string;
  /** Immediate action payloads. */
  node?: { name: string; action: NodeAction };
  vm?: { project: string; name: string; action: VmAction | 'snapshot' };
  /** Backup now of a volume (`project/deployment/volume`). */
  backup?: { volume: string };
  /** Opens the "Add a node" dialog (join token) for a site. */
  join?: { site: string };
  /** Manual DNS fail-back of a `DnsFailover` (3.28). */
  failback?: { name: string };
}

export interface WorkspaceAccess {
  clusterRole: ClusterRole | null;
  projects: Readonly<Record<string, ProjectRole>>;
  fleetMode: boolean;
  /** Fleet read-only grace (3.24): no changes at all. */
  readOnly?: boolean;
}

/** Runtime facts the page knows from other lists (node lifecycle, the VM's offered actions). */
export interface WorkspaceRuntime {
  node?: Pick<ConsoleNode, 'name' | 'lifecycle' | 'connected'>;
  vmActions?: readonly VmAction[];
  /** A `DnsFailover` waits for its manual fail-back. */
  failbackPending?: boolean;
}

const RANK: Record<ProjectRole, number> = { viewer: 0, developer: 1, operator: 2, admin: 3 };

function projectRoleOf(access: WorkspaceAccess, project: string): ProjectRole | undefined {
  return access.clusterRole === 'cluster-admin' ? 'admin' : access.projects[project];
}

function atLeast(role: ProjectRole | undefined, minimum: ProjectRole): boolean {
  return !!role && RANK[role] >= RANK[minimum];
}

/** Kinds whose cluster-level changes need a cluster admin (else infra operators may plan them, 3.17). */
const ADMIN_KINDS = new Set(['Cluster', 'Project']);

/** Whether the caller may put changes of this item into a draft (= may plan them). */
export function mayDraft(item: WorkspaceItem, access: WorkspaceAccess): boolean {
  return !!item.resource && mayDraftResource(item.resource, access);
}

/** Whether the caller may create / edit a resource of `kind` in `project` (null = cluster-level) in a draft. */
export function mayDraftResource(resource: { kind: string; project: string | null }, access: WorkspaceAccess): boolean {
  if (access.readOnly) return false;

  if (resource.project) return atLeast(projectRoleOf(access, resource.project), 'developer');

  return ADMIN_KINDS.has(resource.kind)
    ? access.clusterRole === 'cluster-admin'
    : access.clusterRole === 'cluster-admin' || access.clusterRole === 'infra-operator';
}

/** Whether the caller may create anything at all (Create ▾): a cluster role or developer+ in some project. */
export function mayCreateResources(access: WorkspaceAccess): boolean {
  if (access.readOnly) return false;

  return (
    access.clusterRole === 'cluster-admin' ||
    access.clusterRole === 'infra-operator' ||
    Object.values(access.projects).some((role) => atLeast(role, 'developer'))
  );
}

/** Where an item's "open full page" goes: its object page (3.37). */
export function workspaceFullPage(
  item: WorkspaceItem,
): { route: string[]; queryParams?: Record<string, string> } | null {
  const route = objectRoute(item);

  return route ? { route: [...route] } : null;
}

function link(id: string, label: string, icon: string, route: string, queryParams?: Record<string, string>) {
  return { id, group: 'link' as const, label, icon, route: [route], ...(queryParams ? { queryParams } : {}) };
}

function idOf(item: WorkspaceItem): string {
  return item.id.slice(item.id.indexOf(':') + 1);
}

/** Deep links to the special pages (logs, metrics, health, terminal, files, VM console, backups, …). */
function links(item: WorkspaceItem): WorkspaceAction[] {
  const id = idOf(item);
  const health = (key: string) =>
    link('health', $localize`:@@lwConsoleWorkspace-actionHealth:Health`, 'bi-heart-pulse', healthLink(key));
  const logs = (queryParams: Record<string, string>) =>
    link('logs', $localize`:@@lwConsoleWorkspace-actionLogs:Logs`, 'bi-journal-text', '/observe/logs', queryParams);
  const metrics = (queryParams: Record<string, string>) =>
    link(
      'metrics',
      $localize`:@@lwConsoleWorkspace-actionMetrics:Metrics`,
      'bi-graph-up',
      '/observe/metrics',
      queryParams,
    );
  // The metrics page filters by `entity` (replica ids `<project>/<deployment>/<service>/<index>`), not by deployment.
  const metricsScoped = (project: string | null | undefined, deployment: string, service: string) => {
    const entity = workloadMetricsEntity(project, deployment, service);

    return metrics(entity ? { project: project as string, entity } : project ? { project } : {});
  };
  const terminal = (replica: string) =>
    link('terminal', $localize`:@@lwConsoleWorkspace-actionTerminal:Terminal`, 'bi-terminal', '/operate/terminals', {
      replica,
    });
  const files = (target: string) =>
    link('files', $localize`:@@lwConsoleWorkspace-actionFiles:Files`, 'bi-folder2-open', '/operate/files', { target });
  const backups = (queryParams: Record<string, string>) =>
    link(
      'backups',
      $localize`:@@lwConsoleWorkspace-actionBackups:Backups`,
      'bi-archive',
      '/operate/backups',
      queryParams,
    );

  switch (item.kind) {
    case 'site':
      return [health(`site/${id}`)];
    case 'node':
      return [logs({ node: id }), metrics({ node: id }), health(`node/${id}`)];
    case 'replica': {
      const { project, deployment, service } = replicaParts(id);

      return [
        logs({ project, deployment, service, replica: id }),
        health(`replica/${id}`),
        terminal(id),
        files(`replica:${id}`),
      ];
    }
    case 'stack':
    case 'service': {
      const { deployment, service } = item.data as { deployment: string; service: string };
      const first = item.elements[0];

      return [
        logs({ project: item.project ?? '', deployment, service }),
        metricsScoped(item.project, deployment, service),
        ...(first ? [terminal(first.replace(/^replica:/, ''))] : []),
        backups({ project: item.project ?? '', resource: deployment }),
      ];
    }
    case 'deployment':
      return [
        logs({ project: item.project ?? '', deployment: item.label }),
        backups({ project: item.project ?? '', resource: item.label }),
      ];
    case 'vm': {
      const project = item.project ?? '';
      const consoleLink = {
        ...link('vm-console', $localize`:@@lwConsoleWorkspace-actionVmConsole:Console`, 'bi-display', ''),
        route: ['/resources', 'virtualmachine', project, item.label],
        queryParams: { tab: 'console' },
      };

      return [
        consoleLink,
        logs({ project, deployment: 'lw-vm', service: item.label }),
        backups({ project, resource: `lw-vm/${item.label}` }),
      ];
    }
    case 'volume':
      return [
        health(`volume/${id}`),
        files(`volume:${id}`),
        backups({ project: id.split('/')[0], resource: id.split('/').slice(1).join('/') }),
      ];
    case 'hostname':
      return [
        link('dns', $localize`:@@lwConsoleWorkspace-actionDns:DNS`, 'bi-globe2', '/delivery/dns', { q: item.label }),
        link(
          'certificates',
          $localize`:@@lwConsoleWorkspace-actionCertificates:Certificates`,
          'bi-patch-check',
          '/delivery/certificates',
          {
            q: item.label,
          },
        ),
      ];
    case 'policy':
      return [logs({ sources: 'firewall,proxy', policy: item.project ? `${item.project}/${item.label}` : item.label })];
    default:
      return [];
  }
}

/**
 * Immediate ("act now", 3.36 P2) actions: node lifecycle, joining nodes, VM power / snapshot / reimage, backup now,
 * DNS fail-back — the same rules (and confirm texts) as their pages; disruptive ones carry a confirm.
 */
function immediate(item: WorkspaceItem, access: WorkspaceAccess, runtime: WorkspaceRuntime): WorkspaceAction[] {
  if (access.readOnly) return [];

  if (item.kind === 'site' && mayJoinNodes(access.clusterRole, access.fleetMode))
    return [
      {
        id: 'join-node',
        group: 'act',
        label: $localize`:@@lwConsoleWorkspace-actionJoin:Add a node`,
        icon: 'bi-plus-circle',
        join: { site: item.label },
      },
    ];

  if (item.kind === 'volume' && item.project && atLeast(projectRoleOf(access, item.project), 'operator'))
    return [
      {
        id: 'backup-now',
        group: 'act',
        label: $localize`:@@lwConsoleWorkspace-actionBackupNow:Back up now`,
        icon: 'bi-cloud-arrow-up',
        backup: { volume: item.id.replace(/^volume:/, '') },
      },
    ];

  if (item.resource?.kind === 'DnsFailover' && runtime.failbackPending && mayOperateNodes(access.clusterRole))
    return [
      {
        id: 'dns-failback',
        group: 'act',
        label: $localize`:@@lwConsoleDns-failbackConfirm:Fail back`,
        icon: 'bi-arrow-counterclockwise',
        confirm: {
          message: $localize`:@@lwConsoleDns-failbackMessage:The primary endpoint is healthy again. DNS answers switch back to it.`,
          danger: false,
        },
        failback: { name: item.resource.name },
      },
    ];

  if (item.kind === 'node' && runtime.node)
    return nodeActions(runtime.node as ConsoleNode, access.clusterRole, access.fleetMode).map((action) => ({
      id: `node-${action}`,
      group: 'act',
      label: actionLabel(action),
      icon: actionIcon(action),
      // Every node lifecycle action asks first (as on the nodes page).
      confirm: { message: actionConfirmMessage(action, item.label), danger: actionDangerous(action) },
      node: { name: item.label, action },
    }));

  if (item.kind === 'vm' && item.project) {
    const project = item.project;
    const offered = runtime.vmActions ?? [];
    const power = offered.map(
      (action): WorkspaceAction => ({
        id: `vm-${action}`,
        group: 'act',
        label: vmActionLabel(action),
        icon: vmActionIcon(action),
        ...(vmActionDangerous(action) || action === 'reimage'
          ? { confirm: { message: vmActionConfirmMessage(action), danger: true } }
          : {}),
        vm: { project, name: item.label, action },
      }),
    );
    const snapshot: WorkspaceAction[] = atLeast(projectRoleOf(access, project), 'operator')
      ? [
          {
            id: 'vm-snapshot',
            group: 'act',
            label: $localize`:@@lwConsoleWorkspace-actionSnapshot:Snapshot`,
            icon: 'bi-camera',
            vm: { project, name: item.label, action: 'snapshot' },
          },
        ]
      : [];

    return [...power, ...snapshot];
  }

  return [];
}

/** Draft actions (3.36): edits never apply, they go into the draft. */
function draft(item: WorkspaceItem, access: WorkspaceAccess): WorkspaceAction[] {
  if (!mayDraft(item, access) || item.kind === 'replica' || item.kind === 'stack') return [];

  const actions: WorkspaceAction[] = [
    {
      id: 'edit',
      group: 'draft',
      label: $localize`:@@lwConsoleWorkspace-actionEdit:Edit in draft`,
      icon: 'bi-pencil',
      shortcut: 'e',
    },
  ];

  // Joined nodes and the cluster leave through their lifecycle, not by deleting the resource.
  if (item.resource && item.resource.kind !== 'Node' && item.resource.kind !== 'Cluster')
    actions.push({
      id: 'delete',
      group: 'draft',
      label: $localize`:@@lwConsoleWorkspace-actionDelete:Delete in draft`,
      icon: 'bi-trash',
      shortcut: 'Delete',
    });

  return actions;
}

/** Every action of an item, grouped link → act → draft; the full-page link last. */
export function workspaceActions(
  item: WorkspaceItem,
  access: WorkspaceAccess,
  runtime: WorkspaceRuntime = {},
): WorkspaceAction[] {
  const fullPage = workspaceFullPage(item);

  return [
    ...links(item),
    ...immediate(item, access, runtime),
    ...draft(item, access),
    ...(fullPage
      ? [
          {
            id: 'full-page',
            group: 'link' as const,
            label: $localize`:@@lwConsoleWorkspace-actionFullPage:Open full page`,
            icon: 'bi-box-arrow-up-right',
            ...fullPage,
          },
        ]
      : []),
  ];
}
