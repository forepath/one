import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ENVIRONMENT,
  fleetRelayErrorInterceptor,
  fleetRelayRefusal,
  type LoadweaverConsoleEnvironment,
} from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import type { FleetAvailability } from '../types/fleet.types';
import { AccessService, accessFromFleetGrant } from './access.service';
import { ConsoleEndpointService } from './console-endpoint.service';
import {
  FleetClusterAvailabilityService,
  fleetAvailabilityOf,
  fleetWriteGuardInterceptor,
  isFleetRelayWrite,
} from './fleet-availability.service';

const CLUSTER = '6f1c1b0e-0000-4000-8000-000000000001';
const OTHER = '6f1c1b0e-0000-4000-8000-000000000002';
const FLEET = 'https://fleet.example.com/api';
const RELAY = `${FLEET}/clusters/${CLUSTER}/api`;

const readOnly: FleetAvailability = {
  state: 'read-only',
  reason: 'members down',
  freeze: null,
  takenOverAt: null,
  checkedAt: '2026-10-31T10:00:00Z',
};
const health = {
  state: 'healthy',
  checkedAt: null,
  latencyMs: null,
  version: null,
  clusterId: null,
  error: null,
} as const;

function setup(fleet = true) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ENVIRONMENT,
        useValue: {
          console: { urls: { restApi: 'https://cp.example.com/api', websocket: { default: '' } } },
          ...(fleet ? { mode: 'fleet', fleet: { apiUrl: `${FLEET}/`, websocketUrl: '' } } : {}),
        } as unknown as LoadweaverConsoleEnvironment,
      },
      provideHttpClient(withInterceptors([fleetWriteGuardInterceptor, fleetRelayErrorInterceptor])),
      provideHttpClientTesting(),
    ],
  });

  return {
    endpoints: TestBed.inject(ConsoleEndpointService),
    availability: TestBed.inject(FleetClusterAvailabilityService),
    http: TestBed.inject(HttpTestingController),
    client: TestBed.inject(HttpClient),
  };
}

