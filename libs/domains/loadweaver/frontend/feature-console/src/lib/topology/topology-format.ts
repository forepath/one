import type {
  TopologyChange,
  TopologyEdge,
  TopologyElement,
  TopologyGraph,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcGraphEdge, FpcGraphElement } from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';
import { healthLink } from '../health/health-format';

/** The map's switchable layers: the API's edge layers, plus traffic (flow edges). */
export type TopologyMapLayer = 'tunnels' | 'policies' | 'storage' | 'dns' | 'addressing' | 'traffic';

export const TOPOLOGY_MAP_LAYERS: TopologyMapLayer[] = [
  'traffic',
  'policies',
  'tunnels',
  'storage',
  'dns',
  'addressing',
];

/** Canvas kinds per layer (`hiddenKinds` hides elements and edges of these kinds). */
export const TOPOLOGY_LAYER_KINDS: Record<TopologyMapLayer, string[]> = {
  traffic: ['flow', 'denied'],
  policies: ['policy', 'monitor', 'proposed', 'member'],
  tunnels: ['tunnel'],
  storage: ['volume'],
  dns: ['exposure', 'hostname'],
  addressing: ['address'],
};

export function topologyLayerLabel(layer: TopologyMapLayer): string {
  switch (layer) {
    case 'traffic':
      return $localize`:@@lwConsoleTopology-layerTraffic:Traffic`;
    case 'policies':
      return $localize`:@@lwConsoleTopology-layerPolicies:Policies`;
    case 'tunnels':
      return $localize`:@@lwConsoleTopology-layerTunnels:Tunnels`;
    case 'storage':
      return $localize`:@@lwConsoleTopology-layerStorage:Storage`;
    case 'dns':
      return $localize`:@@lwConsoleTopology-layerDns:DNS`;
    default:
      return $localize`:@@lwConsoleTopology-layerAddressing:Addressing`;
  }
}

/** The kinds of the switched-off layers. */
export function topologyHiddenKinds(enabled: ReadonlySet<TopologyMapLayer>): string[] {
  return TOPOLOGY_MAP_LAYERS.filter((layer) => !enabled.has(layer)).flatMap((layer) => TOPOLOGY_LAYER_KINDS[layer]);
}

/** The canvas kind of an edge: denied flows red, monitor policies and a plan's proposed edges dashed. */
export function topologyEdgeKind(edge: TopologyEdge): string {
  if (edge.kind === 'flow') return edge.data['decision'] === 'denied' ? 'denied' : 'flow';

  if (edge.kind === 'policy') {
    if (edge.data['proposed']) return 'proposed';

    return edge.data['mode'] === 'monitor' ? 'monitor' : 'policy';
  }

  return edge.kind;
}

/** The map as canvas inputs; flows weighted by KiB/s, animated while live. */
export function topologyCanvas(
  graph: TopologyGraph | null,
  animated: boolean,
): { elements: FpcGraphElement[]; edges: FpcGraphEdge[] } {
  if (!graph) return { elements: [], edges: [] };

  return {
    elements: graph.elements.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      parent: e.parent ?? null,
      data: { ...e.data, project: e.project ?? null },
    })),
    edges: graph.edges.map((e) => {
      const flow = e.kind === 'flow';
      const rate = Number(e.data['bytesPerSecond'] ?? 0);

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: topologyEdgeKind(e),
        ...(flow ? { weight: rate / 1024, animated } : {}),
        data: { ...e.data, layer: e.layer },
      };
    }),
  };
}

