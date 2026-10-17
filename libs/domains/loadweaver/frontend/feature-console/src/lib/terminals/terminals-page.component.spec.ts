import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleLiveFacade,
  TerminalSocketClient,
  type LiveReplicaTarget,
  type TerminalSocketEvent,
} from '@forepath/loadweaver/frontend/data-access-console';
import { Subject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverTerminalsPageComponent } from './terminals-page.component';

function replica(id: string): LiveReplicaTarget {
  const [project, deployment, service, index] = id.split('/');

  return { id, project, deployment, service, index: Number(index), node: 'n1', state: 'running' };
}

describe('LoadweaverTerminalsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverTerminalsPageComponent>;
  let events: Subject<TerminalSocketEvent>;
  let client: Record<string, jest.Mock> & { events$: Subject<TerminalSocketEvent> };
  let live: ReturnType<typeof facadeStub>;

  async function create(query: Record<string, string> = {}, clusterAdmin = false) {
    events = new Subject();
    client = {
      events$: events,
      connect: jest.fn().mockResolvedValue(true),
      create: jest.fn(),
      input: jest.fn(),
      resize: jest.fn(),
      close: jest.fn(),
    };
    live = facadeStub(
      {
        replicas$: [replica('shop/web/api/0'), replica('shop/web/api/1'), replica('blog/site/web/0')],
        nodes$: ['n1', 'n2'],
        projects$: ['blog', 'shop'],
        targetsLoading$: false,
        targetsError$: null,
      },
      ['loadTargets'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverTerminalsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleLiveFacade, useValue: live },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub(
            clusterAdmin
              ? { userId: 'u', clusterRole: 'cluster-admin', projects: {} }
              : { userId: 'u', clusterRole: null, projects: { shop: 'operator' } },
          ),
        },
      ],
    })
      .overrideComponent(LoadweaverTerminalsPageComponent, {
        set: { providers: [{ provide: TerminalSocketClient, useValue: client }] },
      })
      .compileComponents();

    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverTerminalsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const component = () => fixture.componentInstance;

  it('loads targets and offers replicas grouped by deployment/service', async () => {
    await create();

    expect(live['loadTargets']).toHaveBeenCalled();
    component().onProjectChange('shop');
    fixture.detectChanges();

    const groups = [...el().querySelectorAll('[data-testid="terminals-replica"] optgroup')].map((g) =>
      g.getAttribute('label'),
    );

    expect(groups).toEqual(['web/api']);
    expect(el().querySelector('[data-testid="terminals-mode-node"]')).toBeNull();
    expect(el().textContent).toContain('No terminal open');
  });

  it('opens a deep-linked replica and speaks the protocol', async () => {
    await create({ replica: 'shop/web/api/1' });

    expect(client['create']).toHaveBeenCalledWith(
      expect.objectContaining({ target: { replica: 'shop/web/api/1' }, cols: 120, rows: 32 }),
    );

    const [{ sessionId }] = client['create'].mock.calls[0];
    const tab = component().tabs()[0];

    events.next({ type: 'created', sessionId, recorded: true });
    fixture.detectChanges();

    expect(component().tabs()[0].status).toBe('open');
    expect(el().querySelector('[data-testid="terminals-recorded"]')).not.toBeNull();

    component().onResize(component().tabs()[0], { cols: 100, rows: 30 });
    component().onResize(component().tabs()[0], { cols: 100, rows: 30 });
    expect(client['resize']).toHaveBeenCalledTimes(1);
    expect(client['resize']).toHaveBeenCalledWith(sessionId, 100, 30);

    component().onInput(component().tabs()[0], 'ls\r');
    expect(client['input']).toHaveBeenCalledWith(sessionId, 'ls\r');

    events.next({ type: 'closed', sessionId, exitCode: 130 });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="terminals-closed"]')?.textContent).toContain('130');

    // Input to an ended session goes nowhere.
    component().onInput(component().tabs()[0], 'x');
    expect(client['input']).toHaveBeenCalledTimes(1);
    expect(tab.label).toBe('shop/web/api/1');
  });

  it('shows a refused node shell in its tab and closes tabs', async () => {
    await create({}, true);

    component().mode.set('node');
    component().node.set('n2');
    component().open();
    await fixture.whenStable();

    const [{ sessionId, target }] = client['create'].mock.calls[0];

    expect(target).toEqual({ node: 'n2' });
    events.next({ type: 'error', sessionId, message: 'node shells are disabled' });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="terminals-failed"]')?.textContent).toContain('node shells are disabled');

    events.next({ type: 'error', message: 'too many terminals' });
    fixture.detectChanges();
    expect(el().textContent).toContain('too many terminals');

    component().closeTab(component().tabs()[0]);
    fixture.detectChanges();
    expect(component().tabs()).toEqual([]);
    expect(client['close']).not.toHaveBeenCalled();
  });

  it('ends open sessions when the socket disconnects or the page is left', async () => {
    await create({ replica: 'shop/web/api/0' });

    const [{ sessionId }] = client['create'].mock.calls[0];

    events.next({ type: 'created', sessionId, recorded: false });
    await component().openTerminal({ replica: 'shop/web/api/1' });

    const second = client['create'].mock.calls[1][0].sessionId;

    events.next({ type: 'created', sessionId: second, recorded: false });
    events.next({ type: 'connection', connected: false });
    expect(
      component()
        .tabs()
        .map((t) => t.status),
    ).toEqual(['closed', 'closed']);

    await component().openTerminal({ replica: 'shop/web/api/1' });
    fixture.destroy();
    expect(client['close']).toHaveBeenCalledTimes(1);
  });

  it('reports a missing connection', async () => {
    await create();
    client['connect'].mockResolvedValue(false);
    await component().openTerminal({ replica: 'shop/web/api/0' });

    expect(component().tabs()[0]).toMatchObject({ status: 'failed' });
    expect(client['create']).not.toHaveBeenCalled();
  });

  it('asks before opening a deep-linked node shell', async () => {
    await create({ node: 'n2' }, true);

    expect(client['connect']).not.toHaveBeenCalled();
    expect(component().tabs()).toEqual([]);
    expect(component().pendingNode()).toBe('n2');
    expect(component().nodeConfirmMessage()).toContain('n2');

    component().onPendingNodeOpenChange(false);
    expect(component().pendingNode()).toBeNull();
    expect(client['create']).not.toHaveBeenCalled();

    component().pendingNode.set('n2');
    component().confirmPendingNode();
    await fixture.whenStable();

    expect(client['create']).toHaveBeenCalledTimes(1);
    expect(client['create'].mock.calls[0][0].target).toEqual({ node: 'n2' });
  });

  it("doesn't create a session when the page is left while connecting", async () => {
    await create();

    let resolve!: (connected: boolean) => void;

    client['connect'].mockReturnValue(new Promise<boolean>((r) => (resolve = r)));

    const opening = component().openTerminal({ replica: 'shop/web/api/0' });

    fixture.destroy();
    resolve(true);
    await opening;

    expect(client['create']).not.toHaveBeenCalled();
  });

  it("doesn't create a session for a tab closed while connecting", async () => {
    await create();

    let resolve!: (connected: boolean) => void;

    client['connect'].mockReturnValue(new Promise<boolean>((r) => (resolve = r)));

    const opening = component().openTerminal({ replica: 'shop/web/api/0' });

    component().closeTab(component().tabs()[0]);
    resolve(true);
    await opening;

    expect(client['create']).not.toHaveBeenCalled();
  });
});