describe('fleet: unreachable / read-only clusters (3.43, 2026-10-31)', () => {
  beforeEach(() => sessionStorage.clear());

  it('derives the availability for older fleets from the health record', () => {
    expect(fleetAvailabilityOf({ health, availability: readOnly })).toBe(readOnly);
    expect(fleetAvailabilityOf({ health: { ...health, state: 'unreachable', error: 'ECONNREFUSED' } })).toMatchObject({
      state: 'unreachable',
      reason: 'ECONNREFUSED',
    });
    expect(
      fleetAvailabilityOf({
        health: { ...health, database: { readOnly: true, reason: 'x', freeze: null, takenOverAt: null } },
      }).state,
    ).toBe('read-only');
    expect(fleetAvailabilityOf(null).state).toBe('reachable');
  });

  it('tells writes from reads (POSTs that only read included)', () => {
    expect(isFleetRelayWrite('GET', '/plans')).toBe(false);
    expect(isFleetRelayWrite('POST', '/plans')).toBe(true);
    expect(isFleetRelayWrite('POST', '/dashboards/query')).toBe(false);
    expect(isFleetRelayWrite('delete', '/resources/x')).toBe(true);
  });

  it('caps the mapped access while changes are paused', () => {
    expect(
      accessFromFleetGrant({ clusterRole: 'admin', projects: { shop: 'admin' }, readOnly: false }, null, readOnly),
    ).toMatchObject({ clusterRole: 'auditor', projects: { shop: 'viewer' }, fleetApprovals: false });
    expect(
      accessFromFleetGrant({ clusterRole: 'admin', projects: {}, readOnly: false }, null, {
        ...readOnly,
        state: 'reachable',
      }).clusterRole,
    ).toBe('cluster-admin');
  });

  it('records the availability from the access load, for the active cluster only', async () => {
    const { endpoints, availability, http } = setup();

    endpoints.setActiveCluster(CLUSTER);

    const me = firstValueFrom(TestBed.inject(AccessService).me());

    http
      .expectOne(`${FLEET}/clusters/${CLUSTER}`)
      .flush({
        id: CLUSTER,
        health,
        availability: readOnly,
        access: { clusterRole: 'operator', projects: {}, readOnly: false },
      });
    await expect(me).resolves.toMatchObject({ clusterRole: 'auditor' });
    expect(availability.paused()).toEqual(readOnly);

    availability.record(OTHER, { health, availability: { ...readOnly, state: 'reachable' } });
    expect(availability.paused()).toEqual(readOnly);

    endpoints.setActiveCluster(OTHER);
    expect(availability.availability()).toBeNull();
    http.verify();
  });

  it('refreshes from the fleet and keeps the last state on errors', async () => {
    const { endpoints, availability, http } = setup();

    endpoints.setActiveCluster(CLUSTER);

    const first = firstValueFrom(availability.refresh());

    http.expectOne(`${FLEET}/clusters/${CLUSTER}`).flush({ id: CLUSTER, health, availability: readOnly });
    await expect(first).resolves.toEqual(readOnly);

    const failed = firstValueFrom(availability.refresh());

    http.expectOne(`${FLEET}/clusters/${CLUSTER}`).flush({}, { status: 500, statusText: 'x' });
    await expect(failed).resolves.toEqual(readOnly);
    http.verify();
  });

  it('polls the open cluster while started, not without a cluster or after stop', () => {
    const { endpoints, availability, http } = setup();

    jest.useFakeTimers();

    try {
      availability.start(1000);
      TestBed.tick();
      jest.advanceTimersByTime(1000);
      http.expectNone(`${FLEET}/clusters/${CLUSTER}`);

      endpoints.setActiveCluster(CLUSTER);
      TestBed.tick();
      jest.advanceTimersByTime(1000);
      http.expectOne(`${FLEET}/clusters/${CLUSTER}`).flush({ id: CLUSTER, health, availability: readOnly });
      expect(availability.paused()).toEqual(readOnly);

      availability.stop();
      jest.advanceTimersByTime(5000);
      http.verify();
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers changes to a paused cluster in the browser with a clear 503, lets reads and other URLs through', async () => {
    const { endpoints, availability, http, client } = setup();

    endpoints.setActiveCluster(CLUSTER);
    availability.record(CLUSTER, { health, availability: { ...readOnly, state: 'unreachable' } });

    const refused = (await firstValueFrom(client.post(`${RELAY}/plans`, {})).catch((e) => e)) as HttpErrorResponse;

    expect(refused.status).toBe(503);
    expect(refused.error).toMatchObject({ fleetRelay: 'cluster-unreachable' });
    expect(refused.error.message).toContain("can't reach this cluster");

    availability.record(CLUSTER, { health, availability: readOnly });
    expect(
      ((await firstValueFrom(client.delete(`${RELAY}/resources/x?force=1`)).catch((e) => e)) as HttpErrorResponse).error
        .fleetRelay,
    ).toBe('cluster-read-only');

    void firstValueFrom(client.get(`${RELAY}/plans`));
    void firstValueFrom(client.post(`${RELAY}/dashboards/query`, {}));
    void firstValueFrom(client.post(`${FLEET}/clusters/${OTHER}/api/plans`, {}));
    void firstValueFrom(client.post(`${FLEET}/operations`, {}));
    http.expectOne(`${RELAY}/plans`).flush([]);
    http.expectOne(`${RELAY}/dashboards/query`).flush({});
    http.expectOne(`${FLEET}/clusters/${OTHER}/api/plans`).flush({});
    http.expectOne(`${FLEET}/operations`).flush({});
    http.verify();
  });

  it('is a no-op in single-cluster mode', async () => {
    const { http, client } = setup(false);

    void firstValueFrom(client.post('https://cp.example.com/api/plans', {}));
    http.expectOne('https://cp.example.com/api/plans').flush({});
    http.verify();
  });

  it('explains the fleet relay’s own 503 for paused clusters', async () => {
    expect(
      fleetRelayRefusal(503, {
        message: 'cluster eu is unreachable: changes through the fleet are paused until it answers again',
      }),
    ).toBe('cluster-unreachable');
    expect(
      fleetRelayRefusal(503, {
        message:
          'cluster eu is read-only (members down): changes through the fleet are paused until it can write again',
      }),
    ).toBe('cluster-read-only');
    expect(fleetRelayRefusal(503, { message: 'Service Unavailable' })).toBeNull();

    const { endpoints, http, client } = setup();

    endpoints.setActiveCluster(CLUSTER);

    const refused = firstValueFrom(client.post(`${RELAY}/plans`, {})).catch((e) => e);

    http
      .expectOne(`${RELAY}/plans`)
      .flush(
        { message: 'cluster eu is unreachable: changes through the fleet are paused until it answers again' },
        { status: 503, statusText: 'x' },
      );
    expect(((await refused) as HttpErrorResponse).error.fleetRelay).toBe('cluster-unreachable');
  });
});
