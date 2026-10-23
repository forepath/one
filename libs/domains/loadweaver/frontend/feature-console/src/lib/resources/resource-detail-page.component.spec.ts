jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('./monaco-stub'));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  AutoscalingService,
  type ConsoleResource,
  ConsoleResourcesFacade,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { facadeStub } from '../testing';
import { LoadweaverResourceDetailPageComponent, routeResourceKey } from './resource-detail-page.component';

const deployment: ConsoleResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Deployment',
  metadata: { name: 'web', project: 'shop', labels: { tier: 'front' } },
  spec: { compose: 'services:\n  web:\n    image: nginx:1.27\n' },
};

describe('LoadweaverResourceDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverResourceDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      { selected$: deployment, selectedLoading$: false, selectedError$: null, planning$: false, planError$: null },
      ['open', 'plan', 'clearPlanError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverResourceDetailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ kind: 'Deployment', name: 'web' })),
            queryParamMap: of(convertToParamMap({ project: 'shop' })),
          },
        },
        { provide: ConsoleResourcesFacade, useValue: facade },
        { provide: AutoscalingService, useValue: { list: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverResourceDetailPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('opens the resource of the route and shows its YAML and compose file', () => {
    const component = fixture.componentInstance;

    expect(facade['open']).toHaveBeenCalledWith({ kind: 'Deployment', name: 'web', project: 'shop' });
    expect(component.heading()).toBe('Deployment shop/web');
    expect(component.yaml()).toContain('compose: |');
    expect(component.compose()).toContain('nginx:1.27');
    expect(component.healthUrl()).toBe('/health/deployment/shop/web');
    expect(el().querySelector('[data-testid="resource-metadata"]')?.textContent).toContain('tier=front');
  });

  it('plans the deletion', () => {
    fixture.componentInstance.confirmDelete();

    expect(facade['plan']).toHaveBeenCalledWith({ delete: [{ kind: 'Deployment', name: 'web', project: 'shop' }] });
  });

  it('reads the key from the route', () => {
    expect(routeResourceKey(convertToParamMap({ kind: 'Site', name: 'fra1' }), convertToParamMap({}))).toEqual({
      kind: 'Site',
      name: 'fra1',
      project: null,
    });
    expect(routeResourceKey(convertToParamMap({}), convertToParamMap({}))).toBeNull();
  });
});
