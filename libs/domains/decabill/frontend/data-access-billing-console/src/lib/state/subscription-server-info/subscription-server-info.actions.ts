import { createAction, props } from '@ngrx/store';

import type { BillingDashboardStatusUpdatePayload, ServerInfoResponse } from '../../types/billing.types';

export const loadOverviewServerInfo = createAction('[Subscription Server Info] Load Overview Server Info');

export const loadOverviewServerInfoSuccess = createAction(
  '[Subscription Server Info] Load Overview Server Info Success',
  props<{
    serverInfoBySubscriptionId: Record<string, ServerInfoResponse>;
    activeItemIdBySubscriptionId: Record<string, string>;
    /** Service (controller/manager) per subscription id from active item config. */
    serviceBySubscriptionId?: Record<string, 'controller' | 'manager'>;
  }>(),
);

export const loadOverviewServerInfoFailure = createAction(
  '[Subscription Server Info] Load Overview Server Info Failure',
  props<{ error: string }>(),
);

export const startServer = createAction(
  '[Subscription Server Info] Start Server',
  props<{ subscriptionId: string; itemId: string }>(),
);
export const startServerSuccess = createAction(
  '[Subscription Server Info] Start Server Success',
  props<{ subscriptionId: string; itemId: string }>(),
);
export const startServerFailure = createAction(
  '[Subscription Server Info] Start Server Failure',
  props<{ subscriptionId: string; error: string }>(),
);

export const stopServer = createAction(
  '[Subscription Server Info] Stop Server',
  props<{ subscriptionId: string; itemId: string }>(),
);
export const stopServerSuccess = createAction(
  '[Subscription Server Info] Stop Server Success',
  props<{ subscriptionId: string; itemId: string }>(),
);
export const stopServerFailure = createAction(
  '[Subscription Server Info] Stop Server Failure',
  props<{ subscriptionId: string; error: string }>(),
);

export const restartServer = createAction(
  '[Subscription Server Info] Restart Server',
  props<{ subscriptionId: string; itemId: string }>(),
);
export const restartServerSuccess = createAction(
  '[Subscription Server Info] Restart Server Success',
  props<{ subscriptionId: string; itemId: string }>(),
);
export const restartServerFailure = createAction(
  '[Subscription Server Info] Restart Server Failure',
  props<{ subscriptionId: string; error: string }>(),
);

export const refreshSubscriptionServerInfoSuccess = createAction(
  '[Subscription Server Info] Refresh Subscription Server Info Success',
  props<{
    subscriptionId: string;
    serverInfo: ServerInfoResponse;
    /** When false, keep server action loading until a WebSocket status push. Default: clear pending action (REST-only). */
    clearActionInProgress?: boolean;
  }>(),
);

export const billingDashboardStatusPush = createAction(
  '[Subscription Server Info] Billing Dashboard Status Push',
  props<BillingDashboardStatusUpdatePayload>(),
);
