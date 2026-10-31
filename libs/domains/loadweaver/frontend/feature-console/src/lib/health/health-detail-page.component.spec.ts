import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  AutoscalingService,
  ConsoleHealthFacade,
  type HealthEntity,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { facadeStub } from '../testing';
import { LoadweaverHealthDetailPageComponent } from './health-detail-page.component';

const entity: HealthEntity = {
  key: 'deployment/shop/store',
  kind: 'deployment',
  name: 'store',
  parent: 'project/shop',
  project: 'shop',
  state: 'at-risk',
  reasons: [{ code: 'single-replica', message: 'one replica left', entities: ['replica/shop/store/web/0', 'n/a'] }],
  since: '2026-10-01T10:00:00.000Z',
};

describe('LoadweaverHealthDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverHealthDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      {
        entity$: entity,
        children$: [],
        entityLoading$: false,
        entityError$: null,
        history$: {
          key: entity.key,
          changes: [{ at: '2026-10-01T10:00:00.000Z', from: 'healthy', to: 'at-risk', message: 'one replica left' }],
          durations: { healthy: 2_550_000_000, 'at-risk': 42_000_000 },
        },
        historyLoading$: false,
        historyError$: null,
      },
      ['loadEntity', 'loadHistory'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverHealthDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ key: entity.key })) } },
        { provide: ConsoleHealthFacade, useValue: facade },
        { provide: AutoscalingService, useValue: { list: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverHealthDetailPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads the entity and its last 30 days of history', () => {
    expect(facade['loadEntity']).toHaveBeenCalledWith(entity.key);

    const [key, from, to] = (facade['loadHistory'] as jest.Mock).mock.calls[0];

    expect(key).toBe(entity.key);
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(30 * 86_400_000);
  });

  it('shows the reasons, the time per state and the changes', () => {
    expect(el().querySelector('[data-testid="health-reasons"]')?.textContent).toContain('single-replica');
    expect(el().querySelector('a[href="/observe/health/replica/shop/store/web/0"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="health-durations"]')?.textContent).toContain('29d 12h');
    expect(el().querySelector('[data-testid="health-durations"]')?.textContent).toContain('11h 40m');
    expect(el().querySelector('[data-testid="health-changes"]')?.textContent).toContain('one replica left');
  });

  it('reloads the history for another range', () => {
    fixture.componentInstance.onRangeChange(7);

    const [, from, to] = (facade['loadHistory'] as jest.Mock).mock.calls.at(-1);

    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(7 * 86_400_000);
  });

  it('heads the routed page with an object header (crumbs, one status glyph) and pins the time per state', () => {
    const header = el().querySelector('fpc-object-header[data-testid="health-entity"]');

    expect(header).not.toBeNull();
    expect(header?.querySelector('a[href="/observe/health"]')).not.toBeNull();
    expect(header?.querySelectorAll('fpc-status-badge')).toHaveLength(1);
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('.fpc-board-lane__toolbar [data-testid="health-time"]')).not.toBeNull();
  });

  it('embedded in an object tab: no header of its own', () => {
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    expect(el().querySelector('fpc-object-header')).toBeNull();
  });
});
