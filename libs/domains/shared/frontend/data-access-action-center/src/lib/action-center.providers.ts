import type { EnvironmentProviders, Provider } from '@angular/core';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { actionCenterEffects } from './state/action-center/action-center.effects';
import { ACTION_CENTER_FEATURE_KEY, actionCenterReducer } from './state/action-center/action-center.reducer';

/**
 * NgRx state of the shared action center. The consuming application must also provide `ACTION_CENTER_ENVIRONMENT`
 * and `ACTION_CENTER_SOCKET_AUTH`.
 */
export const actionCenterStateProviders: Array<Provider | EnvironmentProviders> = [
  provideState(ACTION_CENTER_FEATURE_KEY, actionCenterReducer),
  provideEffects(actionCenterEffects),
];
