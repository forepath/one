import { createReducer, on } from '@ngrx/store';

import {
  loadClientStatisticsEgressEvents,
  loadClientStatisticsEgressEventsFailure,
  loadClientStatisticsEgressEventsSuccess,
  loadStatisticsEgressEvents,
  loadStatisticsEgressEventsFailure,
  loadStatisticsEgressEventsSuccess,
  loadClientStatisticsChatIo,
  loadClientStatisticsChatIoFailure,
  loadClientStatisticsChatIoSuccess,
  loadClientStatisticsEntityEvents,
  loadClientStatisticsEntityEventsFailure,
  loadClientStatisticsEntityEventsSuccess,
  loadClientStatisticsFilterDrops,
  loadClientStatisticsFilterDropsFailure,
  loadClientStatisticsFilterDropsSuccess,
  loadClientStatisticsFilterFlags,
  loadClientStatisticsFilterFlagsFailure,
  loadClientStatisticsFilterFlagsSuccess,
  loadClientStatisticsSummary,
  loadClientStatisticsSummaryFailure,
  loadClientStatisticsSummarySuccess,
  loadStatisticsChatIo,
  loadStatisticsChatIoFailure,
  loadStatisticsChatIoSuccess,
  loadStatisticsEntityEvents,
  loadStatisticsEntityEventsFailure,
  loadStatisticsEntityEventsSuccess,
  loadStatisticsFilterDrops,
  loadStatisticsFilterDropsFailure,
  loadStatisticsFilterDropsSuccess,
  loadStatisticsFilterFlags,
  loadStatisticsFilterFlagsFailure,
  loadStatisticsFilterFlagsSuccess,
  loadStatisticsSummary,
  loadStatisticsSummaryFailure,
  loadStatisticsSummarySuccess,
} from './statistics.actions';
import type {
  StatisticsChatIoListDto,
  StatisticsEgressEventListDto,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsFilterFlagListDto,
  StatisticsSummaryDto,
} from './statistics.types';

export interface StatisticsState {
  // Client-scoped (keyed by clientId)
  clientSummary: Record<string, StatisticsSummaryDto>;
  clientChatIo: Record<string, StatisticsChatIoListDto>;
  clientFilterDrops: Record<string, StatisticsFilterDropListDto>;
  clientFilterFlags: Record<string, StatisticsFilterFlagListDto>;
  clientEntityEvents: Record<string, StatisticsEntityEventListDto>;
  clientEgressEvents: Record<string, StatisticsEgressEventListDto>;
  loadingClientSummary: Record<string, boolean>;
  loadingClientChatIo: Record<string, boolean>;
  loadingClientFilterDrops: Record<string, boolean>;
  loadingClientFilterFlags: Record<string, boolean>;
  loadingClientEntityEvents: Record<string, boolean>;
  loadingClientEgressEvents: Record<string, boolean>;
  // Aggregate
  summary: StatisticsSummaryDto | null;
  chatIo: StatisticsChatIoListDto | null;
  filterDrops: StatisticsFilterDropListDto | null;
  filterFlags: StatisticsFilterFlagListDto | null;
  entityEvents: StatisticsEntityEventListDto | null;
  egressEvents: StatisticsEgressEventListDto | null;
  loadingSummary: boolean;
  loadingChatIo: boolean;
  loadingFilterDrops: boolean;
  loadingFilterFlags: boolean;
  loadingEntityEvents: boolean;
  loadingEgressEvents: boolean;
  error: string | null;
}

export const initialStatisticsState: StatisticsState = {
  clientSummary: {},
  clientChatIo: {},
  clientFilterDrops: {},
  clientFilterFlags: {},
  clientEntityEvents: {},
  clientEgressEvents: {},
  loadingClientSummary: {},
  loadingClientChatIo: {},
  loadingClientFilterDrops: {},
  loadingClientFilterFlags: {},
  loadingClientEntityEvents: {},
  loadingClientEgressEvents: {},
  summary: null,
  chatIo: null,
  filterDrops: null,
  filterFlags: null,
  entityEvents: null,
  egressEvents: null,
  loadingSummary: false,
  loadingChatIo: false,
  loadingFilterDrops: false,
  loadingFilterFlags: false,
  loadingEntityEvents: false,
  loadingEgressEvents: false,
  error: null,
};

