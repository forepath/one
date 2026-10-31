import { createReducer, on } from '@ngrx/store';

import type { DnsOverview } from '../../types/dns.types';
import {
  clearDnsActionError,
  confirmDnsFailback,
  confirmDnsFailbackFailure,
  confirmDnsFailbackSuccess,
  loadDns,
  loadDnsSuccess,
} from './dns.actions';

export interface ConsoleDnsState {
  overview: DnsOverview | null;
  loading: boolean;
  /** Messages of the parts that failed to load. */
  errors: string[];
  /** The failover whose fail-back is being confirmed. */
  confirming: string | null;
  actionError: string | null;
}

export const initialConsoleDnsState: ConsoleDnsState = {
  overview: null,
  loading: false,
  errors: [],
  confirming: null,
  actionError: null,
};

export const consoleDnsReducer = createReducer(
  initialConsoleDnsState,
  on(loadDns, (state, { silent }) => ({ ...state, loading: !silent })),
  on(loadDnsSuccess, (state, { overview, errors }) => ({ ...state, overview, errors, loading: false })),
  on(confirmDnsFailback, (state, { name }) => ({ ...state, confirming: name, actionError: null })),
  on(confirmDnsFailbackSuccess, (state) => ({ ...state, confirming: null })),
  on(confirmDnsFailbackFailure, (state, { error }) => ({ ...state, confirming: null, actionError: error })),
  on(clearDnsActionError, (state) => ({ ...state, actionError: null })),
);
