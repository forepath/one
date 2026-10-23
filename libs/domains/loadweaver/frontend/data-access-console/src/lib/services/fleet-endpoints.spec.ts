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

import { AccessService, accessFromFleetGrant } from './access.service';
import {
  ConsoleEndpointService,
  FLEET_ACTIVE_CLUSTER_STORAGE_KEY,
  fleetRelayApiUrl,
  resolveConsoleRestApi,
} from './console-endpoint.service';
import { FleetService } from './fleet.service';
import { PlansService } from './plans.service';

const CLUSTER = '6f1c1b0e-0000-4000-8000-000000000001';
const OTHER = '6f1c1b0e-0000-4000-8000-000000000002';
const FLEET = 'https://fleet.example.com/api';

function environment(fleet: boolean): LoadweaverConsoleEnvironment {
  return {
    console: {
      urls: {
        restApi: 'https://cp.example.com/api/',
        frontend: '/',
        websocket: { default: 'https://cp.example.com/socket/plans', plans: 'https://cp.example.com/socket/plans' },
      },
    },
    ...(fleet
      ? {
          mode: 'fleet' as const,
          fleet: { apiUrl: `${FLEET}/`, websocketUrl: 'https://fleet.example.com/socket/fleet' },
        }
      : {}),
  } as unknown as LoadweaverConsoleEnvironment;
}

