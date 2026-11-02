import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConsoleAccessFacade, ConsoleAlertsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { Actions } from '@ngrx/effects';
import { of, Subject } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverAlertDetailPageComponent } from './alert-detail-page.component';

describe('LoadweaverAlertDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverAlertDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      {
        selected$: {
          id: 'a1',
          rule: 'builtin:node-down',
          key: 'node/n1',
          project: null,
          severity: 'critical',
          state: 'firing',
          title: 'Node n1 down',
          message: 'no heartbeat for 2m',
          value: null,
          startedAt: '2026-10-01T10:00:00.000Z',
          firedAt: '2026-10-01T10:01:00.000Z',
          resolvedAt: null,
          silenced: false,
          acknowledgedBy: null,
          acknowledgedAt: null,
        },
        selectedLoading$: false,
        selectedError$: null,
        acknowledging$: null,
        actionError$: null,
        silenceSaving$: false,
      },
      ['open', 'acknowledge', 'clearActionError', 'createSilence'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverAlertDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'a1' })) } },
        { provide: ConsoleAlertsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub() },
        { provide: Actions, useValue: new Subject() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverAlertDetailPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('opens the alert from the route and links its key to the health tree', () => {
    expect(facade['open']).toHaveBeenCalledWith('a1');
    expect(el().querySelector('[data-testid="alert-header"]')?.textContent).toContain('no heartbeat for 2m');
    expect(el().querySelector('a[href="/observe/health/node/n1"]')).not.toBeNull();
  });

  it('acknowledges and silences with the alert’s rule and key', () => {
    (el().querySelector('[data-testid="alert-acknowledge"] button') as HTMLButtonElement).click();
    expect(facade['acknowledge']).toHaveBeenCalledWith('a1');

    expect(fixture.componentInstance.prefill()).toEqual({ rule: 'builtin:node-down', key: 'node/n1', project: null });
  });

  it('heads with an object header (crumb back to the list, tone badges) and lists the facts', () => {
    const header = el().querySelector('fpc-object-header[data-testid="alert-header"]');

    expect(header?.querySelector('a[href="/observe/alerts"]')).not.toBeNull();
    expect(header?.querySelector('fpc-status-badge')).toBeNull();
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('[data-testid="alert-facts"].fpc-key-value-list')?.textContent).toContain(
      'builtin:node-down',
    );
    expect(
      el()
        .querySelector('[data-testid="alert-timeline"] [data-testid="fpc-data-table-state"]')
        ?.getAttribute('aria-label'),
    ).toBe('Condition met');
  });
});
