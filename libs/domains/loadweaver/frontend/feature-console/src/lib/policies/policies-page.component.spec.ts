import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsolePoliciesFacade,
  type PolicyResource,
  type WorkloadGroupResource,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverPoliciesPageComponent } from './policies-page.component';

const testGroups: WorkloadGroupResource[] = [
  {
    apiVersion: 'loadweaver.com/v1',
    kind: 'WorkloadGroup',
    metadata: { name: 'web', project: 'shop' },
    spec: { selector: { matchLabels: { app: 'web' } }, exposed: true },
  },
  {
    apiVersion: 'loadweaver.com/v1',
    kind: 'WorkloadGroup',
    metadata: { name: 'api', project: 'blog' },
    spec: { selector: { names: ['api'] }, intraGroup: 'isolate' },
  },
];
const testPolicies: PolicyResource[] = [
  {
    apiVersion: 'loadweaver.com/v1',
    kind: 'Policy',
    metadata: { name: 'allow-web', project: 'shop' },
    spec: {
      mode: 'monitor',
      action: 'allow',
      from: [{ builtin: 'internet' }],
      to: [{ group: 'web' }],
      rules: [{ protocol: 'tcp', ports: [443] }],
    },
  },
  {
    apiVersion: 'loadweaver.com/v1',
    kind: 'Policy',
    metadata: { name: 'dns' },
    spec: { from: [{ builtin: 'internet' }], to: [{ site: 'fra1' }], rules: [{ protocol: 'udp', ports: [53] }] },
  },
];

describe('LoadweaverPoliciesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverPoliciesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      {
        groups$: testGroups,
        policies$: testPolicies,
        loading$: false,
        error$: null,
        members$: {
          'shop/web': [
            {
              replica: 'shop/store/web/0',
              label: 'web/0',
              deployment: 'store',
              service: 'web',
              state: null,
              health: null,
            },
          ],
        },
        projects$: ['blog', 'shop'],
      },
      ['load'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverPoliciesPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsolePoliciesFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverPoliciesPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists groups with selectors and members and policies with their summary', () => {
    expect(facade['load']).toHaveBeenCalled();

    const groups = el().querySelector('[data-testid="policies-groups"]')?.textContent ?? '';
    const policies = el().querySelector('[data-testid="policies-list"]')?.textContent ?? '';

    expect(groups).toContain('app=web');
    expect(groups).toContain('Exposed');
    expect(groups).toContain('Isolated');
    expect(groups).toContain('store/web/0');
    expect(policies).toContain('internet → group web');
    expect(policies).toContain('Monitor');
    expect(policies).toContain('udp 53');
  });

  it('filters by project and keeps cluster-wide policies', () => {
    const component = fixture.componentInstance;

    component.project.set('shop');

    expect(component.filteredGroups().map((g) => g.metadata.name)).toEqual(['web']);
    expect(component.filteredPolicies().map((p) => p.metadata.name)).toEqual(['dns', 'allow-web']);
  });

  it('opens policies, groups and the editor', () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance;

    component.openPolicy(testPolicies[0]);
    expect(navigate).toHaveBeenCalledWith(['/policies', 'allow-web'], { queryParams: { project: 'shop' } });

    component.openGroup(testGroups[0]);
    expect(navigate).toHaveBeenCalledWith(['/resources', 'WorkloadGroup', 'web'], { queryParams: { project: 'shop' } });

    component.editGroup(testGroups[0]);
    expect(navigate).toHaveBeenCalledWith(['/resources', 'WorkloadGroup', 'web', 'edit'], {
      queryParams: { project: 'shop' },
    });

    component.project.set('shop');
    component.create('Policy');
    expect(navigate).toHaveBeenCalledWith(['/resources', 'new'], { queryParams: { kind: 'Policy', project: 'shop' } });
  });
});