function setup(fleet: boolean) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ENVIRONMENT, useValue: environment(fleet) },
      provideHttpClient(withInterceptors([fleetRelayErrorInterceptor])),
      provideHttpClientTesting(),
    ],
  });

  return {
    endpoints: TestBed.inject(ConsoleEndpointService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('fleet relay URL resolution', () => {
  beforeEach(() => sessionStorage.clear());

  it('resolves the control plane in single-cluster mode and the relay of the active cluster in fleet mode', () => {
    expect(resolveConsoleRestApi(environment(false), CLUSTER)).toBe('https://cp.example.com/api');
    expect(resolveConsoleRestApi(environment(true), CLUSTER)).toBe(`${FLEET}/clusters/${CLUSTER}/api`);
    expect(resolveConsoleRestApi(environment(true), null)).toBeNull();
    expect(fleetRelayApiUrl(`${FLEET}//`, CLUSTER)).toBe(`${FLEET}/clusters/${CLUSTER}/api`);
  });

  it('keeps single-cluster mode unchanged: no active cluster, console URLs', () => {
    const { endpoints, http } = setup(false);

    endpoints.setActiveCluster(CLUSTER);
    expect(endpoints.fleetMode).toBe(false);
    expect(endpoints.activeClusterId()).toBeNull();
    expect(endpoints.restApi()).toBe('https://cp.example.com/api');

    TestBed.inject(PlansService).list({}).subscribe();
    http.expectOne((req) => req.url === 'https://cp.example.com/api/plans').flush([]);
    http.verify();
  });

  it('sends the cluster views through the relay of the active cluster and remembers it per tab', () => {
    const { endpoints, http } = setup(true);

    endpoints.setActiveCluster(CLUSTER);
    expect(sessionStorage.getItem(FLEET_ACTIVE_CLUSTER_STORAGE_KEY)).toBe(CLUSTER);

    TestBed.inject(PlansService).list({}).subscribe();
    http.expectOne((req) => req.url === `${FLEET}/clusters/${CLUSTER}/api/plans`).flush([]);

    endpoints.setActiveCluster(OTHER);
    TestBed.inject(PlansService).list({}).subscribe();
    http.expectOne((req) => req.url === `${FLEET}/clusters/${OTHER}/api/plans`).flush([]);

    // Not a cluster id: ignored (left).
    endpoints.setActiveCluster('../../users');
    expect(endpoints.activeClusterId()).toBeNull();
    expect(sessionStorage.getItem(FLEET_ACTIVE_CLUSTER_STORAGE_KEY)).toBeNull();
    http.verify();
  });

  it('restores the active cluster after a reload', () => {
    sessionStorage.setItem(FLEET_ACTIVE_CLUSTER_STORAGE_KEY, CLUSTER);

    const { endpoints } = setup(true);

    expect(endpoints.activeClusterId()).toBe(CLUSTER);
    expect(endpoints.fleetSocketUrl()).toBe('https://fleet.example.com/socket/fleet');
  });

  it('maps the fleet grant to console access (not the service user of the relay)', async () => {
    const { endpoints, http } = setup(true);
    const service = TestBed.inject(AccessService);

    await expect(firstValueFrom(service.me())).resolves.toEqual({ userId: null, clusterRole: null, projects: {} });

    endpoints.setActiveCluster(CLUSTER);

    const me = firstValueFrom(service.me());

    http
      .expectOne(`${FLEET}/clusters/${CLUSTER}`)
      .flush({ id: CLUSTER, access: { clusterRole: 'operator', projects: { shop: 'admin' }, readOnly: false } });
    await expect(me).resolves.toEqual({
      userId: null,
      clusterRole: 'infra-operator',
      projects: { shop: 'admin' },
    });
    http.verify();
  });

  it('caps the mapped access during the read-only grace', () => {
    expect(accessFromFleetGrant({ clusterRole: 'admin', projects: {}, readOnly: false }).clusterRole).toBe(
      'cluster-admin',
    );
    expect(accessFromFleetGrant({ clusterRole: 'admin', projects: { shop: 'operator' }, readOnly: true })).toEqual({
      userId: null,
      clusterRole: 'auditor',
      projects: { shop: 'viewer' },
    });
    expect(accessFromFleetGrant({ clusterRole: 'viewer', projects: {}, readOnly: false }).clusterRole).toBe('auditor');
    expect(accessFromFleetGrant(null).clusterRole).toBeNull();
  });
});

describe('fleet relay refusals', () => {
  beforeEach(() => sessionStorage.clear());

  it('classifies only the fleet’s own refusals', () => {
    expect(fleetRelayRefusal(404, { message: 'GET git/connections is not relayed' })).toBe('unavailable');
    expect(fleetRelayRefusal(403, { message: 'needs the admin role' })).toBe('forbidden');
    expect(fleetRelayRefusal(403, { message: 'needs a cluster-wide grant' })).toBe('forbidden');
    expect(fleetRelayRefusal(403, { message: 'the cluster is in its read-only grace period' })).toBe('read-only');
    expect(fleetRelayRefusal(502, { message: 'cluster rejected the fleet credential', clusterStatus: 401 })).toBe(
      'credential',
    );
    expect(fleetRelayRefusal(502, { message: 'cluster refused the fleet credential: missing scope' })).toBe(
      'credential',
    );
    expect(fleetRelayRefusal(502, { message: 'Bad Gateway' })).toBeNull();
    // The cluster's own errors stay as they are.
    expect(fleetRelayRefusal(404, { message: 'plan not found' })).toBeNull();
    expect(fleetRelayRefusal(403, { message: 'Forbidden resource' })).toBeNull();
  });

  it('rewrites relay refusals into a clear message, leaves other errors alone', async () => {
    const { endpoints, http } = setup(true);

    endpoints.setActiveCluster(CLUSTER);

    const client = TestBed.inject(HttpClient);
    const refused = firstValueFrom(client.get(`${FLEET}/clusters/${CLUSTER}/api/git/connections`)).catch((e) => e);

    http
      .expectOne(`${FLEET}/clusters/${CLUSTER}/api/git/connections`)
      .flush({ statusCode: 404, message: 'GET git/connections is not relayed' }, { status: 404, statusText: 'NF' });

    const error = (await refused) as HttpErrorResponse;

    expect(error.status).toBe(404);
    expect(error.error).toMatchObject({ fleetRelay: 'unavailable' });
    expect(error.error.message).toContain('Not available through the fleet');

    const forbidden = firstValueFrom(client.post(`${FLEET}/clusters/${CLUSTER}/api/plans`, {})).catch((e) => e);

    http
      .expectOne(`${FLEET}/clusters/${CLUSTER}/api/plans`)
      .flush({ message: 'needs the operator role' }, { status: 403, statusText: 'Forbidden' });
    expect(((await forbidden) as HttpErrorResponse).error.message).toContain('No permission through the fleet');

    const clusterError = firstValueFrom(client.get(`${FLEET}/clusters/${CLUSTER}/api/plans/x`)).catch((e) => e);

    http
      .expectOne(`${FLEET}/clusters/${CLUSTER}/api/plans/x`)
      .flush({ message: 'plan not found' }, { status: 404, statusText: 'NF' });
    expect(((await clusterError) as HttpErrorResponse).error).toEqual({ message: 'plan not found' });
    http.verify();
  });
});

describe('FleetService', () => {
  beforeEach(() => sessionStorage.clear());

  it('talks to the fleet API (not the relay) for the fleet views', () => {
    const { http } = setup(true);
    const service = TestBed.inject(FleetService);

    service.clusters().subscribe();
    http.expectOne(`${FLEET}/clusters`).flush([]);

    service.createCluster({ name: 'b', endpoint: 'https://b.example.com', credential: 'x'.repeat(20) }).subscribe();
    expect(http.expectOne(`${FLEET}/clusters`).request.method).toBe('POST');

    service.updateCluster(CLUSTER, { description: 'd' }).subscribe();
    expect(http.expectOne(`${FLEET}/clusters/${CLUSTER}`).request.method).toBe('PATCH');

    service.putGrant(CLUSTER, { userId: OTHER, role: 'viewer', project: 'shop' }).subscribe();
    expect(http.expectOne(`${FLEET}/clusters/${CLUSTER}/grants`).request.body).toEqual({
      userId: OTHER,
      role: 'viewer',
      project: 'shop',
    });

    service.compare([CLUSTER, OTHER]).subscribe();
    http.expectOne(`${FLEET}/fleet/compare?clusters=${CLUSTER},${OTHER}`).flush({});

    service.audit({ cluster: CLUSTER, action: 'relay.request' }, 25, '120').subscribe();
    http.expectOne(`${FLEET}/audit?limit=25&cluster=${CLUSTER}&action=relay.request&before=120`).flush([]);

    service.cloudStatus('decabill:sub:item').subscribe();
    http.expectOne(`${FLEET}/cloud/clusters/decabill%3Asub%3Aitem`).flush({});

    service.users('ann').subscribe((users) => expect(users).toEqual([{ id: OTHER, email: 'ann@example.com' }]));
    http.expectOne(`${FLEET}/users?limit=20&search=ann`).flush([{ id: OTHER, email: 'ann@example.com', role: 'user' }]);
    http.verify();
  });

  it('reads source backups of any cluster through its relay, succeeded ones only', () => {
    const { http } = setup(true);
    let ids: string[] = [];

    TestBed.inject(FleetService)
      .sourceBackups(OTHER, 'shop')
      .subscribe((backups) => (ids = backups.map((b) => b.id)));
    http.expectOne(`${FLEET}/clusters/${OTHER}/api/backups?limit=200&project=shop`).flush([
      { id: 'a', status: 'succeeded' },
      { id: 'b', status: 'failed' },
    ]);
    expect(ids).toEqual(['a']);
    http.verify();
  });
});
