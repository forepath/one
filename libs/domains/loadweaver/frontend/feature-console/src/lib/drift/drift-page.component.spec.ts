import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDriftFacade,
  ConsoleGitFacade,
  type DriftContainer,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub, gitStub, testGitConnection } from '../testing';
import { deploymentName, LoadweaverDriftPageComponent } from './drift-page.component';

const container: DriftContainer = {
  node: 'n1',
  id: 'abcdef1234567890',
  name: 'My_Adminer',
  image: 'adminer:4',
  state: 'running',
  ports: ['8080:8080/tcp'],
  reportedAt: '2026-10-01T10:00:00.000Z',
};

describe('LoadweaverDriftPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverDriftPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let git: ReturnType<typeof gitStub>;

  beforeEach(async () => {
    git = gitStub([testGitConnection()]);
    facade = facadeStub(
      {
        report$: {
          containers: [container],
          inconsistent: [{ planId: '3f2a1b4c-0000', error: 'n2 failed', fixForward: '9a8b7c6d-0000' }],
          gitAhead: [
            {
              connection: testGitConnection().id,
              scope: 'shop',
              commit: 'abcdef0123456789',
              planId: '7d6c5b4a-0000',
              state: 'pending',
              reason: null,
              since: '2026-10-01T10:00:00.000Z',
            },
            {
              connection: 'c-cluster',
              scope: 'cluster',
              commit: '1234567890abcdef',
              planId: null,
              state: 'rejected',
              reason: 'clusters/prod/db.yaml:4: aws-access-key',
              since: '2026-10-01T10:00:00.000Z',
            },
          ],
        },
        loading$: false,
        error$: null,
        proposing$: false,
        proposeError$: null,
      },
      ['load', 'propose', 'clearProposeError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverDriftPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleDriftFacade, useValue: facade },
        { provide: ConsoleGitFacade, useValue: git },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'infra-operator', projects: { shop: 'admin' } }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverDriftPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows foreign containers and failed rollbacks with their plans', () => {
    expect(facade['load']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="drift-containers"]')?.textContent).toContain('adminer:4');
    expect(
      el().querySelector('[data-testid="drift-inconsistent"] a[href="/activity/plans/9a8b7c6d-0000"]'),
    ).not.toBeNull();
  });

  it('shows lanes with their own container search', () => {
    const component = fixture.componentInstance;

    expect(el().querySelector('[data-testid="drift-containers-lane"]')).not.toBeNull();
    expect(component.lanes().map((l) => l.id)).toContain('rollbacks');
    component.containerSearch.set('no-such-container');
    fixture.detectChanges();
    expect(
      el().querySelector('[data-testid="drift-containers"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
    component.containerSearch.set('adminer');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="drift-containers"]')?.textContent).toContain('adminer:4');
  });

  it('searches the failed rollbacks (3.38: every list lane that can grow)', () => {
    const component = fixture.componentInstance;

    expect(
      el().querySelector('[data-testid="drift-inconsistent"] fpc-search-field input')?.getAttribute('placeholder'),
    ).toBe('Search rollbacks');
    component.rollbackSearch.set('nothing');
    fixture.detectChanges();
    expect(
      el().querySelector('[data-testid="drift-inconsistent"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
    component.rollbackSearch.set('n2 failed');
    fixture.detectChanges();
    expect(component.filteredRollbacks()).toHaveLength(1);
    // No raw plan ids (D11): the failed rollback reads as its error, the id only via ⋮ Copy ID.
    expect(el().querySelector('[data-testid="drift-inconsistent"]')?.textContent).not.toContain('9a8b7c6d');
  });

  it('proposes a plan for a foreign container', () => {
    const component = fixture.componentInstance;

    component.openPropose(container);
    expect(component.project).toBe('shop');
    expect(component.deployment).toBe('my-adminer');

    component.deployment = 'Not Valid';
    component.propose();
    expect(component.invalid()).toBe(true);
    expect(facade['propose']).not.toHaveBeenCalled();

    component.deployment = 'adminer';
    component.propose();
    expect(facade['propose']).toHaveBeenCalledWith({
      node: 'n1',
      container: 'abcdef1234567890',
      project: 'shop',
      deployment: 'adminer',
    });
  });

  it('derives deployment names', () => {
    expect(deploymentName('--Foo.Bar--')).toBe('foo-bar');
    expect(deploymentName('___')).toBe('service');
  });

  it('lists Git scopes whose default branch is ahead of the cluster, with commit and plan links', () => {
    const ahead = el().querySelector('[data-testid="drift-git-ahead"]');

    expect(git['load']).toHaveBeenCalledWith(true);
    expect(ahead?.textContent).toContain('shop');
    expect(ahead?.textContent).toContain('Cluster scope');
    expect(ahead?.querySelector('a[href="https://github.com/acme/infra/commit/abcdef0123456789"]')).not.toBeNull();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance;
    const entry = component.gitAhead().find((e) => e.planId)!;

    // Open plan / Connection sit in the row's ⋮ (3.38 D8).
    expect(component.gitMenu(entry).map((item) => item.id)).toEqual(['plan', 'connection']);
    component.onGitAction(entry, 'plan');
    expect(navigate).toHaveBeenCalledWith(['/activity/plans', '7d6c5b4a-0000']);
    expect(ahead?.querySelector('a[href="/delivery/git/c-cluster"]')).not.toBeNull();
    expect(ahead?.querySelector('[data-testid="drift-git-reason"]')?.textContent).toContain('aws-access-key');
  });
});
