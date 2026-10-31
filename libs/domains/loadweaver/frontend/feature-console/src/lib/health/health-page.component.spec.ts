import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  buildHealthTree,
  ConsoleAccessFacade,
  ConsoleHealthFacade,
  type HealthEntity,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverHealthPageComponent } from './health-page.component';

const entities: HealthEntity[] = [
  {
    key: 'cluster',
    kind: 'cluster',
    name: 'cluster',
    parent: null,
    project: null,
    state: 'at-risk',
    reasons: [],
    since: '2026-10-01T10:00:00.000Z',
  },
  {
    key: 'node/n1',
    kind: 'node',
    name: 'n1',
    parent: 'cluster',
    project: null,
    state: 'failed',
    reasons: [{ code: 'node-down', message: 'no heartbeat for 2m' }],
    since: '2026-10-01T10:00:00.000Z',
  },
  {
    key: 'node/n2',
    kind: 'node',
    name: 'n2',
    parent: 'cluster',
    project: null,
    state: 'healthy',
    reasons: [],
    since: '2026-10-01T10:00:00.000Z',
  },
];

describe('LoadweaverHealthPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverHealthPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub({ tree$: buildHealthTree(entities), loading$: false, error$: null }, ['loadTree']);

    await TestBed.configureTestingModule({
      imports: [LoadweaverHealthPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleHealthFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'auditor', projects: { shop: 'viewer' } }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverHealthPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads the tree and shows states with readable reasons (no codes, no count badge), linking to the entity', () => {
    expect(facade['loadTree']).toHaveBeenCalledWith();

    const tree = el().querySelector('[data-testid="health-tree"]');

    // D7 / LW-04: the translated cause, not `node-down: <server message>`.
    expect(tree?.textContent).toContain('Node down');
    expect(tree?.textContent).not.toContain('node-down');
    expect(tree?.querySelector('.fpc-tree__badge')).toBeNull();
    expect(tree?.querySelector('fpc-tree [role="tree"]')).not.toBeNull();

    const row = Array.from(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []).find(
      (item) => item.querySelector('.fpc-tree__label')?.textContent?.trim() === 'n1',
    );
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    row?.click();
    expect(navigate).toHaveBeenCalledWith('/observe/health/node/n1');
  });

  it('narrows to what needs attention and reloads for a project', () => {
    const component = fixture.componentInstance;

    component.onlyUnhealthy.set(true);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="health-tree"]')?.textContent).not.toContain('n2');

    component.filterState.patch({ project: 'shop' });
    component.filterState.apply();
    expect(facade['loadTree']).toHaveBeenLastCalledWith('shop');
  });

  it('shows the tree in one lane with a count and searches the entities (ancestors stay)', () => {
    const component = fixture.componentInstance;
    const lane = el().querySelector('[data-testid="health-lane"]');

    expect(lane?.querySelector('[data-testid="health-search"]')).not.toBeNull();
    expect(lane?.querySelector('[data-testid="health-tree"]')).not.toBeNull();
    expect(component.entityCount()).toBeGreaterThan(0);

    component.search.set('node-down');
    fixture.detectChanges();
    expect(component.shown().length).toBeGreaterThan(0);
    expect(el().querySelector('[data-testid="health-tree"]')?.textContent).toContain('Node down');

    component.search.set('nothing-like-this');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="health-no-matches"]')).not.toBeNull();
  });
});
