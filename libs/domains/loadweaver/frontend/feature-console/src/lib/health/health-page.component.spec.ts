import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

  it('loads the tree and shows states with machine-readable reasons, linking to the entity', () => {
    expect(facade['loadTree']).toHaveBeenCalledWith();

    const tree = el().querySelector('[data-testid="health-tree"]');

    expect(tree?.textContent).toContain('node-down');
    expect(tree?.textContent).toContain('no heartbeat for 2m');
    expect(tree?.querySelector('a[href="/health/node/n1"]')).not.toBeNull();
  });

  it('narrows to what needs attention and reloads for a project', () => {
    const component = fixture.componentInstance;

    component.onlyUnhealthy.set(true);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="health-tree"]')?.textContent).not.toContain('n2');

    component.onProjectChange('shop');
    expect(facade['loadTree']).toHaveBeenLastCalledWith('shop');
  });
});
