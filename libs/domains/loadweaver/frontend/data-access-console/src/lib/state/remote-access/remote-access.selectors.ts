import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { VpnClient } from '../../types/remote-access.types';
import type { ConsoleRemoteAccessState } from './remote-access.reducer';

export const selectConsoleRemoteAccessState = createFeatureSelector<ConsoleRemoteAccessState>('consoleRemoteAccess');

export const selectDevicesRaw = createSelector(selectConsoleRemoteAccessState, (state) => state.devices);
export const selectDevicesAll = createSelector(selectConsoleRemoteAccessState, (state) => state.all);
export const selectDevicesLoading = createSelector(selectConsoleRemoteAccessState, (state) => state.loading);
export const selectDevicesError = createSelector(selectConsoleRemoteAccessState, (state) => state.error);
export const selectRevokingDevice = createSelector(selectConsoleRemoteAccessState, (state) => state.revoking);
export const selectRevokeDeviceError = createSelector(selectConsoleRemoteAccessState, (state) => state.revokeError);

const STATUS_RANK: Record<VpnClient['status'], number> = { active: 0, expired: 1, revoked: 2 };

/** Active devices first, then expired, then revoked; newest first within each. */
export const selectDevices = createSelector(selectDevicesRaw, (devices) =>
  [...devices].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.createdAt.localeCompare(a.createdAt)),
);

/** Active devices whose posture replaced a group (restricted access). */
export const selectRestrictedDeviceCount = createSelector(
  selectDevicesRaw,
  (devices) => devices.filter((d) => d.status === 'active' && Object.keys(d.restrictions).length > 0).length,
);
