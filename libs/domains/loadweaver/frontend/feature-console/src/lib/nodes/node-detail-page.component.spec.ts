import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  type ConsoleNode,
  ConsoleNodesFacade,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverNodeDetailPageComponent } from './node-detail-page.component';

const node = {
  name: 'n2',
  site: 'fra1',
  lifecycle: 'draining',
  labels: { role: 'edge' },
  controlPlane: false,
  witness: false,
  agentVersion: '1.2.0',
  os: { id: 'debian', versionId: '13', kernel: '6.12.0', arch: 'amd64' },
  capabilities: null,
  capacity: { cpuMillis: 4000, memoryBytes: 8 * 1024 ** 3, diskBytes: 100 * 1024 ** 3 },
  usage: { cpuMillis: 3800, memoryBytes: 2 * 1024 ** 3, diskBytes: 10 * 1024 ** 3 },
  endpointHost: 'n2.example.com',
  overlayV4: '10.255.0.2',
  overlayV6: null,
  podSubnetV4: '10.20.2.0/24',
  podSubnetV6: null,
  appliedRevision: 7,
  applyStatus: 'failed',
  applyError: 'nft: syntax error',
  certificateNotAfter: '2027-01-01T00:00:00.000Z',
  lastSeenAt: '2026-10-01T10:00:00.000Z',
  connected: true,
  joinedAt: '2026-09-01T10:00:00.000Z',
} as ConsoleNode;

describe('LoadweaverNodeDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverNodeDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function open(selected: ConsoleNode): Promise<void> {
    TestBed.resetTestingModule();
    facade = facadeStub(
      { selected$: selected, selectedLoading$: false, selectedError$: null, acting$: null, actionError$: null },
      ['open', 'act', 'clearActionError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverNodeDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ name: 'n2' })) } },
        { provide: ConsoleNodesFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverNodeDetailPageComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => await open(node));

  const el = () => fixture.nativeElement as HTMLElement;

  it('opens the node and shows status, capacity, network and system', () => {
    expect(facade['open']).toHaveBeenCalledWith('n2');
    expect(el().querySelector('[data-testid="node-status"]')?.textContent).toContain('nft: syntax error');
    expect(el().querySelector('[data-testid="node-status"]')?.textContent).toContain('role=edge');
    expect(el().querySelector('[data-testid="node-capacity-cpu"]')?.textContent).toContain('3.8 / 4.0');
    expect(el().querySelector('[data-testid="node-network"]')?.textContent).toContain('10.20.2.0/24');
    expect(el().textContent).toContain('debian 13');
  });

  it('shows no capacity bars for an offline node: the last reported usage says nothing about now', async () => {
    await open({ ...node, connected: false });

    expect(el().querySelector('[data-testid="node-capacity-cpu"]')).toBeNull();
    expect(el().querySelector('[data-testid="node-capacity-offline"]')?.textContent).toContain('The node is offline');
  });

  it('has no header strip of its own: lifecycle as a tone badge in the Status facts, groups as list headers (3.38)', () => {
    expect(el().querySelector('[data-testid="node-header"]')).toBeNull();
    expect(el().querySelector('fpc-status-badge')).toBeNull();
    expect(el().querySelector('[data-testid="node-status"] [data-testid="node-lifecycle"]')).not.toBeNull();
    expect(el().querySelector('dl.row')).toBeNull();
    expect([...el().querySelectorAll('fpc-list-header')].map((h) => h.textContent?.trim())).toEqual([
      'Capacity',
      'System',
    ]);
    expect(el().querySelector('[data-testid="node-lane-system"]')?.textContent).toContain('Network & system');
  });
});
