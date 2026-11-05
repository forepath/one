import type { IdentityAppGrantResponseDto, IdentityAppResponseDto } from '../../types/identity-app.types';

import {
  clearIdentityAppSecret,
  createIdentityAppSuccess,
  loadIdentityAppGrants,
  loadIdentityAppGrantsSuccess,
  revokeAllIdentityAppGrantsSuccess,
  revokeIdentityAppGrantSuccess,
  revokeOwnAppGrantSuccess,
  loadOwnAppGrantsSuccess,
  rotateIdentityAppSecretSuccess,
  updateIdentityAppSuccess,
} from './identity-apps.actions';
import { identityAppsReducer, initialIdentityAppsState } from './identity-apps.reducer';

const app = (overrides: Partial<IdentityAppResponseDto> = {}): IdentityAppResponseDto => ({
  id: 'app-1',
  name: 'Sync',
  description: null,
  returnUrl: 'https://app.example.com/cb',
  scopes: ['tickets:read'],
  secretPrefix: 'fp_aps_abcdefgh',
  secretRotatedAt: null,
  grantCount: 2,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
  ...overrides,
});
const grant = (id: string): IdentityAppGrantResponseDto => ({
  id,
  appId: 'app-1',
  appName: 'Sync',
  appDescription: null,
  userId: 'u1',
  userEmail: 'u@example.com',
  consentedScopes: ['tickets:read'],
  scopes: ['tickets:read'],
  needsReauthorization: false,
  sessionCount: 1,
  lastUsedAt: null,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
});

describe('identityAppsReducer', () => {
  it('keeps the one-time secret out of the app list and clears it on demand', () => {
    let state = identityAppsReducer(
      initialIdentityAppsState,
      createIdentityAppSuccess({ app: app({ secret: 'fp_aps_s' }) }),
    );

    expect(state.lastSecret).toBe('fp_aps_s');
    expect(state.apps[0]).not.toHaveProperty('secret');

    state = identityAppsReducer(state, clearIdentityAppSecret());
    expect(state.lastSecret).toBeNull();

    state = identityAppsReducer(state, rotateIdentityAppSecretSuccess({ app: app({ secret: 'fp_aps_t' }) }));
    expect(state.lastSecret).toBe('fp_aps_t');
    expect(state.apps).toHaveLength(1);

    state = identityAppsReducer(state, updateIdentityAppSuccess({ app: app({ name: 'Renamed' }) }));
    expect(state.apps[0].name).toBe('Renamed');
  });

  it('tracks grants of the selected app and revocations', () => {
    let state = identityAppsReducer(
      { ...initialIdentityAppsState, apps: [app()] },
      loadIdentityAppGrants({ appId: 'app-1' }),
    );

    state = identityAppsReducer(
      state,
      loadIdentityAppGrantsSuccess({ appId: 'app-1', grants: [grant('g1'), grant('g2')] }),
    );
    // Stale response for another app is ignored.
    state = identityAppsReducer(state, loadIdentityAppGrantsSuccess({ appId: 'app-2', grants: [] }));
    expect(state.grants).toHaveLength(2);

    state = identityAppsReducer(state, revokeIdentityAppGrantSuccess({ appId: 'app-1', grantId: 'g1' }));
    expect(state.grants.map((item) => item.id)).toEqual(['g2']);
    expect(state.apps[0].grantCount).toBe(1);

    state = identityAppsReducer(state, revokeAllIdentityAppGrantsSuccess({ appId: 'app-1' }));
    expect(state.grants).toEqual([]);
    expect(state.apps[0].grantCount).toBe(0);
  });

  it('removes revoked own grants', () => {
    let state = identityAppsReducer(initialIdentityAppsState, loadOwnAppGrantsSuccess({ grants: [grant('g1')] }));

    state = identityAppsReducer(state, revokeOwnAppGrantSuccess({ grantId: 'g1' }));
    expect(state.ownGrants).toEqual([]);
  });
});
