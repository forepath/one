import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConsolePoliciesFacade, type PolicyResource } from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { facadeStub } from '../testing';
import { LoadweaverPolicyDetailPageComponent } from './policy-detail-page.component';

const testPolicies: PolicyResource[] = [
  {
    apiVersion: 'loadweaver.com/v1',
    kind: 'Policy',
    metadata: { name: 'allow-web', project: 'shop' },
    spec: {
      mode: 'monitor',
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

describe('LoadweaverPolicyDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverPolicyDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(name: string, project?: string) {
    facade = facadeStub({ policies$: testPolicies, loading$: false, error$: null, members$: { 'shop/web': [] } }, [
      'load',
    ]);

    await TestBed.configureTestingModule({
      imports: [LoadweaverPolicyDetailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ name })),
            queryParamMap: of(convertToParamMap(project ? { project } : {})),
          },
        },
        { provide: ConsolePoliciesFacade, useValue: facade },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverPolicyDetailPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows from, to, rules and mode of the policy of the route', async () => {
    await setup('allow-web', 'shop');

    expect(facade['load']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="policy-overview"]')?.textContent).toContain('Monitor');
    expect(el().querySelector('[data-testid="policy-from"]')?.textContent).toContain('internet');
    expect(el().querySelector('[data-testid="policy-to"]')?.textContent).toContain('group web');
    expect(el().querySelector('[data-testid="policy-to"]')?.textContent).toContain('no members');
    expect(el().querySelector('[data-testid="policy-rules"]')?.textContent).toContain('tcp 443');
    expect(fixture.componentInstance.groupLink({ group: 'web' })).toEqual({
      commands: ['/resources', 'WorkloadGroup', 'web'],
      params: { project: 'shop' },
    });
  });

  it('finds cluster-wide policies and reports unknown ones', async () => {
    await setup('dns');

    expect(fixture.componentInstance.policy()?.metadata.name).toBe('dns');
    expect(fixture.componentInstance.groupLink({ group: 'web' })).toBeNull();

    TestBed.resetTestingModule();
    await setup('missing', 'shop');

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Policy not found');
  });
});
