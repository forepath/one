import { createAction, props } from '@ngrx/store';

import type { DnsOverview } from '../../types/dns.types';

/** `infrastructure`: also read the cluster-only parts (zone sync state, DNSSEC, failovers, zones, providers). */
export const loadDns = createAction('[ConsoleDns] Load', props<{ infrastructure: boolean; silent?: boolean }>());
/** Parts that failed stay null; their messages are in `errors`. */
export const loadDnsSuccess = createAction(
  '[ConsoleDns] Load Success',
  props<{ overview: DnsOverview; errors: string[] }>(),
);

export const confirmDnsFailback = createAction('[ConsoleDns] Confirm Failback', props<{ name: string }>());
export const confirmDnsFailbackSuccess = createAction(
  '[ConsoleDns] Confirm Failback Success',
  props<{ name: string }>(),
);
export const confirmDnsFailbackFailure = createAction(
  '[ConsoleDns] Confirm Failback Failure',
  props<{ name: string; error: string }>(),
);
export const clearDnsActionError = createAction('[ConsoleDns] Clear Action Error');
