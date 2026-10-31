import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AlertsService,
  ConsoleAccessFacade,
  ConsoleAlertsFacade,
  type Alert,
} from '@forepath/loadweaver/frontend/data-access-console';
import { Actions } from '@ngrx/effects';
import { type BehaviorSubject, of, Subject, throwError } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverAlertSilencesLaneComponent } from './alert-silences-lane.component';
import { LoadweaverAlertsPageComponent } from './alerts-page.component';

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    rule: 'builtin:node-down',
    key: 'node/n1',
    project: null,
    severity: 'critical',
    state: 'firing',
    title: 'Node n1 down',
    message: 'no heartbeat',
    value: null,
    startedAt: '2026-10-01T10:00:00.000Z',
    firedAt: '2026-10-01T10:01:00.000Z',
    resolvedAt: null,
    silenced: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

describe('LoadweaverAlertsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverAlertsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  const service = {
    export: jest.fn().mockReturnValue(of('id,rule\n')),
    acknowledge: jest.fn(),
    endSilence: jest.fn(),
  };

  beforeEach(async () => {
    facade = facadeStub(
      {
        alerts$: [alert(), alert({ id: 'a2', state: 'pending', severity: 'warning', title: 'Disk filling' })],
        loading$: false,
        error$: null,
        acknowledging$: null,
        actionError$: null,
        silences$: [
          {
            id: 's1',
            rule: null,
            project: 'shop',
            key: null,
            reason: 'maintenance window',
            createdBy: 'u1',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2999-01-01T00:00:00.000Z',
          },
        ],
        silencesLoading$: false,
        silencesError$: null,
        silencesExpired$: false,
        endingSilence$: null,
        silenceSaving$: false,
      },
      ['load', 'loadSilences', 'acknowledge', 'endSilence', 'createSilence', 'clearActionError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverAlertsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleAlertsFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } }),
        },
        { provide: AlertsService, useValue: service },
        { provide: Actions, useValue: new Subject() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverAlertsPageComponent);
    fixture.detectChanges();
    // The tab group activates its tabs after the first render (the page's refresh interval keeps the zone busy).
    TestBed.tick();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const component = () => fixture.componentInstance;

  it('loads open alerts and the silences', () => {
    expect(facade['load']).toHaveBeenCalledWith({ state: 'open' });
    expect(el().querySelector('[data-testid="alerts-list"]')?.textContent).toContain('Node n1 down');
  });

  it('searches alerts; no matches replaces the rows; State column first', () => {
    const component = fixture.componentInstance;

    expect(el().querySelector('fpc-list-header')).toBeNull();
    expect(el().querySelector('[data-testid="alerts-list"] a.fpc-data-table__link')?.getAttribute('href')).toBe(
      '/observe/alerts/a1',
    );

    component.search.set('disk');
    fixture.detectChanges();
    expect(component.filtered().map((a) => a.id)).toEqual(['a2']);
    expect(el().querySelector('fpc-list-header')).toBeNull();

    expect(
      el()
        .querySelector('[data-testid="alerts-list"] [data-testid="fpc-data-table-state"]')
        ?.getAttribute('aria-label'),
    ).toBe('Pending');
    expect(el().querySelector('[data-testid="alerts-list"] fpc-status-badge')).toBeNull();

    component.search.set('maintenance');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="alerts-list"] [data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
  });

  it('narrows open alerts to firing on the client and filters by severity and project', () => {
    const component = fixture.componentInstance;

    component.filterState.patch({ state: 'firing' });
    component.filterState.apply();
    expect(facade['load']).toHaveBeenLastCalledWith({ state: 'open' });
    expect(component.filtered().map((a) => a.id)).toEqual(['a1']);

    component.filterState.patch({ state: 'all', severity: 'warning' });
    component.filterState.apply();
    expect(component.filtered().map((a) => a.id)).toEqual(['a2']);

    component.filterState.patch({ project: 'shop' });
    component.filterState.apply();
    expect(facade['load']).toHaveBeenLastCalledWith({ state: 'all', project: 'shop' });
    expect(component.filterState.activeCount()).toBe(3);
  });

  it('acknowledges firing alerts without opening them', () => {
    const event = { stopPropagation: jest.fn() } as unknown as Event;

    fixture.componentInstance.acknowledge(alert(), event);

    expect(facade['acknowledge']).toHaveBeenCalledWith('a1');
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(fixture.componentInstance.rowMenu(alert()).map((item) => item.id)).toContain('acknowledge');
    expect(fixture.componentInstance.rowMenu(alert({ state: 'pending' })).map((item) => item.id)).not.toContain(
      'acknowledge',
    );
  });

  it('acknowledges the selected firing alerts one by one and reports per alert', async () => {
    const component = fixture.componentInstance;

    (facade['alerts$'] as BehaviorSubject<unknown>).next([
      alert(),
      alert({ id: 'a3', title: 'Theirs' }),
      alert({ id: 'a2', state: 'pending' }),
    ]);
    service.acknowledge.mockImplementation((id: string) =>
      id === 'a3' ? throwError(() => ({ status: 403 })) : of(alert({ acknowledgedBy: 'u' })),
    );
    component.selected.set(['a1', 'a3', 'a2']);
    expect(component.acknowledgeable().map((a) => a.id)).toEqual(['a1', 'a3']);
    await component.acknowledgeSelected();
    expect(service.acknowledge).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.tone).toBe('warning');
    expect(component.bulkResult()?.message).toContain('Theirs');
    expect(component.selected()).toEqual([]);
  });

  it('exports with the list filter', () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:x');
    const revokeObjectURL = jest.fn();

    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    fixture.componentInstance.export('csv');

    expect(service.export).toHaveBeenCalledWith({ state: 'open' }, 'csv');
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('switches to the silences lane below xl: search, New silence, End after confirming', () => {
    const component = fixture.componentInstance;

    expect(el().querySelector('fpc-tab-group[data-testid="alerts-lane-tabs"]')?.classList).toContain('d-xl-none');
    expect(el().querySelector('loadweaver-alert-silences-lane')).toBeNull();

    component.lane.set('silences');
    fixture.detectChanges();

    const lane = el().querySelector('loadweaver-alert-silences-lane') as HTMLElement;

    expect(lane).not.toBeNull();
    expect(el().querySelector('[data-testid="alerts-lane"]')?.classList).toContain('d-none');
    expect(lane.querySelector('[data-testid="silences-list"]')?.textContent).toContain('maintenance window');
    expect(lane.querySelector('[data-testid="silence-new"]')).not.toBeNull();
    expect(lane.querySelector('input[placeholder="Search silences"]')).not.toBeNull();

    const silences = fixture.debugElement.query((de) => de.name === 'loadweaver-alert-silences-lane')
      .componentInstance as LoadweaverAlertSilencesLaneComponent;

    expect(silences.rowMenu(silences.silences()[0]).map((item) => item.id)).toEqual(['end', 'copy-id']);
    silences.onRowAction(silences.silences()[0], 'end');
    fixture.detectChanges();

    expect(silences.silenceToEnd()?.id).toBe('s1');
    silences.confirmEnd();
    expect(facade['endSilence']).toHaveBeenCalledWith('s1');
    expect(silences.silenceToEnd()).toBeNull();

    silences.search.set('nothing-like-this');
    fixture.detectChanges();
    expect(
      lane.querySelector('[data-testid="silences-list"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
  });

  it('ends the selected silences one by one and reports per silence', async () => {
    component().lane.set('silences');
    fixture.detectChanges();

    const silences = fixture.debugElement.query((de) => de.name === 'loadweaver-alert-silences-lane')
      .componentInstance as LoadweaverAlertSilencesLaneComponent;

    (facade['silences$'] as BehaviorSubject<unknown>).next([
      ...silences.silences(),
      { ...silences.silences()[0], id: 's2', reason: 'not mine' },
    ]);
    service.endSilence.mockImplementation((id: string) =>
      id === 's2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    silences.selected.set(['s1', 's2']);
    await silences.endSelected();
    expect(service.endSilence).toHaveBeenCalledWith('s1');
    expect(service.endSilence).toHaveBeenCalledWith('s2');
    expect(silences.bulkResult()?.message).toContain('not mine');
    expect(facade['loadSilences']).toHaveBeenCalled();
  });
});
