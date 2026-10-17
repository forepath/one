/** Built-in node kinds with a dedicated style. Any other string renders as a generic node. */
export type FpcGraphElementKind =
  | 'site'
  | 'node'
  | 'replica'
  | 'group'
  | 'volume'
  | 'hostname'
  | 'address'
  | 'external'
  | (string & Record<never, never>);

/** Built-in edge kinds with a dedicated style. Any other string renders as a solid edge. */
export type FpcGraphEdgeKind = 'proposed' | 'monitor' | 'denied' | (string & Record<never, never>);

/** Overlay mark for planned changes (e.g. a plan preview). */
export type FpcGraphHighlight = 'create' | 'update' | 'delete';

/** Built-in Cytoscape layouts (no layout extensions). */
export type FpcGraphLayout = 'cose' | 'breadthfirst' | 'grid' | 'concentric';

/** A graph node. Set `parent` to nest it inside another element (compound node, drawn as a box). */
export interface FpcGraphElement {
  id: string;
  label?: string | null;
  kind?: FpcGraphElementKind | null;
  /** Id of the containing element; ignored when that element is not part of `elements`. */
  parent?: string | null;
  /** Extra Cytoscape classes (space separated string or list). */
  classes?: string | readonly string[] | null;
  /** Arbitrary payload, returned with selection events. */
  data?: Record<string, unknown> | null;
}

/** A directed edge between two elements. */
export interface FpcGraphEdge {
  /** Defaults to `source->target` (plus `:kind` when set). */
  id?: string | null;
  source: string;
  target: string;
  kind?: FpcGraphEdgeKind | null;
  label?: string | null;
  classes?: string | readonly string[] | null;
  /** Relative weight; drives the line width (log-scaled, 1–8 px). */
  weight?: number | null;
  /** Animated marching dashes (e.g. live traffic). */
  animated?: boolean | null;
  data?: Record<string, unknown> | null;
}

export interface FpcGraphElementSelectEvent {
  id: string;
  kind: string | null;
  data: Record<string, unknown>;
}

export interface FpcGraphEdgeSelectEvent {
  id: string;
  kind: string | null;
  source: string;
  target: string;
  data: Record<string, unknown>;
}

/** `highlight` input: id → change mark. Accepts a `Map` or a plain record. */
export type FpcGraphHighlightMap = ReadonlyMap<string, FpcGraphHighlight> | Readonly<Record<string, FpcGraphHighlight>>;

/** `hiddenKinds` input: kinds (of elements or edges) that are hidden, i.e. switched-off layers. */
export type FpcGraphHiddenKinds = ReadonlySet<string> | readonly string[];
