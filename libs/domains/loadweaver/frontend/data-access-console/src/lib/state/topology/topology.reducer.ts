import { createReducer, on } from '@ngrx/store';

import type { TopologyEdge, TopologyGraph, TopologyQuery, TopologyTraceStep } from '../../types/topology.types';
import {
  clearTopologyTrace,
  connectTopologyLive,
  disconnectTopologyLive,
  loadTopology,
  loadTopologyFailure,
  loadTopologySuccess,
  topologyFlowsReceived,
  topologyLiveConnected,
  topologyLiveError,
  traceTopology,
  traceTopologyFailure,
  traceTopologySuccess,
} from './topology.actions';

export interface ConsoleTopologyState {
  graph: TopologyGraph | null;
  /** The query `graph` answers (live, a time, a plan). */
  query: TopologyQuery;
  loading: boolean;
  error: string | null;
  /** Streaming live flows. */
  live: boolean;
  liveConnected: boolean;
  liveError: string | null;
  /** The newest flows from the socket (they replace the graph's flow edges). */
  liveFlows: TopologyEdge[] | null;
  liveAt: string | null;
  traceHost: string | null;
  traceSteps: TopologyTraceStep[];
  traceLoading: boolean;
  traceError: string | null;
}

export const initialConsoleTopologyState: ConsoleTopologyState = {
  graph: null,
  query: {},
  loading: false,
  error: null,
  live: false,
  liveConnected: false,
  liveError: null,
  liveFlows: null,
  liveAt: null,
  traceHost: null,
  traceSteps: [],
  traceLoading: false,
  traceError: null,
};

const sameQuery = (a: TopologyQuery, b: TopologyQuery) =>
  !!a.flows === !!b.flows && (a.at ?? null) === (b.at ?? null) && (a.plan ?? null) === (b.plan ?? null);

export const consoleTopologyReducer = createReducer(
  initialConsoleTopologyState,
  on(loadTopology, (state, { query, silent }) => ({
    ...state,
    // Another view (time, plan) drops the previous map's overlay and flows right away.
    graph: sameQuery(query, state.query) ? state.graph : null,
    query,
    loading: !silent,
    error: null,
  })),
  on(loadTopologySuccess, (state, { graph }) => ({ ...state, graph, loading: false })),
  on(loadTopologyFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(connectTopologyLive, (state) => ({ ...state, live: true, liveError: null })),
  on(disconnectTopologyLive, (state) => ({
    ...state,
    live: false,
    liveConnected: false,
    liveFlows: null,
    liveAt: null,
  })),
  on(topologyLiveConnected, (state, { connected }) => ({ ...state, liveConnected: state.live && connected })),
  on(topologyFlowsReceived, (state, { at, edges }) =>
    state.live ? { ...state, liveFlows: edges, liveAt: at, liveError: null } : state,
  ),
  on(topologyLiveError, (state, { error }) => ({ ...state, liveError: error })),
  on(traceTopology, (state, { host }) => ({
    ...state,
    traceHost: host,
    traceSteps: [],
    traceLoading: true,
    traceError: null,
  })),
  on(traceTopologySuccess, (state, { host, trace }) =>
    host === state.traceHost ? { ...state, traceSteps: trace.steps, traceLoading: false } : state,
  ),
  on(traceTopologyFailure, (state, { host, error }) =>
    host === state.traceHost ? { ...state, traceLoading: false, traceError: error } : state,
  ),
  on(clearTopologyTrace, (state) => ({
    ...state,
    traceHost: null,
    traceSteps: [],
    traceLoading: false,
    traceError: null,
  })),
);
