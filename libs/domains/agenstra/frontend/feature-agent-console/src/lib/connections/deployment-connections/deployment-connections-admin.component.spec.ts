import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ClientsFacade,
  DeploymentConnectionsFacade,
  DeploymentConnectionsService,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import type { DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { BehaviorSubject, NEVER, of, Subject } from 'rxjs';

import { DeploymentConnectionsAdminComponent } from './deployment-connections-admin.component';

function connection(overrides: Partial<DeploymentConnectionSummary> = {}): DeploymentConnectionSummary {
  return {
    id: 'k1',
    label: 'GitHub',
    provider: 'github',
    baseUrl: null,
    authType: 'app',
    appId: '1',
    installationId: '2',
    username: null,
    workspaceAccess: 'selected',
    allowedClientIds: ['client-1'],
    lastTestStatus: 'failed',
    lastTestMessage: 'Bad credentials',
    lastTestedAt: '2026-11-01T10:00:00.000Z',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function callableStream(): unknown {
  const stream = new Subject<never>();

  return Object.assign(jest.fn(), {
    subscribe: stream.subscribe.bind(stream),
    pipe: stream.pipe.bind(stream),
    lift: stream.lift.bind(stream),
    [Symbol.observable ?? '@@observable']: () => stream,
  });
}

function autoMock(base: Record<string, unknown> = {}): unknown {
  return new Proxy(base, {
    get: (target, prop) => {
      if (typeof prop !== 'string' || prop in target) return target[prop as string];

      target[prop] = prop.endsWith('$') ? callableStream() : jest.fn(() => NEVER);

      return target[prop];
    },
  });
}

describe('DeploymentConnectionsAdminComponent', () => {
  let fixture: ComponentFixture<DeploymentConnectionsAdminComponent>;
  let facade: Record<string, jest.Mock> & { saving$: BehaviorSubject<boolean>; error$: BehaviorSubject<string | null> };
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    facade = autoMock({
      connections$: new BehaviorSubject([connection()]),
      hasNext$: new BehaviorSubject(false),
      loading$: new BehaviorSubject(false),
      saving$: new BehaviorSubject(false),
      testingIds$: new BehaviorSubject([]),
      lastTest$: new BehaviorSubject(null),
      error$: new BehaviorSubject<string | null>(null),
      load: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      test: jest.fn(),
      clearError: jest.fn(),
    }) as typeof facade;
    service = { test: jest.fn(() => of({ ok: true, testedAt: 't' })), delete: jest.fn(() => of(undefined)) };

    await TestBed.configureTestingModule({
      imports: [DeploymentConnectionsAdminComponent],
      providers: [
        provideRouter([]),
        { provide: DeploymentConnectionsFacade, useValue: facade },
        { provide: DeploymentConnectionsService, useValue: service },
        {
          provide: ClientsFacade,
          useValue: autoMock({ clients$: new BehaviorSubject([{ id: 'client-1', name: 'Shop' }]) }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeploymentConnectionsAdminComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('loads the first page and shows the connection status with its message', () => {
    expect(facade.load).toHaveBeenLastCalledWith({ search: '', provider: null, limit: 25, offset: 0 });

    const table = fixture.nativeElement.querySelector('[data-testid="deployment-connections-table"]') as HTMLElement;

    expect(table.textContent).toContain('Bad credentials');
    expect(table.textContent).toContain('1 selected');
  });

  it('creates a GitLab connection with the token auth type only', () => {
    const component = fixture.componentInstance;

    component.openCreate();
    component.onProviderChange('gitlab');
    expect(component.form().authType).toBe('token');
    expect(component.authTypes()).toEqual(['token']);
    component.patchForm({ label: 'GitLab', token: 'glpat' });
    expect(component.formError()).toBeNull();
    component.onSave();

    expect(facade.create).toHaveBeenCalledWith({
      label: 'GitLab',
      provider: 'gitlab',
      authType: 'token',
      token: 'glpat',
      workspaceAccess: 'all',
      allowedClientIds: [],
    });

    facade.saving$.next(true);
    fixture.detectChanges();
    facade.saving$.next(false);
    fixture.detectChanges();
    expect(component.editorOpen()).toBe(false);
  });

  it('keeps stored secrets on edit', () => {
    const component = fixture.componentInstance;

    component.openEdit(connection());
    expect(component.secretsOptional()).toBe(true);
    component.patchForm({ label: 'Renamed' });
    component.onSave();

    expect(facade.update).toHaveBeenCalledWith('k1', expect.not.objectContaining({ privateKey: expect.anything() }));
    expect(facade.update.mock.calls[0][1]).toMatchObject({ label: 'Renamed', allowedClientIds: ['client-1'] });
  });

  it('tests single and selected connections and deletes after confirmation', async () => {
    const component = fixture.componentInstance;

    component.onRowAction(connection(), 'test');
    expect(facade.test).toHaveBeenCalledWith('k1');

    component.selectedIds.set(['k1']);
    component.onBulkTest();
    await fixture.whenStable();
    expect(service['test']).toHaveBeenCalledWith('k1');

    component.onRequestDelete(connection());
    expect(component.deleteConfirmOpen()).toBe(true);
    component.onConfirmDelete();
    expect(facade.delete).toHaveBeenCalledWith('k1');
  });
});
