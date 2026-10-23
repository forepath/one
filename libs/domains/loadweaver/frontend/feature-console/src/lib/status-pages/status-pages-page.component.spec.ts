import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleStatusPagesFacade,
  createIncidentSuccess,
  type Incident,
} from '@forepath/loadweaver/frontend/data-access-console';
import { Actions } from '@ngrx/effects';
import { Subject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverIncidentModalComponent } from './incident-modal.component';
import { LoadweaverStatusPagesPageComponent } from './status-pages-page.component';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    project: 'shop',
    title: 'Slow checkout',
    status: 'investigating',
    updates: [
      { at: '2026-10-18T08:20:00.000Z', status: 'investigating', message: 'Checkout is slow.', by: 'u1' },
      { at: '2026-10-18T08:45:00.000Z', status: 'monitoring', message: 'A fix is deployed.', by: 'u1' },
    ],
    createdAt: '2026-10-18T08:20:00.000Z',
    updatedAt: '2026-10-18T08:45:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

const page = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'StatusPage',
  metadata: { name: 'public', project: 'shop' },
  spec: { host: 'status.example.com', title: 'Example Shop status', services: [{ service: 'web/api', name: 'API' }] },
};

describe('LoadweaverStatusPagesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverStatusPagesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let actions: Subject<unknown>;

  async function setup(projects: Record<string, string>, query: Record<string, string> = {}) {
    actions = new Subject();
    facade = facadeStub(
      {
        pages$: [page],
        pagesLoading$: false,
        pagesError$: null,
        incidents$: [
          incident(),
          incident({ id: 'i0', status: 'resolved', title: 'Old outage', createdAt: '2026-10-01' }),
        ],
        incidentsLoading$: false,
        incidentsError$: null,
        actionError$: null,
        creating$: false,
        updating$: null,
      },
      ['loadPages', 'loadIncidents', 'createIncident', 'updateIncident', 'clearActionError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverStatusPagesPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleStatusPagesFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: projects as never }),
        },
        { provide: Actions, useValue: actions },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverStatusPagesPageComponent);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists status pages with links to the public page and the editor', async () => {
    await setup({ shop: 'viewer' });

    expect(facade['loadPages']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="status-page-open"]')?.getAttribute('href')).toBe(
      'https://status.example.com/',
    );
    expect(el().querySelector('[data-testid="status-page-edit"]')?.getAttribute('href')).toBe(
      '/resources/StatusPage/public/edit?project=shop',
    );
  });

  it('loads the incidents of the first project, open ones first, read-only for viewers', async () => {
    await setup({ shop: 'viewer' }, { tab: 'incidents' });

    expect(facade['loadIncidents']).toHaveBeenCalledWith('shop');
    expect(fixture.componentInstance.sortedIncidents().map((i) => i.id)).toEqual(['i1', 'i0']);
    expect(fixture.componentInstance.openCount()).toBe(1);
    expect(fixture.componentInstance.mayWrite()).toBe(false);
    expect(el().querySelector('[data-testid="incident-new"]')).toBeNull();
  });

  it('lets operators open and update incidents through the modal', async () => {
    await setup({ shop: 'operator', blog: 'operator' }, { project: 'shop', tab: 'incidents' });

    const component = fixture.componentInstance;

    expect(component.project()).toBe('shop');
    expect(el().querySelector('[data-testid="incident-new"]')).not.toBeNull();

    component.toggle(incident());
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="incident-updates"]')?.textContent).toContain('A fix is deployed.');

    const modal = fixture.debugElement.query((d) => d.componentInstance instanceof LoadweaverIncidentModalComponent)
      .componentInstance as LoadweaverIncidentModalComponent;

    component.newIncident();
    fixture.detectChanges();
    modal.title = 'Checkout down';
    modal.status = 'identified';
    modal.message = 'Payments fail.';
    modal.submit();
    expect(facade['createIncident']).toHaveBeenCalledWith('shop', {
      title: 'Checkout down',
      status: 'identified',
      message: 'Payments fail.',
    });

    actions.next(createIncidentSuccess({ incident: incident() }));
    expect(component.modalOpen()).toBe(false);

    component.postUpdate(incident());
    fixture.detectChanges();
    expect(modal.status).toBe('identified');
    modal.message = '  ';
    modal.submit();
    expect(modal.invalid()).toBeTruthy();
    modal.status = 'resolved';
    modal.message = 'Fixed.';
    modal.submit();
    expect(facade['updateIncident']).toHaveBeenCalledWith('shop', 'i1', { status: 'resolved', message: 'Fixed.' });

    component.selectProject('blog');
    expect(facade['loadIncidents']).toHaveBeenLastCalledWith('blog');
  });
});