export const statisticsReducer = createReducer(
  initialStatisticsState,
  // Client-scoped Summary
  on(loadClientStatisticsSummary, (state, { clientId }) => ({
    ...state,
    loadingClientSummary: { ...state.loadingClientSummary, [clientId]: true },
    error: null,
  })),
  on(loadClientStatisticsSummarySuccess, (state, { clientId, summary }) => ({
    ...state,
    clientSummary: { ...state.clientSummary, [clientId]: summary },
    loadingClientSummary: { ...state.loadingClientSummary, [clientId]: false },
    error: null,
  })),
  on(loadClientStatisticsSummaryFailure, (state, { clientId, error }) => ({
    ...state,
    loadingClientSummary: { ...state.loadingClientSummary, [clientId]: false },
    error,
  })),
  // Client-scoped Chat I/O
  on(loadClientStatisticsChatIo, (state, { params }) => ({
    ...state,
    loadingClientChatIo: { ...state.loadingClientChatIo, [params.clientId]: true },
    error: null,
  })),
  on(loadClientStatisticsChatIoSuccess, (state, { clientId, data }) => ({
    ...state,
    clientChatIo: { ...state.clientChatIo, [clientId]: data },
    loadingClientChatIo: { ...state.loadingClientChatIo, [clientId]: false },
    error: null,
  })),
  on(loadClientStatisticsChatIoFailure, (state, { clientId, error }) => ({
    ...state,
    loadingClientChatIo: { ...state.loadingClientChatIo, [clientId]: false },
    error,
  })),
  // Client-scoped Filter Drops
  on(loadClientStatisticsFilterDrops, (state, { params }) => ({
    ...state,
    loadingClientFilterDrops: { ...state.loadingClientFilterDrops, [params.clientId]: true },
    error: null,
  })),
  on(loadClientStatisticsFilterDropsSuccess, (state, { clientId, data }) => ({
    ...state,
    clientFilterDrops: { ...state.clientFilterDrops, [clientId]: data },
    loadingClientFilterDrops: { ...state.loadingClientFilterDrops, [clientId]: false },
    error: null,
  })),
  on(loadClientStatisticsFilterDropsFailure, (state, { clientId, error }) => ({
    ...state,
    loadingClientFilterDrops: { ...state.loadingClientFilterDrops, [clientId]: false },
    error,
  })),
  // Client-scoped Filter Flags
  on(loadClientStatisticsFilterFlags, (state, { params }) => ({
    ...state,
    loadingClientFilterFlags: { ...state.loadingClientFilterFlags, [params.clientId]: true },
    error: null,
  })),
  on(loadClientStatisticsFilterFlagsSuccess, (state, { clientId, data }) => ({
    ...state,
    clientFilterFlags: { ...state.clientFilterFlags, [clientId]: data },
    loadingClientFilterFlags: { ...state.loadingClientFilterFlags, [clientId]: false },
    error: null,
  })),
  on(loadClientStatisticsFilterFlagsFailure, (state, { clientId, error }) => ({
    ...state,
    loadingClientFilterFlags: { ...state.loadingClientFilterFlags, [clientId]: false },
    error,
  })),
  // Client-scoped Entity Events
  on(loadClientStatisticsEntityEvents, (state, { params }) => ({
    ...state,
    loadingClientEntityEvents: { ...state.loadingClientEntityEvents, [params.clientId]: true },
    error: null,
  })),
  on(loadClientStatisticsEntityEventsSuccess, (state, { clientId, data }) => ({
    ...state,
    clientEntityEvents: { ...state.clientEntityEvents, [clientId]: data },
    loadingClientEntityEvents: { ...state.loadingClientEntityEvents, [clientId]: false },
    error: null,
  })),
  on(loadClientStatisticsEntityEventsFailure, (state, { clientId, error }) => ({
    ...state,
    loadingClientEntityEvents: { ...state.loadingClientEntityEvents, [clientId]: false },
    error,
  })),
  // Aggregate Summary
  on(loadStatisticsSummary, (state) => ({
    ...state,
    loadingSummary: true,
    error: null,
  })),
  on(loadStatisticsSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loadingSummary: false,
    error: null,
  })),
  on(loadStatisticsSummaryFailure, (state, { error }) => ({
    ...state,
    loadingSummary: false,
    error,
  })),
  // Aggregate Chat I/O
  on(loadStatisticsChatIo, (state) => ({
    ...state,
    loadingChatIo: true,
    error: null,
  })),
  on(loadStatisticsChatIoSuccess, (state, { data }) => ({
    ...state,
    chatIo: data,
    loadingChatIo: false,
    error: null,
  })),
  on(loadStatisticsChatIoFailure, (state, { error }) => ({
    ...state,
    loadingChatIo: false,
    error,
  })),
  // Aggregate Filter Drops
  on(loadStatisticsFilterDrops, (state) => ({
    ...state,
    loadingFilterDrops: true,
    error: null,
  })),
  on(loadStatisticsFilterDropsSuccess, (state, { data }) => ({
    ...state,
    filterDrops: data,
    loadingFilterDrops: false,
    error: null,
  })),
  on(loadStatisticsFilterDropsFailure, (state, { error }) => ({
    ...state,
    loadingFilterDrops: false,
    error,
  })),
  // Aggregate Filter Flags
  on(loadStatisticsFilterFlags, (state) => ({
    ...state,
    loadingFilterFlags: true,
    error: null,
  })),
  on(loadStatisticsFilterFlagsSuccess, (state, { data }) => ({
    ...state,
    filterFlags: data,
    loadingFilterFlags: false,
    error: null,
  })),
  on(loadStatisticsFilterFlagsFailure, (state, { error }) => ({
    ...state,
    loadingFilterFlags: false,
    error,
  })),
  // Aggregate Entity Events
  on(loadStatisticsEntityEvents, (state) => ({
    ...state,
    loadingEntityEvents: true,
    error: null,
  })),
  on(loadStatisticsEntityEventsSuccess, (state, { data }) => ({
    ...state,
    entityEvents: data,
    loadingEntityEvents: false,
    error: null,
  })),
  on(loadStatisticsEntityEventsFailure, (state, { error }) => ({
    ...state,
    loadingEntityEvents: false,
    error,
  })),
  // Client-scoped Egress Events
  on(loadClientStatisticsEgressEvents, (state, { params }) => ({
    ...state,
    loadingClientEgressEvents: { ...state.loadingClientEgressEvents, [params.clientId]: true },
    error: null,
  })),
  on(loadClientStatisticsEgressEventsSuccess, (state, { clientId, data }) => ({
    ...state,
    clientEgressEvents: { ...state.clientEgressEvents, [clientId]: data },
    loadingClientEgressEvents: { ...state.loadingClientEgressEvents, [clientId]: false },
    error: null,
  })),
  on(loadClientStatisticsEgressEventsFailure, (state, { clientId, error }) => ({
    ...state,
    loadingClientEgressEvents: { ...state.loadingClientEgressEvents, [clientId]: false },
    error,
  })),
  // Aggregate Egress Events
  on(loadStatisticsEgressEvents, (state) => ({
    ...state,
    loadingEgressEvents: true,
    error: null,
  })),
  on(loadStatisticsEgressEventsSuccess, (state, { data }) => ({
    ...state,
    egressEvents: data,
    loadingEgressEvents: false,
    error: null,
  })),
  on(loadStatisticsEgressEventsFailure, (state, { error }) => ({
    ...state,
    loadingEgressEvents: false,
    error,
  })),
);
