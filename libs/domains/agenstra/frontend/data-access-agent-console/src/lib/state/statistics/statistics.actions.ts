import { createAction, props } from '@ngrx/store';

import type {
  StatisticsAggregateParams,
  StatisticsChatIoListDto,
  StatisticsClientScopeParams,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsFilterFlagListDto,
  StatisticsSummaryDto,
} from './statistics.types';

// Client-scoped: Summary
export const loadClientStatisticsSummary = createAction(
  '[Statistics] Load Client Summary',
  props<{ clientId: string; params?: { from?: string; to?: string; groupBy?: 'day' | 'hour' } }>(),
);
export const loadClientStatisticsSummarySuccess = createAction(
  '[Statistics] Load Client Summary Success',
  props<{ clientId: string; summary: StatisticsSummaryDto }>(),
);
export const loadClientStatisticsSummaryFailure = createAction(
  '[Statistics] Load Client Summary Failure',
  props<{ clientId: string; error: string }>(),
);

// Client-scoped: Chat I/O
export const loadClientStatisticsChatIo = createAction(
  '[Statistics] Load Client Chat I/O',
  props<{ params: StatisticsClientScopeParams }>(),
);
export const loadClientStatisticsChatIoSuccess = createAction(
  '[Statistics] Load Client Chat I/O Success',
  props<{ clientId: string; data: StatisticsChatIoListDto }>(),
);
export const loadClientStatisticsChatIoFailure = createAction(
  '[Statistics] Load Client Chat I/O Failure',
  props<{ clientId: string; error: string }>(),
);

// Client-scoped: Filter Drops
export const loadClientStatisticsFilterDrops = createAction(
  '[Statistics] Load Client Filter Drops',
  props<{ params: StatisticsClientScopeParams }>(),
);
export const loadClientStatisticsFilterDropsSuccess = createAction(
  '[Statistics] Load Client Filter Drops Success',
  props<{ clientId: string; data: StatisticsFilterDropListDto }>(),
);
export const loadClientStatisticsFilterDropsFailure = createAction(
  '[Statistics] Load Client Filter Drops Failure',
  props<{ clientId: string; error: string }>(),
);

// Client-scoped: Filter Flags
export const loadClientStatisticsFilterFlags = createAction(
  '[Statistics] Load Client Filter Flags',
  props<{ params: StatisticsClientScopeParams }>(),
);
export const loadClientStatisticsFilterFlagsSuccess = createAction(
  '[Statistics] Load Client Filter Flags Success',
  props<{ clientId: string; data: StatisticsFilterFlagListDto }>(),
);
export const loadClientStatisticsFilterFlagsFailure = createAction(
  '[Statistics] Load Client Filter Flags Failure',
  props<{ clientId: string; error: string }>(),
);

// Client-scoped: Entity Events
export const loadClientStatisticsEntityEvents = createAction(
  '[Statistics] Load Client Entity Events',
  props<{ params: StatisticsClientScopeParams }>(),
);
export const loadClientStatisticsEntityEventsSuccess = createAction(
  '[Statistics] Load Client Entity Events Success',
  props<{ clientId: string; data: StatisticsEntityEventListDto }>(),
);
export const loadClientStatisticsEntityEventsFailure = createAction(
  '[Statistics] Load Client Entity Events Failure',
  props<{ clientId: string; error: string }>(),
);

// Aggregate: Summary
export const loadStatisticsSummary = createAction(
  '[Statistics] Load Summary',
  props<{ params?: StatisticsAggregateParams }>(),
);
export const loadStatisticsSummarySuccess = createAction(
  '[Statistics] Load Summary Success',
  props<{ summary: StatisticsSummaryDto }>(),
);
export const loadStatisticsSummaryFailure = createAction(
  '[Statistics] Load Summary Failure',
  props<{ error: string }>(),
);

// Aggregate: Chat I/O
export const loadStatisticsChatIo = createAction(
  '[Statistics] Load Chat I/O',
  props<{ params?: StatisticsAggregateParams }>(),
);
export const loadStatisticsChatIoSuccess = createAction(
  '[Statistics] Load Chat I/O Success',
  props<{ data: StatisticsChatIoListDto }>(),
);
export const loadStatisticsChatIoFailure = createAction(
  '[Statistics] Load Chat I/O Failure',
  props<{ error: string }>(),
);

// Aggregate: Filter Drops
export const loadStatisticsFilterDrops = createAction(
  '[Statistics] Load Filter Drops',
  props<{ params?: StatisticsAggregateParams }>(),
);
export const loadStatisticsFilterDropsSuccess = createAction(
  '[Statistics] Load Filter Drops Success',
  props<{ data: StatisticsFilterDropListDto }>(),
);
export const loadStatisticsFilterDropsFailure = createAction(
  '[Statistics] Load Filter Drops Failure',
  props<{ error: string }>(),
);

// Aggregate: Filter Flags
export const loadStatisticsFilterFlags = createAction(
  '[Statistics] Load Filter Flags',
  props<{ params?: StatisticsAggregateParams }>(),
);
export const loadStatisticsFilterFlagsSuccess = createAction(
  '[Statistics] Load Filter Flags Success',
  props<{ data: StatisticsFilterFlagListDto }>(),
);
export const loadStatisticsFilterFlagsFailure = createAction(
  '[Statistics] Load Filter Flags Failure',
  props<{ error: string }>(),
);

// Aggregate: Entity Events
export const loadStatisticsEntityEvents = createAction(
  '[Statistics] Load Entity Events',
  props<{ params?: StatisticsAggregateParams }>(),
);
export const loadStatisticsEntityEventsSuccess = createAction(
  '[Statistics] Load Entity Events Success',
  props<{ data: StatisticsEntityEventListDto }>(),
);
export const loadStatisticsEntityEventsFailure = createAction(
  '[Statistics] Load Entity Events Failure',
  props<{ error: string }>(),
);
