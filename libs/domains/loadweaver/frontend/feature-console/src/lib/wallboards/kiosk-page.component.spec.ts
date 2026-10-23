import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsoleWallboardsFacade, type KioskView } from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { facadeStub } from '../testing';
import { LoadweaverKioskPageComponent } from './kiosk-page.component';

const token = `lw_wb_${'k'.repeat(43)}`;

const section = (scope: string, state: 'healthy' | 'failed' = 'healthy') => ({
  scope,
  headline: { state, message: `${scope} message`, key: null },
  inbox:
    state === 'failed'
      ? [
          {
            kind: 'alert' as const,
            severity: 'critical' as const,
            title: 'Disk full',
            link: '/alerts/1',
            project: 'shop',
          },
        ]
      : [],
  summary: {
    sites: 1,
    nodes: { total: 3, up: 2 },
    deployments: 5,
    capacity: null,
    requestsPerSecond: 12.5,
    deniedPackets5m: null,
    alertsFiring: state === 'failed' ? 1 : 0,
    slos: { total: 2, ok: 2, burning: 0, exhausted: 0 },
  },
});

const view: KioskView = { name: 'Office', sections: [section('cluster', 'failed'), section('shop')] };

describe('LoadweaverKioskPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverKioskPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(hash: string, streams: Record<string, unknown> = {}) {
    window.location.hash = hash;
    facade = facadeStub(
      {
        kiosk$: null,
        kioskLoading$: false,
        kioskError$: null,
        kioskUnauthorized$: false,
        kioskUpdatedAt$: null,
        ...streams,
      },
      ['loadKiosk'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverKioskPageComponent],
      providers: [{ provide: ConsoleWallboardsFacade, useValue: facade }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverKioskPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  afterEach(() => {
    window.location.hash = '';
  });

  it('explains a missing token without calling the API', async () => {
    await setup('');

    expect(facade['loadKiosk']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="kiosk-no-token"]')).not.toBeNull();
  });

  it('loads with the token from the fragment and rotates sections', async () => {
    await setup(`#${token}`, { kiosk$: view, kioskUpdatedAt$: '2026-10-01T10:00:00.000Z' });

    const component = fixture.componentInstance;

    expect(facade['loadKiosk']).toHaveBeenCalledWith(token);
    expect(el().querySelector('[data-testid="kiosk-scope"]')?.textContent).toContain('cluster');
    expect(el().querySelector('[data-testid="kiosk-headline"]')?.textContent).toContain('Failed');
    expect(el().querySelector('[data-testid="kiosk-inbox"]')?.textContent).toContain('Disk full');
    expect(el().querySelector('[data-testid="kiosk-summary"]')?.textContent).toContain('2 / 3');

    component.next();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="kiosk-scope"]')?.textContent).toContain('shop');
    expect(el().querySelector('[data-testid="kiosk-inbox"]')?.textContent).toContain('Nothing needs attention');

    (facade['kioskError$'] as BehaviorSubject<unknown>).next('Failed to fetch');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="kiosk-stale"]')?.textContent).toContain('Failed to fetch');
  });

  it('says clearly when the token is invalid or expired', async () => {
    await setup(`#${token}`, { kioskUnauthorized$: true, kioskError$: 'wallboard token required' });

    expect(el().querySelector('[data-testid="kiosk-unauthorized"]')?.textContent).toContain('not valid');
  });
});
