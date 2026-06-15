import { createAction, props } from '@ngrx/store';

export const connectBillingDashboardSocket = createAction('[Billing Dashboard Socket] Connect');

export const connectBillingDashboardSocketSuccess = createAction('[Billing Dashboard Socket] Connect Success');

export const connectBillingDashboardSocketFailure = createAction(
  '[Billing Dashboard Socket] Connect Failure',
  props<{ error: string }>(),
);

export const disconnectBillingDashboardSocket = createAction('[Billing Dashboard Socket] Disconnect');

export const disconnectBillingDashboardSocketSuccess = createAction('[Billing Dashboard Socket] Disconnect Success');

export const billingDashboardSocketDataReceived = createAction('[Billing Dashboard Socket] Data Received');

export const billingDashboardSocketApplicationError = createAction(
  '[Billing Dashboard Socket] Application Error',
  props<{ message: string }>(),
);
