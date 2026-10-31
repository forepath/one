import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { TopologyEdge, TopologyElement, TopologyGraph } from '../../types/topology.types';
import type { ConsoleTopologyState } from './topology.reducer';

/**
 * The map with the newest live flows: they replace the graph's flow edges; endpoints the structure doesn't know
 * (outside addresses) become `external` elements, as `GET /topology?flows=true` does.
 */
export function mergeLiveFlows(graph: TopologyGraph, flows: readonly TopologyEdge[] | null): TopologyGraph {
  if (!flows) return graph;

  const known = new Set(graph.elements.map((e) => e.id));
  const externals: TopologyElement[] = [];

  for (const edge of flows)
    for (const id of [edge.source, edge.target])
      if (!known.has(id)) {
        known.add(id);
        externals.push({
          id,
          kind: 'external',
          label: id.startsWith('external:') ? id.slice('external:'.length) : id,
          data: {},
        });
      }

  return {
    ...graph,
    elements: externals.length > 0 ? [...graph.elements, ...externals] : graph.elements,
    edges: [...graph.edges.filter((e) => e.kind !== 'flow'), ...flows],
  };
}

export const selectConsoleTopologyState = createFeatureSelector<ConsoleTopologyState>('consoleTopology');

export const selectTopologyRawGraph = createSelector(selectConsoleTopologyState, (state) => state.graph);
export const selectTopologyLiveFlows = createSelector(selectConsoleTopologyState, (state) => state.liveFlows);
export const selectTopologyGraph = createSelector(selectTopologyRawGraph, selectTopologyLiveFlows, (graph, flows) =>
  graph ? mergeLiveFlows(graph, flows) : null,
);
export const selectTopologyQuery = createSelector(selectConsoleTopologyState, (state) => state.query);
export const selectTopologyLoading = createSelector(selectConsoleTopologyState, (state) => state.loading);
export const selectTopologyError = createSelector(selectConsoleTopologyState, (state) => state.error);
/** The time the shown flows are for: the newest live tick, else the graph's. */
export const selectTopologyAt = createSelector(
  selectConsoleTopologyState,
  (state) => state.liveAt ?? state.graph?.at ?? null,
);
export const selectTopologyOverlay = createSelector(selectTopologyRawGraph, (graph) => graph?.overlay ?? null);
export const selectTopologyLive = createSelector(selectConsoleTopologyState, (state) => state.live);
export const selectTopologyLiveConnected = createSelector(selectConsoleTopologyState, (state) => state.liveConnected);
export const selectTopologyLiveError = createSelector(selectConsoleTopologyState, (state) => state.liveError);
export const selectTopologyTraceHost = createSelector(selectConsoleTopologyState, (state) => state.traceHost);
export const selectTopologyTraceSteps = createSelector(selectConsoleTopologyState, (state) => state.traceSteps);
export const selectTopologyTraceLoading = createSelector(selectConsoleTopologyState, (state) => state.traceLoading);
export const selectTopologyTraceError = createSelector(selectConsoleTopologyState, (state) => state.traceError);
export const selectTopologyStructureVersion = createSelector(
  selectConsoleTopologyState,
  (state) => state.structureVersion,
);
