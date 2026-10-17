import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  type ConsoleNode,
  ConsoleNodesFacade,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { joinCommand, LoadweaverNodesPageComponent } from './nodes-page.component';

const node = (overrides: Partial<ConsoleNode> = {}): ConsoleNode =>
  ({
    name: 'n1',
    site: 'fra1',
    lifecycle: 'active',
    labels: {},
    controlPlane: true,
    witness: false,
    agentVersion: '1.2.0',
    capacity: { cpuMillis: 4000, memoryBytes: 8 * 1024 ** 3, diskBytes: 1024 ** 4 },
    usage: { cpuMillis: 1000, memoryBytes: 2 * 1024 ** 3, diskBytes: 1024 ** 3 },
    endpointHost: 'n1.example.com',
    applyStatus: 'applied',
    connected: true,
    lastSeenAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }) as ConsoleNode;

const token = {
  id: 't1',
  tokenPrefix: 'lwj_ab',
  description: 'rack 2',
  site: 'fra1',
  labels: {},
  witness: false,
  expiresAt: '2026-10-01T11:00:00.000Z',
  usedAt: null,
  usedByNode: null,
  revokedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('LoadweaverNodesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverNodesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(clusterRole: 'cluster-admin' | 'auditor' = 'cluster-admin') {
    const nodes = [
      node(),
      node({ name: 'n2', connected: false, controlPlane: false }),
      node({ name: 'n3', site: 'ams1' }),
    ];

    facade = facadeStub(
      {
        nodes$: nodes,
        sites$: [
          { site: 'ams1', nodes: [nodes[2]] },
          { site: 'fra1', nodes: [nodes[0], nodes[1]] },
        ],
        cluster$: {
          clusterId: 'c-1',
          displayName: 'Production',
          caCertificate: '',
          desiredRevision: 12,
          nodes: { total: 3, connected: 2, sites: ['ams1', 'fra1'] },
          controlPlane: {
            members: ['n1', 'n3'],
            votingWitnesses: [],
            automaticFailover: false,
            warnings: ['add a witness'],
          },
        },
        loading$: false,
        error$: null,
        tokens$: [token],
        tokensError$: null,
        creatingToken$: false,
        createdToken$: null,
        revokingToken$: null,
        tokenError$: null,
      },
      ['load', 'loadJoinTokens', 'createJoinToken', 'clearCreatedJoinToken', 'revokeJoinToken'],
    );
    facade['installScriptUrl'] = jest.fn().mockReturnValue('https://cp.example.com/api/install/install.sh');

    await TestBed.configureTestingModule({
      imports: [LoadweaverNodesPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleNodesFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub({ userId: 'u', clusterRole, projects: {} }) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverNodesPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows nodes per site, the cluster and join tokens', async () => {
    await setup();

    expect(facade['load']).toHaveBeenCalled();
    expect(facade['loadJoinTokens']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="nodes-cluster"]')?.textContent).toContain('Production');
    expect(el().textContent).toContain('add a witness');

    const fra1 = el().querySelector('[data-testid="nodes-site-fra1"]')?.textContent ?? '';

    expect(fra1).toContain('n1');
    expect(fra1).toContain('Control plane');
    expect(fra1).toContain('Disconnected');
    expect(fra1).toContain('1.0/4.0');
    expect(el().querySelector('[data-testid="nodes-tokens"]')?.textContent).toContain('rack 2');
    expect(fixture.componentInstance.connectedCount()).toBe(2);
  });

  it('hides join tokens from auditors', async () => {
    await setup('auditor');

    expect(facade['loadJoinTokens']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="nodes-add"]')).toBeNull();
    expect(el().querySelector('[data-testid="nodes-tokens"]')).toBeNull();
  });

  it('creates a join token and shows the installer once', async () => {
    await setup();

    const component = fixture.componentInstance;

    component.openJoin();
    expect(component.site).toBe('ams1');

    component.site = 'Bad Site';
    component.createToken();
    expect(component.invalid()).toBe(true);
    expect(facade['createJoinToken']).not.toHaveBeenCalled();

    component.site = 'fra1';
    component.labels = 'rack=2';
    component.witness = true;
    component.description = ' spare ';
    component.createToken();
    expect(facade['createJoinToken']).toHaveBeenCalledWith({
      ttlMinutes: 60,
      witness: true,
      site: 'fra1',
      description: 'spare',
      labels: { rack: '2' },
    });

    (facade['createdToken$'] as BehaviorSubject<unknown>).next({ ...token, token: 'lwj_secret' });
    fixture.detectChanges();

    expect(component.joinCommand()).toBe(
      "printf 'Join token: ' && read -rs LOADWEAVER_JOIN_TOKEN && echo && export LOADWEAVER_JOIN_TOKEN && " +
        'curl -fsSL https://cp.example.com/api/install/install.sh | sudo --preserve-env=LOADWEAVER_JOIN_TOKEN bash -s -- --name <node-name>',
    );
    // The token is shown (to paste at the prompt) but never part of the line.
    expect(component.joinCommand()).not.toContain('lwj_secret');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="nodes-join-token"]')?.value,
    ).toBe('lwj_secret');

    component.onJoinOpenChange(false);
    expect(facade['clearCreatedJoinToken']).toHaveBeenCalledTimes(2);
  });

  it('revokes a token after confirmation and opens nodes', async () => {
    await setup();

    const component = fixture.componentInstance;
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.revokeFor.set(token);
    component.confirmRevoke();
    expect(facade['revokeJoinToken']).toHaveBeenCalledWith('t1');
    expect(component.revokeFor()).toBeNull();

    component.open(node());
    expect(navigate).toHaveBeenCalledWith(['/nodes', 'n1']);
  });

  it('builds the installer line', () => {
    const line = joinCommand('https://x/install.sh');

    expect(line).toContain('read -rs LOADWEAVER_JOIN_TOKEN');
    expect(line).toContain('curl -fsSL https://x/install.sh | sudo --preserve-env=LOADWEAVER_JOIN_TOKEN bash -s --');
    expect(line).not.toMatch(/LOADWEAVER_JOIN_TOKEN=/);
  });
});
