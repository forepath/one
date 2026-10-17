import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  type ConsoleResource,
  ConsoleResourcesFacade,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { CLUSTER_SCOPE, LoadweaverResourcesPageComponent } from './resources-page.component';

const resources: ConsoleResource[] = [
  {
    apiVersion: 'loadweaver.com/v1',
    kind: 'Deployment',
    metadata: { name: 'web', project: 'shop' },
    spec: { compose: 'services: {}' },
  },
  {
    apiVersion: 'loadweaver.com/v1',
    kind: 'Policy',
    metadata: { name: 'allow-web', project: 'shop' },
    spec: { description: 'Internet to the shop' },
  },
  { apiVersion: 'loadweaver.com/v1', kind: 'Site', metadata: { name: 'fra1' }, spec: {} },
];

describe('LoadweaverResourcesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverResourcesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(query: Record<string, string> = {}) {
    facade = facadeStub(
      {
        resources$: resources,
        loading$: false,
        error$: null,
        counts$: { Deployment: 1, Policy: 1, Site: 1 },
        kinds$: [
          { kind: 'Policy', description: 'Allow rule between groups' },
          { kind: 'AlertRule', description: 'An alert' },
        ],
        projects$: ['shop'],
      },
      ['load', 'loadKinds'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverResourcesPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleResourcesFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'infra-operator', projects: { blog: 'viewer' } }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverResourcesPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads resources and kinds and lists them', async () => {
    await setup();

    expect(facade['load']).toHaveBeenCalled();
    expect(facade['loadKinds']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="resources-list"]')?.textContent).toContain('allow-web');
    expect(fixture.componentInstance.kinds()).toEqual(['Deployment', 'Policy', 'Site', 'AlertRule']);
    expect(fixture.componentInstance.projects()).toEqual(['blog', 'shop']);
  });

  it('filters by kind and project from the query and by search', async () => {
    await setup({ kind: 'Policy', project: 'shop' });

    const component = fixture.componentInstance;

    expect(component.filtered().map((r) => r.metadata.name)).toEqual(['allow-web']);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="resources-kind-description"]')?.textContent).toContain(
      'Allow rule between groups',
    );

    component.kind.set('');
    component.project.set(CLUSTER_SCOPE);
    expect(component.filtered().map((r) => r.metadata.name)).toEqual(['fra1']);

    component.project.set('');
    component.search.set('internet');
    expect(component.filtered().map((r) => r.metadata.name)).toEqual(['allow-web']);
  });

  it('opens a resource with its project and creates new ones of the selected kind', async () => {
    await setup({ kind: 'Policy', project: 'shop' });

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.open(resources[0]);
    expect(navigate).toHaveBeenCalledWith(['/resources', 'Deployment', 'web'], { queryParams: { project: 'shop' } });

    fixture.componentInstance.create();
    expect(navigate).toHaveBeenCalledWith(['/resources', 'new'], { queryParams: { kind: 'Policy', project: 'shop' } });
  });
});
