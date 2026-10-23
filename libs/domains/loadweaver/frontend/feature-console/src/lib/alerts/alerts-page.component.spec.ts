import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AlertsService,
  ConsoleAccessFacade,
  ConsoleAlertsFacade,
  type Alert,
} from '@forepath/loadweaver/frontend/data-access-console';
import { Actions } from '@ngrx/effects';
import { of, Subject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
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
  const service = { export: jest.fn().mockReturnValue(of('id,rule\n')) };

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

  it('loads open alerts and the silences', () => {
    expect(facade['load']).toHaveBeenCalledWith({ state: 'open' });
    expect(facade['loadSilences']).toHaveBeenCalledWith(false);
    expect(el().querySelector('[data-testid="alerts-list"]')?.textContent).toContain('Node n1 down');
  });

  it('narrows open alerts to firing on the client and filters by severity and project', () => {
    const component = fixture.componentInstance;

    component.onStateChange('firing');
    expect(facade['load']).toHaveBeenLastCalledWith({ state: 'open' });
    expect(component.filtered().map((a) => a.id)).toEqual(['a1']);

    component.onStateChange('all');
    component.severity.set('warning');
    expect(component.filtered().map((a) => a.id)).toEqual(['a2']);

    component.onProjectChange('shop');
    expect(facade['load']).toHaveBeenLastCalledWith({ state: 'all', project: 'shop' });
  });

  it('acknowledges firing alerts without opening them', () => {
    const event = { stopPropagation: jest.fn() } as unknown as Event;

    fixture.componentInstance.acknowledge(alert(), event);

    expect(facade['acknowledge']).toHaveBeenCalledWith('a1');
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(el().querySelectorAll('[data-testid="alert-acknowledge"]')).toHaveLength(1);
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

  it('ends a silence after confirming', () => {
    const component = fixture.componentInstance;

    component.silenceToEnd.set({
      id: 's1',
      rule: null,
      project: 'shop',
      key: null,
      reason: 'x',
      createdBy: null,
      startsAt: '',
      endsAt: '',
    });
    component.confirmEndSilence();

    expect(facade['endSilence']).toHaveBeenCalledWith('s1');
    expect(component.silenceToEnd()).toBeNull();
  });
});