/** Plan overlay plus the traced path (marked as `update` where the plan doesn't mark it). */
export function topologyHighlight(
  overlay: Record<string, TopologyChange> | null,
  traced: readonly string[],
): Record<string, TopologyChange> | null {
  if (!overlay && traced.length === 0) return null;

  const result: Record<string, TopologyChange> = { ...(overlay ?? {}) };

  for (const id of traced) result[id] ??= 'update';

  return result;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

/** A link from the map's side panel to another view. */
export interface TopologyLink {
  label: string;
  icon: string;
  route: string;
  queryParams?: Record<string, string>;
}

/**
 * Where the policy resources are edited (the resources view). Kept in one place: the route belongs to that view.
 */
export function policyResourceLink(policy: string): TopologyLink {
  const [project, name] = policy.includes('/') ? policy.split('/', 2) : [null, policy];

  return {
    label: $localize`:@@lwConsoleTopology-linkPolicy:Policy ${policy}:policy:`,
    icon: 'bi-shield-check',
    route: `/policies/${name}`,
    ...(project ? { queryParams: { project } } : {}),
  };
}

function logsLink(queryParams: Record<string, string>, label?: string): TopologyLink {
  return {
    label: label ?? $localize`:@@lwConsoleTopology-linkLogs:Logs`,
    icon: 'bi-journal-text',
    route: '/logs',
    queryParams,
  };
}

function healthEntityLink(key: string): TopologyLink {
  return { label: $localize`:@@lwConsoleTopology-linkHealth:Health`, icon: 'bi-heart-pulse', route: healthLink(key) };
}

/** Links of a map element: health, its logs; a replica's terminal and files, a volume's files. */
export function topologyElementLinks(element: TopologyElement): TopologyLink[] {
  const id = element.id.slice(element.id.indexOf(':') + 1);

  switch (element.kind) {
    case 'replica': {
      const [project, deployment, service] = id.split('/');

      return [
        logsLink({ project, deployment, service, replica: id }),
        logsLink(
          { project, deployment, service },
          $localize`:@@lwConsoleTopology-linkServiceLogs:Logs of service ${service}:service:`,
        ),
        healthEntityLink(`replica/${id}`),
        {
          label: $localize`:@@lwConsoleTopology-linkTerminal:Terminal`,
          icon: 'bi-terminal',
          route: '/terminals',
          queryParams: { replica: id },
        },
        {
          label: $localize`:@@lwConsoleTopology-linkFiles:Files`,
          icon: 'bi-folder2-open',
          route: '/files',
          queryParams: { target: `replica:${id}` },
        },
      ];
    }
    case 'node':
      return [logsLink({ node: id }), healthEntityLink(`node/${id}`)];
    case 'site':
      return [healthEntityLink(`site/${id}`)];
    case 'volume':
      return [
        logsLink({ sources: 'storage', project: id.split('/')[0] }),
        healthEntityLink(`volume/${id}`),
        {
          label: $localize`:@@lwConsoleTopology-linkFiles:Files`,
          icon: 'bi-folder2-open',
          route: '/files',
          queryParams: { target: `volume:${id}` },
        },
      ];
    default:
      return [];
  }
}

/** Links of a map edge: the policy and its decisions, a flow's firewall decisions around its time, tunnel logs. */
export function topologyEdgeLinks(edge: TopologyEdge, at: string | null): TopologyLink[] {
  const policy =
    typeof edge.data['policy'] === 'string' && edge.data['policy'] ? (edge.data['policy'] as string) : null;

  if (edge.kind === 'flow') {
    const range: Record<string, string> = {};

    if (at) {
      const to = new Date(at);

      range['from'] = new Date(to.getTime() - 5 * 60_000).toISOString();
      range['to'] = new Date(to.getTime() + 60_000).toISOString();
    }

    return [
      logsLink(
        { sources: 'firewall,proxy', ...(policy ? { policy } : {}), ...range },
        $localize`:@@lwConsoleTopology-linkDecisions:Firewall / proxy decisions`,
      ),
      ...(policy ? [policyResourceLink(policy)] : []),
    ];
  }

  if (edge.kind === 'policy' && policy)
    return [
      policyResourceLink(policy),
      logsLink(
        { sources: 'firewall,proxy', policy },
        $localize`:@@lwConsoleTopology-linkPolicyLogs:Decisions of this policy`,
      ),
    ];

  if (edge.kind === 'tunnel') return [logsLink({ sources: 'tunnel', node: edge.source.slice('node:'.length) })];

  return [];
}

/** Readable detail rows of `data` (scalars and lists of scalars). */
export function topologyDetails(data: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .filter(([, v]) => typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object')))
    .map(([key, v]) => ({
      key,
      value:
        key === 'bytesPerSecond'
          ? formatRate(Number(v))
          : key === 'bytes'
            ? formatBytes(Math.round(Number(v)))
            : typeof v === 'number' && !Number.isInteger(v)
              ? v.toFixed(1)
              : Array.isArray(v)
                ? v.join(', ')
                : String(v),
    }));
}
