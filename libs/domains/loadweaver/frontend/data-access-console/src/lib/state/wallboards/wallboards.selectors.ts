import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleWallboardsState } from './wallboards.reducer';

export const selectConsoleWallboardsState = createFeatureSelector<ConsoleWallboardsState>('consoleWallboards');

export const selectWallboards = createSelector(selectConsoleWallboardsState, (state) => state.tokens);
export const selectWallboardsLoading = createSelector(selectConsoleWallboardsState, (state) => state.loading);
export const selectWallboardsError = createSelector(selectConsoleWallboardsState, (state) => state.error);
export const selectCreatingWallboard = createSelector(selectConsoleWallboardsState, (state) => state.creating);
export const selectCreatedWallboard = createSelector(selectConsoleWallboardsState, (state) => state.created);
export const selectRevokingWallboard = createSelector(selectConsoleWallboardsState, (state) => state.revoking);
export const selectWallboardTokenError = createSelector(selectConsoleWallboardsState, (state) => state.tokenError);
export const selectKiosk = createSelector(selectConsoleWallboardsState, (state) => state.kiosk);
export const selectKioskLoading = createSelector(selectConsoleWallboardsState, (state) => state.kioskLoading);
export const selectKioskError = createSelector(selectConsoleWallboardsState, (state) => state.kioskError);
export const selectKioskUnauthorized = createSelector(selectConsoleWallboardsState, (state) => state.kioskUnauthorized);
export const selectKioskUpdatedAt = createSelector(selectConsoleWallboardsState, (state) => state.kioskUpdatedAt);
