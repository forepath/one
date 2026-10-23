/** The topology map (3.9): `GET /topology`, `GET /topology/trace`, `socket/topology`. */

export type TopologyElementKind =
  | 'site'
  | 'node'
  | 'replica'
  | 'group'
  | 'volume'
  | 'hostname'
  | 'address'
  | 'external';
export type TopologyEdgeKind = 'tunnel' | 'policy' | 'member' | 'flow' | 'volume' | 'exposure' | 'address';
/** The layers the map toggles. */
export type TopologyLayer = 'tunnels' | 'policies' | 'storage' | 'dns' | 'addressing';
export type TopologyChange = 'create' | 'update' | 'delete';

/** Sites ⊃ nodes ⊃ replicas (`parent`), groups, volumes, hostnames, addresses, outside peers. */
export interface TopologyElement {
  id: string;
  kind: TopologyElementKind;
  label: string;
  parent?: string;
  project?: string | null;
  data: Record<string, unknown>;
}

/**
 * Tunnels, policy edges, group membership, flows, volume copies, exposures, address holders. Flow edges carry
 * `protocol`, `port`, `decision` (`allowed` / `observed` / `denied`), `policy`, `packets`, `bytes`,
 * `bytesPerSecond`, `estimated`; proposed policy edges of a plan `proposed: true`.
 */
export interface TopologyEdge {
  id: string;
  kind: TopologyEdgeKind;
  source: string;
  target: string;
  layer: TopologyLayer;
  data: Record<string, unknown>;
}

/** `GET /topology`: `at` is the time the flows are for; `overlay` marks what a plan changes. */
export interface TopologyGraph {
  elements: TopologyElement[];
  edges: TopologyEdge[];
  at: string;
  overlay?: Record<string, TopologyChange>;
}

export interface TopologyQuery {
  /** Timeline: the flows of the minute before this time. */
  at?: string;
  /** Plan overlay (a pending plan's id). */
  plan?: string;
  /** With flows (cluster roles only; ignored for project members). */
  flows?: boolean;
}

export interface TopologyTraceStep {
  kind: string;
  id: string;
  label: string;
}

/** `GET /topology/trace?host=`: hostname → ingress addresses → replicas (on nodes) → volumes. */
export interface TopologyTrace {
  steps: TopologyTraceStep[];
}

/** `socket/topology` `flows`: the flow edges of the last minute, every 10 s after `subscribe`. */
export interface TopologyFlowsEvent {
  at: string;
  edges: TopologyEdge[];
}
