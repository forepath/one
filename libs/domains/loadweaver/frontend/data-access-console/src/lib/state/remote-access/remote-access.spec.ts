import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { RemoteAccessService } from '../../services/remote-access.service';
import type { VpnClient } from '../../types/remote-access.types';
import {
  loadDevices,
  loadDevicesFailure,
  loadDevicesSuccess,
  revokeDevice,
  revokeDeviceFailure,
  revokeDeviceSuccess,
} from './remote-access.actions';
import { loadDevices$, revokeDevice$ } from './remote-access.effects';
import { consoleRemoteAccessReducer, initialConsoleRemoteAccessState } from './remote-access.reducer';
import { selectDevices, selectRestrictedDeviceCount } from './remote-access.selectors';

function vpnClient(overrides: Partial<VpnClient> = {}): VpnClient {
  return {
    id: '3f2a1b4c-0000-4000-8000-000000000001',
    kind: 'user',
    name: 'laptop',
    owner: 'alice',
    address: '100.64.0.2',
    subnets: [],
    groups: ['staff'],
    effectiveGroups: ['staff'],
    restrictions: {},
    status: 'active',
    createdAt: '2026-10-01T10:00:00.000Z',
    expiresAt: '2027-01-01T10:00:00.000Z',
    revokedAt: null,
    lastHandshakeAt: null,
    lastEndpoint: null,
    ...overrides,
  };
}

describe('console remote access state', () => {
  it('loads own or all devices and marks revoked ones', () => {
    const own = consoleRemoteAccessReducer(
      consoleRemoteAccessReducer(initialConsoleRemoteAccessState, loadDevices({ all: false })),
      loadDevicesSuccess({ all: false, devices: [vpnClient()] }),
    );
    const switching = consoleRemoteAccessReducer(own, loadDevices({ all: true }));

    expect(own).toMatchObject({ loading: false, all: false });
    expect(switching.devices).toEqual([]);
    // A late answer for the other list is dropped.
    expect(consoleRemoteAccessReducer(switching, loadDevicesSuccess({ all: false, devices: [vpnClient()] }))).toBe(
      switching,
    );

    const revoking = consoleRemoteAccessReducer(own, revokeDevice({ id: vpnClient().id }));
    const revoked = consoleRemoteAccessReducer(
      revoking,
      revokeDeviceSuccess({ id: vpnClient().id, revokedAt: '2026-10-02T10:00:00.000Z' }),
    );

    expect(revoking.revoking).toBe(vpnClient().id);
    expect(revoked.devices[0]).toMatchObject({ status: 'revoked', revokedAt: '2026-10-02T10:00:00.000Z' });
    expect(consoleRemoteAccessReducer(revoking, revokeDeviceFailure({ id: 'x', error: 'not found' }))).toMatchObject({
      revoking: null,
      revokeError: 'not found',
    });
    expect(consoleRemoteAccessReducer(own, loadDevicesFailure({ error: 'e' })).error).toBe('e');
  });

  it('sorts active devices first and counts restricted ones', () => {
    const state = {
      consoleRemoteAccess: {
        ...initialConsoleRemoteAccessState,
        devices: [
          vpnClient({ id: 'a', status: 'revoked' }),
          vpnClient({ id: 'b', restrictions: { staff: ['disk encryption off'] } }),
          vpnClient({ id: 'c', createdAt: '2026-10-05T10:00:00.000Z' }),
        ],
      },
    };

    expect(selectDevices(state).map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(selectRestrictedDeviceCount(state)).toBe(1);
  });

  it('loads and revokes through the API', async () => {
    const service = {
      devices: jest.fn().mockReturnValue(of([vpnClient()])),
      revoke: jest
        .fn()
        .mockReturnValueOnce(of(undefined))
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'device not found' } })),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadDevices({ all: true }), revokeDevice({ id: 'a' }), revokeDevice({ id: 'b' }))),
      ],
    });

    const actions = TestBed.inject(Actions);
    const api = service as unknown as RemoteAccessService;

    expect(await firstValueFrom(loadDevices$(actions, api))).toEqual(
      loadDevicesSuccess({ all: true, devices: [vpnClient()] }),
    );
    expect(service.devices).toHaveBeenCalledWith(true);

    const revoked = await firstValueFrom(revokeDevice$(actions, api).pipe(toArray()));

    expect(revoked[0]).toMatchObject({ type: revokeDeviceSuccess.type, id: 'a' });
    expect(revoked[1]).toEqual(revokeDeviceFailure({ id: 'b', error: 'device not found' }));
  });
});
