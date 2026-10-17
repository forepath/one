import { createAction, props } from '@ngrx/store';

import type { TopologyEdge, TopologyGraph, TopologyQuery, TopologyTrace } from '../../types/topology.types';

export const loadTopology = createAction('[ConsoleTopology] Load', props<{ query: TopologyQuery; silent?: boolean }>());
export const loadTopologySuccess = createAction('[ConsoleTopology] Load Success', props<{ graph: TopologyGraph }>());
export const loadTopologyFailure = createAction('[ConsoleTopology] Load Failure', props<{ error: string }>());

/** Live traffic over `socket/topology` (cluster roles) while the live map is shown. */
export const connectTopologyLive = createAction('[ConsoleTopology] Connect Live');
export const disconnectTopologyLive = createAction('[ConsoleTopology] Disconnect Live');
export const topologyLiveConnected = createAction('[ConsoleTopology] Live Connected', props<{ connected: boolean }>());
export const topologyFlowsReceived = createAction(
  '[ConsoleTopology] Flows Received',
  props<{ at: string; edges: TopologyEdge[] }>(),
);
export const topologyLiveError = createAction('[ConsoleTopology] Live Error', props<{ error: string }>());

export const traceTopology = createAction('[ConsoleTopology] Trace', props<{ host: string }>());
export const traceTopologySuccess = createAction(
  '[ConsoleTopology] Trace Success',
  props<{ host: string; trace: TopologyTrace }>(),
);
export const traceTopologyFailure = createAction(
  '[ConsoleTopology] Trace Failure',
  props<{ host: string; error: string }>(),
);
export const clearTopologyTrace = createAction('[ConsoleTopology] Clear Trace');
