import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  type CrossProjectRequest,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverProjectRequestsPageComponent } from './project-requests-page.component';
import { LoadweaverAccessRequestsComponent } from './access-requests.component';

const request: CrossProjectRequest = {
  project: 'web',
  policy: 'allow-shop',
  peer: 'shop',
  specHash: 'b'.repeat(64),
  planId: null,
  accepted: false,
};

describe('LoadweaverProjectRequestsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverProjectRequestsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(me: AccessMe, scope: Record<string, string> | null = null) {
    facade = facadeStub(
      {
        requests$: [request],
        projectAccess$: { project: 'shop', members: [], settings: null, requests: [request] },
        projectLoading$: false,
        projectError$: null,
        changing$: false,
        changeError$: null,
      },
      ['openProject', 'accept'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverProjectRequestsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ project: scope ? 'other' : 'shop' })) },
        },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: () => scope } }] : []),
        { provide: ConsoleAccessManagementFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverProjectRequestsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const requestsList = () =>
    fixture.debugElement.query(By.directive(LoadweaverAccessRequestsComponent))
      .componentInstance as LoadweaverAccessRequestsComponent;

  it('lists the project’s requests and accepts after confirmation', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });

    const component = fixture.componentInstance;

    expect(facade['openProject']).toHaveBeenCalledWith('shop');
    expect(el().querySelector('[data-testid="access-requests"]')?.textContent).toContain('web');
    expect(
      requestsList()
        .rowMenu(request)
        .map((item) => item.id),
    ).toContain('accept');

    component.acceptFor.set(request);
    expect(component.acceptMessage()).toContain('allow-shop');
    component.confirmAccept();
    expect(facade['accept']).toHaveBeenCalledWith('shop', request);
    expect(component.acceptFor()).toBeNull();
  });

  it('hides accepting from developers', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'developer' } });

    expect(fixture.componentInstance.mayAccept()).toBe(false);
    expect(
      requestsList()
        .rowMenu(request)
        .map((item) => item.id),
    ).not.toContain('accept');
  });

  it('searches the requests in the table', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });

    expect(el().querySelector('fpc-list-toolbar:not(.fpc-data-table__toolbar)')).toBeNull();
    fixture.componentInstance.search.set('nothing-like-this');
    fixture.detectChanges();
    expect(
      el().querySelector('[data-testid="access-requests"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
  });

  it('embedded in the project tab: the scope’s project, no routed header', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } }, { project: 'shop' });

    expect(fixture.componentInstance.project()).toBe('shop');
    expect(facade['openProject']).toHaveBeenCalledWith('shop');
    expect(facade['openProject']).not.toHaveBeenCalledWith('other');
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('[data-testid="project-requests-refresh"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="access-requests"]')?.textContent).toContain('web');
  });
});
